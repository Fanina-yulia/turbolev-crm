import { getPrisma } from "@/src/lib/prisma";

const QC_TERMINAL = new Set(["PASSED", "FAILED", "RECHECK"]);
const CLAIM_TERMINAL = new Set(["CLOSED", "REJECTED"]);

function num(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function round(value: number, digits = 1) {
  const scale = 10 ** digits;
  return Math.round((value + Number.EPSILON) * scale) / scale;
}

function pct(part: number, total: number) {
  return total > 0 ? round((part / total) * 100, 1) : null;
}

function minutes(start: Date, end: Date) {
  return Math.max(0, end.getTime() - start.getTime()) / 60_000;
}

export type QualityAnalyticsArgs = {
  from: Date;
  to: Date;
  locationIds?: string[] | null;
};

export async function getQualityAnalytics(args: QualityAnalyticsArgs) {
  const prisma = getPrisma();

  let scopedWorkOrderIds: string[] | null = null;
  if (args.locationIds) {
    const scoped = await prisma.serviceAppointment.findMany({
      where: {
        locationId: { in: args.locationIds },
        workOrderId: { not: null },
        NOT: { id: { startsWith: "demo_" } },
      },
      select: { workOrderId: true },
      distinct: ["workOrderId"],
      take: 20000,
    });
    scopedWorkOrderIds = scoped.map((row) => row.workOrderId).filter((id): id is string => Boolean(id));
  }

  if (scopedWorkOrderIds?.length === 0) {
    return {
      summary: emptySummary(),
      claims: [],
      mechanics: [],
      services: [],
      semantics: semantics(),
    };
  }

  const workOrderScope = scopedWorkOrderIds ? { id: { in: scopedWorkOrderIds } } : {};
  const relationWorkOrderScope = scopedWorkOrderIds ? { workOrderId: { in: scopedWorkOrderIds } } : {};

  const [visits, qcRows, claims] = await Promise.all([
    prisma.workOrder.findMany({
      where: {
        ...workOrderScope,
        closedAt: { gte: args.from, lt: args.to },
        NOT: { id: { startsWith: "demo_" } },
      },
      select: { id: true },
    }),
    prisma.workOrderQualityControl.findMany({
      where: {
        ...relationWorkOrderScope,
        completedAt: { gte: args.from, lt: args.to },
        status: { in: ["PASSED", "FAILED", "RECHECK"] },
        NOT: { workOrderId: { startsWith: "demo_" } },
      },
      select: { id: true, workOrderId: true, attempt: true, status: true, completedAt: true },
      orderBy: [{ workOrderId: "asc" }, { attempt: "asc" }],
    }),
    prisma.warrantyClaim.findMany({
      where: {
        createdAt: { gte: args.from, lt: args.to },
        ...(scopedWorkOrderIds ? { workOrderLine: { is: { workOrderId: { in: scopedWorkOrderIds } } } } : {}),
      },
      select: {
        id: true,
        status: true,
        reason: true,
        resolution: true,
        correctiveWorkOrderId: true,
        createdAt: true,
        closedAt: true,
        workOrderLineId: true,
        costFacts: {
          orderBy: { recordedAt: "asc" },
          select: { id: true, category: true, amount: true, currency: true, note: true, recordedAt: true, supplierId: true, sourceEntity: true, sourceEntityId: true },
        },
        workOrderLine: {
          select: {
            workOrderId: true,
            description: true,
            code: true,
            mechanicId: true,
            supplierId: true,
            completedAt: true,
            workOrder: {
              select: {
                id: true,
                closedAt: true,
                vehicle: { select: { id: true, plateNumber: true, brand: true, model: true, year: true } },
              },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 1000,
    }),
  ]);

  const qcByWorkOrder = new Map<string, typeof qcRows>();
  for (const row of qcRows) {
    const current = qcByWorkOrder.get(row.workOrderId) ?? [];
    current.push(row);
    qcByWorkOrder.set(row.workOrderId, current);
  }

  const firstAttempts = [...qcByWorkOrder.values()]
    .map((rows) => rows.find((row) => row.attempt === 1 && QC_TERMINAL.has(row.status)))
    .filter((row): row is NonNullable<typeof row> => Boolean(row));
  const firstPass = firstAttempts.filter((row) => row.status === "PASSED").length;
  const firstDefects = firstAttempts.filter((row) => row.status === "FAILED" || row.status === "RECHECK").length;
  const qcWorkOrders = new Set(qcRows.map((row) => row.workOrderId));
  const reworkWorkOrders = new Set([...qcByWorkOrder.entries()]
    .filter(([, rows]) => rows.some((row) => row.attempt > 1))
    .map(([workOrderId]) => workOrderId));

  const lineIds = [...new Set(claims.map((claim) => claim.workOrderLineId))];
  const claimHistory = lineIds.length
    ? await prisma.warrantyClaim.findMany({
        where: { workOrderLineId: { in: lineIds }, createdAt: { lt: args.to } },
        select: { id: true, workOrderLineId: true, createdAt: true },
        orderBy: [{ workOrderLineId: "asc" }, { createdAt: "asc" }],
      })
    : [];
  const historyByLine = new Map<string, typeof claimHistory>();
  for (const row of claimHistory) {
    const current = historyByLine.get(row.workOrderLineId) ?? [];
    current.push(row);
    historyByLine.set(row.workOrderLineId, current);
  }

  const mechanicIds = [...new Set(claims.map((claim) => claim.workOrderLine.mechanicId).filter((id): id is string => Boolean(id)))];
  const mechanicRows = mechanicIds.length
    ? await prisma.serviceMechanic.findMany({ where: { id: { in: mechanicIds } }, select: { id: true, name: true } })
    : [];
  const mechanicName = new Map(mechanicRows.map((row) => [row.id, row.name]));

  const workOrderIds = [...new Set(claims.map((claim) => claim.workOrderLine.workOrderId))];
  const numberRows = workOrderIds.length
    ? await prisma.workOrderNumber.findMany({ where: { workOrderId: { in: workOrderIds } }, select: { workOrderId: true, number: true } })
    : [];
  const numberByWorkOrder = new Map(numberRows.map((row) => [row.workOrderId, row.number]));

  const mechanicAgg = new Map<string, { mechanicId: string; name: string; claims: number; repeat: number; cost: number; costCapturedClaims: number }>();
  const serviceAgg = new Map<string, { key: string; label: string; claims: number; repeat: number; cost: number }>();

  const caseRows = claims.map((claim) => {
    const history = historyByLine.get(claim.workOrderLineId) ?? [];
    const repeat = history.some((row) => row.id !== claim.id && row.createdAt < claim.createdAt);
    const uahFacts = claim.costFacts.filter((fact) => fact.currency === "UAH");
    const hasCost = claim.costFacts.length > 0 && uahFacts.length === claim.costFacts.length;
    const costUah = uahFacts.reduce((sum, fact) => sum + num(fact.amount), 0);
    const resolutionMinutes = claim.closedAt && CLAIM_TERMINAL.has(claim.status)
      ? minutes(claim.createdAt, claim.closedAt)
      : null;
    const mechanicId = claim.workOrderLine.mechanicId;
    if (mechanicId) {
      const current = mechanicAgg.get(mechanicId) ?? { mechanicId, name: mechanicName.get(mechanicId) ?? "Механік", claims: 0, repeat: 0, cost: 0, costCapturedClaims: 0 };
      current.claims += 1;
      if (repeat) current.repeat += 1;
      if (hasCost) { current.cost += costUah; current.costCapturedClaims += 1; }
      mechanicAgg.set(mechanicId, current);
    }
    const serviceKey = claim.workOrderLine.code || claim.workOrderLine.description.trim().toLocaleLowerCase("uk-UA");
    const service = serviceAgg.get(serviceKey) ?? { key: serviceKey, label: claim.workOrderLine.description, claims: 0, repeat: 0, cost: 0 };
    service.claims += 1;
    if (repeat) service.repeat += 1;
    if (hasCost) service.cost += costUah;
    serviceAgg.set(serviceKey, service);

    return {
      claimId: claim.id,
      status: claim.status,
      reason: claim.reason,
      resolution: claim.resolution,
      createdAt: claim.createdAt,
      closedAt: claim.closedAt,
      resolutionMinutes,
      repeatDefect: repeat,
      costCaptured: hasCost,
      costUah: hasCost ? round(costUah, 2) : null,
      costFactCount: claim.costFacts.length,
      correctiveWorkOrderId: claim.correctiveWorkOrderId,
      workOrderId: claim.workOrderLine.workOrderId,
      workOrderNumber: numberByWorkOrder.get(claim.workOrderLine.workOrderId) ?? null,
      service: claim.workOrderLine.description,
      serviceCode: claim.workOrderLine.code,
      mechanicId,
      mechanicName: mechanicId ? mechanicName.get(mechanicId) ?? "Механік" : null,
      supplierId: claim.workOrderLine.supplierId,
      vehicle: claim.workOrderLine.workOrder.vehicle,
    };
  });

  const resolved = caseRows.filter((row) => row.resolutionMinutes != null);
  const repeatClaims = caseRows.filter((row) => row.repeatDefect).length;
  const costCapturedClaims = caseRows.filter((row) => row.costCaptured).length;
  const costCoveragePct = claims.length ? pct(costCapturedClaims, claims.length) : 100;
  const completeCostCoverage = claims.length === 0 || costCapturedClaims === claims.length;
  const totalCost = completeCostCoverage ? caseRows.reduce((sum, row) => sum + (row.costUah ?? 0), 0) : null;

  return {
    summary: {
      visits: visits.length,
      qcWorkOrders: qcWorkOrders.size,
      firstPassQcPct: pct(firstPass, firstAttempts.length),
      qcDefectRatePct: pct(firstDefects, firstAttempts.length),
      reworkRatePct: pct(reworkWorkOrders.size, qcWorkOrders.size),
      warrantyClaims: claims.length,
      warrantyClaimsPer100Visits: visits.length > 0 ? round((claims.length / visits.length) * 100, 2) : null,
      resolvedClaims: resolved.length,
      averageResolutionHours: resolved.length ? round(resolved.reduce((sum, row) => sum + (row.resolutionMinutes ?? 0), 0) / resolved.length / 60, 1) : null,
      repeatDefectPct: pct(repeatClaims, claims.length),
      repeatDefects: repeatClaims,
      warrantyCostUah: totalCost == null ? null : round(totalCost, 2),
      warrantyCostCoveragePct: costCoveragePct,
    },
    claims: caseRows.slice(0, 100),
    mechanics: [...mechanicAgg.values()].sort((a, b) => b.claims - a.claims || b.repeat - a.repeat || a.name.localeCompare(b.name, "uk")),
    services: [...serviceAgg.values()].sort((a, b) => b.claims - a.claims || b.repeat - a.repeat || a.label.localeCompare(b.label, "uk")).slice(0, 30),
    semantics: semantics(),
  };
}

function emptySummary() {
  return {
    visits: 0,
    qcWorkOrders: 0,
    firstPassQcPct: null,
    qcDefectRatePct: null,
    reworkRatePct: null,
    warrantyClaims: 0,
    warrantyClaimsPer100Visits: null,
    resolvedClaims: 0,
    averageResolutionHours: null,
    repeatDefectPct: null,
    repeatDefects: 0,
    warrantyCostUah: 0,
    warrantyCostCoveragePct: 100,
  };
}

function semantics() {
  return {
    firstPass: "Перша завершена QC-спроба PASSED / усі terminal перші QC-спроби.",
    defectRate: "Перша QC-спроба FAILED або RECHECK / усі terminal перші QC-спроби.",
    rework: "Work Order із QC attempt > 1 / Work Order із terminal QC у періоді.",
    warrantyFrequency: "Гарантійні звернення, створені у періоді / закриті Work Order у періоді × 100.",
    repeatDefect: "Звернення, для якого вже існувало попереднє звернення до тієї самої вихідної гарантійної WorkOrderLine.",
    warrantyCost: "Сума immutable WarrantyClaimCostFact у UAH. KPI приховується, якщо хоча б одне звернення періоду не має повного cost fact coverage.",
  };
}
