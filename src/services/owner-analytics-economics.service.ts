import { getPrisma } from "@/src/lib/prisma";
import { decimalToNumber, roundMoney } from "@/src/domain/finance";
import { formatWorkOrderNumber } from "@/src/domain/work-order-number";

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

  if (scopedWorkOrderIds?.length === 0) {
    return {
      workOrders: [],
      clientLtv: [],
      cohort: { servedClients: 0, lifetimeOrders: 0, lifetimeRevenue: 0, lifetimeGrossProfit: 0 },
    };
  }

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
  if (!periodOrderIds.length) {
    return {
      workOrders: [],
      clientLtv: [],
      cohort: { servedClients: 0, lifetimeOrders: 0, lifetimeRevenue: 0, lifetimeGrossProfit: 0 },
    };
  }

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
  const lifetimeOrders = await prisma.workOrder.findMany({
    where: {
      ...scopedWhere,
      status: "CLOSED",
      clientId: { in: cohortClientIds },
      NOT: { id: { startsWith: "demo_" } },
    },
    select: { id: true, clientId: true, closedAt: true },
    orderBy: { closedAt: "asc" },
  });
  const lifetimeIds = lifetimeOrders.map((row) => row.id);
  const lifetimeSnapshots = lifetimeIds.length
    ? await prisma.workOrderFinanceSnapshot.findMany({
        where: { workOrderId: { in: lifetimeIds }, kind: "ACTUAL" },
        select: { workOrderId: true, grossRevenue: true, grossProfit: true },
      })
    : [];
  const lifetimeSnapshotByOrder = new Map(lifetimeSnapshots.map((row) => [row.workOrderId, row]));
  const grouped = new Map<string, {
    orders: number;
    revenue: number;
    grossProfit: number;
    firstClosedAt: Date | null;
    lastClosedAt: Date | null;
  }>();
  for (const order of lifetimeOrders) {
    const snapshot = lifetimeSnapshotByOrder.get(order.id);
    if (!snapshot) continue;
    const current = grouped.get(order.clientId) || { orders: 0, revenue: 0, grossProfit: 0, firstClosedAt: null, lastClosedAt: null };
    current.orders += 1;
    current.revenue += decimalToNumber(snapshot.grossRevenue);
    current.grossProfit += decimalToNumber(snapshot.grossProfit);
    if (order.closedAt && (!current.firstClosedAt || order.closedAt < current.firstClosedAt)) current.firstClosedAt = order.closedAt;
    if (order.closedAt && (!current.lastClosedAt || order.closedAt > current.lastClosedAt)) current.lastClosedAt = order.closedAt;
    grouped.set(order.clientId, current);
  }

  const clientLtv = [...grouped.entries()].map(([clientId, row]) => {
    const client = clientById.get(clientId) ?? null;
    return {
      clientId,
      name: client?.name || client?.phone || "Клієнт",
      visits: row.orders,
      lifetimeRevenue: roundMoney(row.revenue),
      lifetimeGrossProfit: roundMoney(row.grossProfit),
      averageCheck: row.orders ? roundMoney(row.revenue / row.orders) : 0,
      grossMarginPct: pct(row.grossProfit, row.revenue),
      firstClosedAt: row.firstClosedAt?.toISOString() ?? null,
      lastClosedAt: row.lastClosedAt?.toISOString() ?? null,
    };
  }).sort((a, b) => b.lifetimeGrossProfit - a.lifetimeGrossProfit || b.lifetimeRevenue - a.lifetimeRevenue);

  return {
    workOrders: workOrders.slice(0, 250),
    clientLtv: clientLtv.slice(0, 100),
    cohort: {
      servedClients: cohortClientIds.length,
      lifetimeOrders: lifetimeSnapshots.length,
      lifetimeRevenue: roundMoney(lifetimeSnapshots.reduce((sum, row) => sum + decimalToNumber(row.grossRevenue), 0)),
      lifetimeGrossProfit: roundMoney(lifetimeSnapshots.reduce((sum, row) => sum + decimalToNumber(row.grossProfit), 0)),
    },
  };
}
