import { getPrisma } from "@/src/lib/prisma";
import { decimalToNumber, roundMoney } from "@/src/domain/finance";
import { formatWorkOrderNumber } from "@/src/domain/work-order-number";
import { getCustomerLifetimeMetrics } from "@/src/services/customer-ltv.service";

function pct(part: number, total: number) {
  return total > 0 ? Math.round((part / total) * 1000) / 10 : 0;
}

function vehicleLabel(vehicle: { brand: string | null; model: string | null; year: number | null }) {
  return [vehicle.brand, vehicle.model, vehicle.year].filter(Boolean).join(" ") || "Автомобіль";
}

type Input = {
  from: Date;
  to: Date;
  effectiveLocationIds: string[] | null;
};

function emptyResult() {
  return {
    workOrders: [],
    clientLtv: [],
    cohort: {
      servedClients: 0,
      lifetimeOrders: 0,
      lifetimeRevenue: 0 as number | null,
      lifetimeGrossProfit: 0 as number | null,
      lifetimeContribution: 0 as number | null,
      financeCoveragePct: 100,
      warrantyCostCoveragePct: 100,
      completeClients: 0,
    },
  };
}

export async function getOwnerAnalyticsEconomics(input: Input) {
  const prisma = getPrisma();

  let scopedWorkOrderIds: string[] | null = null;
  if (input.effectiveLocationIds) {
    const appointmentRows = await prisma.serviceAppointment.findMany({
      where: {
        locationId: { in: input.effectiveLocationIds },
        workOrderId: { not: null },
        NOT: { id: { startsWith: "demo_" } },
      },
      select: { workOrderId: true },
      distinct: ["workOrderId"],
    });
    scopedWorkOrderIds = appointmentRows.map((row) => row.workOrderId).filter((id): id is string => Boolean(id));
  }

  if (scopedWorkOrderIds?.length === 0) return emptyResult();

  const scopedWhere = scopedWorkOrderIds ? { id: { in: scopedWorkOrderIds } } : {};
  const periodOrders = await prisma.workOrder.findMany({
    where: {
      ...scopedWhere,
      status: "CLOSED",
      closedAt: { gte: input.from, lt: input.to },
      NOT: { id: { startsWith: "demo_" } },
    },
    select: { id: true, clientId: true, vehicleId: true, closedAt: true },
    orderBy: { closedAt: "desc" },
  });
  const periodOrderIds = periodOrders.map((row) => row.id);
  if (!periodOrderIds.length) return emptyResult();

  const [periodSnapshots, numberRows, clients, vehicles] = await Promise.all([
    prisma.workOrderFinanceSnapshot.findMany({
      where: { workOrderId: { in: periodOrderIds }, kind: "ACTUAL" },
      select: {
        workOrderId: true,
        currency: true,
        grossRevenue: true,
        directCost: true,
        grossProfit: true,
        grossMarginPercent: true,
        partsCost: true,
        laborCost: true,
        externalCost: true,
        consumablesCost: true,
        otherDirectCost: true,
        lockedAt: true,
      },
    }),
    prisma.workOrderNumber.findMany({
      where: { workOrderId: { in: periodOrderIds } },
      select: { workOrderId: true, number: true },
    }),
    prisma.client.findMany({
      where: { id: { in: [...new Set(periodOrders.map((row) => row.clientId))] } },
      select: { id: true, name: true, phone: true },
    }),
    prisma.vehicle.findMany({
      where: { id: { in: [...new Set(periodOrders.map((row) => row.vehicleId))] } },
      select: { id: true, brand: true, model: true, year: true, plateNumber: true, vin: true },
    }),
  ]);

  const snapshotByOrder = new Map(periodSnapshots.map((row) => [row.workOrderId, row]));
  const numberByOrder = new Map(numberRows.map((row) => [row.workOrderId, row.number]));
  const clientById = new Map(clients.map((row) => [row.id, row]));
  const vehicleById = new Map(vehicles.map((row) => [row.id, row]));

  const workOrders = periodOrders.flatMap((order) => {
    const snapshot = snapshotByOrder.get(order.id);
    if (!snapshot) return [];
    const client = clientById.get(order.clientId) ?? null;
    const vehicle = vehicleById.get(order.vehicleId) ?? null;
    const revenue = decimalToNumber(snapshot.grossRevenue);
    const grossProfit = decimalToNumber(snapshot.grossProfit);
    return [{
      workOrderId: order.id,
      number: numberByOrder.get(order.id) ?? null,
      displayNumber: formatWorkOrderNumber(numberByOrder.get(order.id) ?? null),
      closedAt: order.closedAt?.toISOString() ?? null,
      clientId: order.clientId,
      clientName: client?.name || client?.phone || "Клієнт",
      vehicleId: order.vehicleId,
      vehicle: vehicle ? vehicleLabel(vehicle) : "Автомобіль",
      plateNumber: vehicle?.plateNumber ?? null,
      vin: vehicle?.vin ?? null,
      currency: snapshot.currency,
      grossRevenue: roundMoney(revenue),
      directCost: roundMoney(decimalToNumber(snapshot.directCost)),
      grossProfit: roundMoney(grossProfit),
      grossMarginPct: snapshot.grossMarginPercent == null ? pct(grossProfit, revenue) : decimalToNumber(snapshot.grossMarginPercent),
      costMix: {
        parts: roundMoney(decimalToNumber(snapshot.partsCost)),
        labor: roundMoney(decimalToNumber(snapshot.laborCost)),
        external: roundMoney(decimalToNumber(snapshot.externalCost)),
        consumables: roundMoney(decimalToNumber(snapshot.consumablesCost)),
        other: roundMoney(decimalToNumber(snapshot.otherDirectCost)),
      },
      lockedAt: snapshot.lockedAt?.toISOString() ?? null,
    }];
  }).sort((a, b) => b.grossProfit - a.grossProfit || b.grossRevenue - a.grossRevenue);

  const cohortClientIds = [...new Set(periodOrders.map((row) => row.clientId))];
  const clientLtv = await getCustomerLifetimeMetrics({ clientIds: cohortClientIds, scopedWorkOrderIds });
  const complete = clientLtv.filter((row) => row.complete);
  const allComplete = complete.length === clientLtv.length;
  const lifetimeOrders = clientLtv.reduce((sum, row) => sum + row.visits, 0);
  const weightedFinanceCoverage = lifetimeOrders
    ? clientLtv.reduce((sum, row) => sum + row.financeCoveragePct * row.visits, 0) / lifetimeOrders
    : 100;
  const warrantyClaims = clientLtv.reduce((sum, row) => sum + row.warrantyClaims, 0);
  const weightedWarrantyCoverage = warrantyClaims
    ? clientLtv.reduce((sum, row) => sum + row.warrantyCostCoveragePct * row.warrantyClaims, 0) / warrantyClaims
    : 100;

  return {
    workOrders: workOrders.slice(0, 250),
    clientLtv: clientLtv
      .sort((a, b) => (b.lifetimeContribution ?? Number.NEGATIVE_INFINITY) - (a.lifetimeContribution ?? Number.NEGATIVE_INFINITY) || b.visits - a.visits)
      .slice(0, 100),
    cohort: {
      servedClients: cohortClientIds.length,
      lifetimeOrders,
      lifetimeRevenue: allComplete ? roundMoney(complete.reduce((sum, row) => sum + (row.lifetimeRevenue ?? 0), 0)) : null,
      lifetimeGrossProfit: allComplete ? roundMoney(complete.reduce((sum, row) => sum + (row.lifetimeGrossProfit ?? 0), 0)) : null,
      lifetimeContribution: allComplete ? roundMoney(complete.reduce((sum, row) => sum + (row.lifetimeContribution ?? 0), 0)) : null,
      financeCoveragePct: Math.round(weightedFinanceCoverage * 10) / 10,
      warrantyCostCoveragePct: Math.round(weightedWarrantyCoverage * 10) / 10,
      completeClients: complete.length,
    },
  };
}
