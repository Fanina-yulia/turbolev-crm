import { getPrisma } from "@/src/lib/prisma";
import { decimalToNumber, roundMoney } from "@/src/domain/finance";

function pct(part: number, total: number) {
  if (total <= 0) return 100;
  return Math.round((part / total) * 1000) / 10;
}

function daysBetween(start: Date, end: Date) {
  return Math.max(0, Math.floor((end.getTime() - start.getTime()) / 86_400_000));
}

export type CustomerLifetimeMetricsInput = {
  clientIds: string[];
  scopedWorkOrderIds?: string[] | null;
  now?: Date;
};

export type CustomerLifetimeMetric = {
  clientId: string;
  name: string;
  phone: string;
  visits: number;
  vehicles: number;
  financeSnapshots: number;
  financeCoveragePct: number;
  warrantyClaims: number;
  warrantyCostCapturedClaims: number;
  warrantyCostCoveragePct: number;
  currency: string | null;
  lifetimeRevenue: number | null;
  lifetimeGrossProfit: number | null;
  warrantyCost: number | null;
  lifetimeContribution: number | null;
  averageCheck: number | null;
  grossMarginPct: number | null;
  firstClosedAt: string | null;
  lastClosedAt: string | null;
  lifetimeDays: number | null;
  daysSinceLastVisit: number | null;
  acquisitionSource: string | null;
  acquisitionSourceCoverage: boolean;
  acquisitionCost: null;
  acquisitionCostCoverage: false;
  complete: boolean;
  blockers: string[];
  workOrderIds: string[];
};

export async function getCustomerLifetimeMetrics(input: CustomerLifetimeMetricsInput): Promise<CustomerLifetimeMetric[]> {
  const prisma = getPrisma();
  const clientIds = [...new Set(input.clientIds.filter(Boolean))];
  if (!clientIds.length) return [];
  const now = input.now ?? new Date();

  const scoped = input.scopedWorkOrderIds === undefined || input.scopedWorkOrderIds === null
    ? null
    : new Set(input.scopedWorkOrderIds);

  const [clients, allOrders, leadLinks] = await Promise.all([
    prisma.client.findMany({
      where: { id: { in: clientIds } },
      select: { id: true, name: true, phone: true },
    }),
    prisma.workOrder.findMany({
      where: {
        clientId: { in: clientIds },
        status: "CLOSED",
        closedAt: { not: null },
        NOT: { id: { startsWith: "demo_" } },
      },
      select: { id: true, clientId: true, vehicleId: true, closedAt: true },
      orderBy: { closedAt: "asc" },
    }),
    prisma.diagnosticRequest.findMany({
      where: { clientId: { in: clientIds }, leadId: { not: null }, NOT: { id: { startsWith: "demo_" } } },
      select: { clientId: true, createdAt: true, lead: { select: { source: true } } },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  const orders = scoped ? allOrders.filter((order) => scoped.has(order.id)) : allOrders;
  const workOrderIds = orders.map((order) => order.id);

  const [snapshots, claims] = await Promise.all([
    workOrderIds.length
      ? prisma.workOrderFinanceSnapshot.findMany({
          where: { workOrderId: { in: workOrderIds }, kind: "ACTUAL" },
          select: {
            workOrderId: true,
            currency: true,
            grossRevenue: true,
            grossProfit: true,
            refundAmount: true,
            lockedAt: true,
          },
        })
      : [],
    workOrderIds.length
      ? prisma.warrantyClaim.findMany({
          where: { workOrderLine: { is: { workOrderId: { in: workOrderIds } } } },
          select: {
            id: true,
            workOrderLine: { select: { workOrderId: true } },
            costFacts: { select: { amount: true, currency: true } },
          },
        })
      : [],
  ]);

  const clientById = new Map(clients.map((row) => [row.id, row]));
  const orderById = new Map(orders.map((row) => [row.id, row]));
  const ordersByClient = new Map<string, typeof orders>();
  for (const order of orders) {
    const rows = ordersByClient.get(order.clientId) ?? [];
    rows.push(order);
    ordersByClient.set(order.clientId, rows);
  }
  const snapshotByOrder = new Map(snapshots.map((row) => [row.workOrderId, row]));
  const claimsByClient = new Map<string, typeof claims>();
  for (const claim of claims) {
    const order = orderById.get(claim.workOrderLine.workOrderId);
    if (!order) continue;
    const rows = claimsByClient.get(order.clientId) ?? [];
    rows.push(claim);
    claimsByClient.set(order.clientId, rows);
  }
  const acquisitionByClient = new Map<string, string>();
  for (const row of leadLinks) {
    if (!acquisitionByClient.has(row.clientId) && row.lead?.source) acquisitionByClient.set(row.clientId, String(row.lead.source));
  }

  return clientIds.map((clientId) => {
    const client = clientById.get(clientId);
    const clientOrders = ordersByClient.get(clientId) ?? [];
    const clientSnapshots = clientOrders.map((order) => snapshotByOrder.get(order.id)).filter((row): row is NonNullable<typeof row> => Boolean(row));
    const clientClaims = claimsByClient.get(clientId) ?? [];
    const currencies = new Set(clientSnapshots.map((row) => row.currency));
    const currency = currencies.size === 1 ? [...currencies][0] : currencies.size === 0 ? "UAH" : null;
    const financeCoveragePct = pct(clientSnapshots.length, clientOrders.length);
    const financeComplete = clientOrders.length === clientSnapshots.length && clientSnapshots.every((row) => Boolean(row.lockedAt));

    let costCapturedClaims = 0;
    let warrantyCostObserved = 0;
    let warrantyCurrencyMismatch = false;
    for (const claim of clientClaims) {
      if (!claim.costFacts.length) continue;
      const factCurrencies = new Set(claim.costFacts.map((fact) => fact.currency));
      if (factCurrencies.size !== 1 || (currency && !factCurrencies.has(currency))) {
        warrantyCurrencyMismatch = true;
        continue;
      }
      costCapturedClaims += 1;
      warrantyCostObserved += claim.costFacts.reduce((sum, fact) => sum + decimalToNumber(fact.amount), 0);
    }
    const warrantyCostCoveragePct = pct(costCapturedClaims, clientClaims.length);
    const warrantyComplete = clientClaims.length === costCapturedClaims && !warrantyCurrencyMismatch;
    const complete = financeComplete && warrantyComplete && currency !== null;

    const observedRevenue = clientSnapshots.reduce((sum, row) => sum + decimalToNumber(row.grossRevenue), 0);
    const observedGrossProfit = clientSnapshots.reduce((sum, row) => sum + decimalToNumber(row.grossProfit), 0);
    const firstClosed = clientOrders[0]?.closedAt ?? null;
    const lastClosed = clientOrders[clientOrders.length - 1]?.closedAt ?? null;
    const blockers: string[] = [];
    if (!financeComplete) blockers.push("Неповне покриття ACTUAL finance snapshot");
    if (currency === null) blockers.push("Кілька валют у lifetime cohort");
    if (!warrantyComplete) blockers.push("Неповне покриття фактичних гарантійних витрат");

    const revenue = complete ? roundMoney(observedRevenue) : null;
    const grossProfit = complete ? roundMoney(observedGrossProfit) : null;
    const warrantyCost = complete ? roundMoney(warrantyCostObserved) : null;
    const contribution = complete ? roundMoney(observedGrossProfit - warrantyCostObserved) : null;

    return {
      clientId,
      name: client?.name || client?.phone || "Клієнт",
      phone: client?.phone || "",
      visits: clientOrders.length,
      vehicles: new Set(clientOrders.map((order) => order.vehicleId)).size,
      financeSnapshots: clientSnapshots.length,
      financeCoveragePct,
      warrantyClaims: clientClaims.length,
      warrantyCostCapturedClaims: costCapturedClaims,
      warrantyCostCoveragePct,
      currency,
      lifetimeRevenue: revenue,
      lifetimeGrossProfit: grossProfit,
      warrantyCost,
      lifetimeContribution: contribution,
      averageCheck: complete && clientOrders.length ? roundMoney(observedRevenue / clientOrders.length) : null,
      grossMarginPct: complete && observedRevenue !== 0 ? Math.round((observedGrossProfit / observedRevenue) * 1000) / 10 : null,
      firstClosedAt: firstClosed?.toISOString() ?? null,
      lastClosedAt: lastClosed?.toISOString() ?? null,
      lifetimeDays: firstClosed && lastClosed ? daysBetween(firstClosed, lastClosed) : null,
      daysSinceLastVisit: lastClosed ? daysBetween(lastClosed, now) : null,
      acquisitionSource: acquisitionByClient.get(clientId) ?? null,
      acquisitionSourceCoverage: acquisitionByClient.has(clientId),
      acquisitionCost: null,
      acquisitionCostCoverage: false,
      complete,
      blockers,
      workOrderIds: clientOrders.map((order) => order.id),
    };
  });
}
