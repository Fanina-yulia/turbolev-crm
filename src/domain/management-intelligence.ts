import { roundMoney } from "@/src/domain/management-result";

export const MANAGEMENT_DEVIATION_CODES = [
  "TRAFFIC_SHORTAGE",
  "BOOKING_ARRIVAL_CONVERSION",
  "DIAGNOSTICS_APPROVAL_CONVERSION",
  "LOW_AVERAGE_CHECK",
  "LOW_PARTS_MARGIN",
  "PARTS_SHORTAGE",
  "APPROVAL_DELAY",
  "MECHANIC_UNDERLOAD",
  "LIFT_DOWNTIME",
  "STAFF_SHORTAGE",
  "WARRANTY_REWORK",
  "NO_SHOW",
  "EQUIPMENT",
  "PLANNING_ERROR",
  "EXTERNAL_FACTOR",
] as const;

export type ManagementDeviationCode = (typeof MANAGEMENT_DEVIATION_CODES)[number];

export const DEFAULT_STAGE_PROBABILITIES: Record<string, number> = {
  BOOKED: 0.45,
  ARRIVED: 0.62,
  DIAGNOSTICS: 0.68,
  WAITING_PARTS_SELECTION: 0.72,
  WAITING_CALCULATION: 0.74,
  WAITING_APPROVAL: 0.78,
  WAITING_PARTS: 0.84,
  READY_FOR_REPAIR: 0.93,
  IN_REPAIR: 0.97,
  WAITING_QC: 0.99,
  WAITING_PAYMENT: 1,
  READY_FOR_PICKUP: 1,
};

function finite(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function clampPercent(value: unknown) {
  return Math.max(0, Math.min(100, finite(value)));
}

export function shiftAvailableMinutes(input: {
  status: string;
  startMinute?: number | null;
  endMinute?: number | null;
  locationOpenMinute: number;
  locationCloseMinute: number;
}) {
  if (["DAY_OFF", "VACATION", "SICK", "ABSENT"].includes(input.status)) return 0;
  const open = Number.isFinite(input.startMinute) ? Number(input.startMinute) : input.locationOpenMinute;
  const close = Number.isFinite(input.endMinute) ? Number(input.endMinute) : input.locationCloseMinute;
  return Math.max(0, close - open);
}

export function paceForecast(fact: number, elapsedProductiveMinutes: number, totalProductiveMinutes: number) {
  if (fact <= 0 || elapsedProductiveMinutes <= 0 || totalProductiveMinutes <= 0) return roundMoney(Math.max(0, fact));
  return roundMoney(Math.max(fact, fact * totalProductiveMinutes / Math.min(totalProductiveMinutes, elapsedProductiveMinutes)));
}

export type PipelineWeightedEntry = { status: string; amount: number };
export function weightedPipelineForecast(
  fact: number,
  entries: PipelineWeightedEntry[],
  probabilities: Record<string, number>,
) {
  const weightedPipeline = entries.reduce((sum, row) => {
    const probability = probabilities[row.status] ?? DEFAULT_STAGE_PROBABILITIES[row.status] ?? 0;
    return sum + Math.max(0, finite(row.amount)) * Math.max(0, Math.min(1, probability));
  }, 0);
  return roundMoney(Math.max(0, fact) + weightedPipeline);
}

export function blendedHistoricalProbability(args: {
  status: string;
  completed: number;
  eligible: number;
  priorStrength?: number;
}) {
  const prior = DEFAULT_STAGE_PROBABILITIES[args.status] ?? 0.5;
  const priorStrength = Math.max(1, args.priorStrength ?? 8);
  if (args.eligible <= 0) return prior;
  return Math.max(0.05, Math.min(1, (args.completed + prior * priorStrength) / (args.eligible + priorStrength)));
}

export type BonusSchemeLike = {
  basis: "FACT" | "ABOVE_BREAK_EVEN" | "ABOVE_TARGET" | string;
  activationThresholdPct: number;
  basePercent: number;
  fixedAmount?: number | null;
  tier2ThresholdPct?: number | null;
  tier2Percent?: number | null;
  tier3ThresholdPct?: number | null;
  tier3Percent?: number | null;
  minMarginPct?: number | null;
  maxWarrantyRatePct?: number | null;
  maxOverdueReceivablePct?: number | null;
  minDataQualityPct?: number | null;
  capAmount?: number | null;
};

export type BonusQuality = {
  grossMarginPct: number | null;
  warrantyRatePct: number | null;
  overdueReceivablePct: number | null;
  dataQualityPct: number | null;
};

export function calculateStationManagerBonus(args: {
  target: number;
  fact: number;
  breakEven: number;
  scheme: BonusSchemeLike;
  quality: BonusQuality;
}) {
  const target = Math.max(0, finite(args.target));
  const fact = Math.max(0, finite(args.fact));
  const performancePct = target > 0 ? fact / target * 100 : 0;
  const scheme = args.scheme;
  const gates = [
    {
      code: "MIN_MARGIN",
      enabled: scheme.minMarginPct != null,
      pass: scheme.minMarginPct == null || (args.quality.grossMarginPct != null && args.quality.grossMarginPct >= scheme.minMarginPct),
      actual: args.quality.grossMarginPct,
      threshold: scheme.minMarginPct ?? null,
    },
    {
      code: "MAX_WARRANTY_RATE",
      enabled: scheme.maxWarrantyRatePct != null,
      pass: scheme.maxWarrantyRatePct == null || (args.quality.warrantyRatePct != null && args.quality.warrantyRatePct <= scheme.maxWarrantyRatePct),
      actual: args.quality.warrantyRatePct,
      threshold: scheme.maxWarrantyRatePct ?? null,
    },
    {
      code: "MAX_OVERDUE_RECEIVABLE",
      enabled: scheme.maxOverdueReceivablePct != null,
      pass: scheme.maxOverdueReceivablePct == null || (args.quality.overdueReceivablePct != null && args.quality.overdueReceivablePct <= scheme.maxOverdueReceivablePct),
      actual: args.quality.overdueReceivablePct,
      threshold: scheme.maxOverdueReceivablePct ?? null,
    },
    {
      code: "MIN_DATA_QUALITY",
      enabled: scheme.minDataQualityPct != null,
      pass: scheme.minDataQualityPct == null || (args.quality.dataQualityPct != null && args.quality.dataQualityPct >= scheme.minDataQualityPct),
      actual: args.quality.dataQualityPct,
      threshold: scheme.minDataQualityPct ?? null,
    },
  ];
  const enabledGates = gates.filter((item) => item.enabled);
  const passedGates = enabledGates.filter((item) => item.pass).length;
  const qualityScorePct = enabledGates.length ? passedGates / enabledGates.length * 100 : 100;
  const qualityPass = enabledGates.every((item) => item.pass);
  const activated = performancePct >= finite(scheme.activationThresholdPct, 100);

  let percent = finite(scheme.basePercent);
  if (scheme.tier2ThresholdPct != null && scheme.tier2Percent != null && performancePct >= scheme.tier2ThresholdPct) percent = finite(scheme.tier2Percent);
  if (scheme.tier3ThresholdPct != null && scheme.tier3Percent != null && performancePct >= scheme.tier3ThresholdPct) percent = finite(scheme.tier3Percent);

  let basisAmount = fact;
  if (scheme.basis === "ABOVE_BREAK_EVEN") basisAmount = Math.max(0, fact - Math.max(0, finite(args.breakEven)));
  if (scheme.basis === "ABOVE_TARGET") basisAmount = Math.max(0, fact - target);
  let payout = activated && qualityPass ? basisAmount * Math.max(0, percent) / 100 + Math.max(0, finite(scheme.fixedAmount)) : 0;
  if (scheme.capAmount != null) payout = Math.min(payout, Math.max(0, finite(scheme.capAmount)));

  return {
    activated,
    qualityPass,
    performancePct: Math.round(performancePct * 10) / 10,
    qualityScorePct: Math.round(qualityScorePct * 10) / 10,
    appliedPercent: percent,
    basisAmount: roundMoney(basisAmount),
    payoutAmount: roundMoney(payout),
    gates,
  };
}

export type DeviationSignal = {
  code: ManagementDeviationCode;
  severity: "INFO" | "WARNING" | "CRITICAL";
  description: string;
  impactAmount?: number | null;
  impactHours?: number | null;
  impactClients?: number | null;
  recommendedAction: string;
};

export function deriveManagementDeviations(input: {
  target: number | null;
  fact: number;
  weightedForecast: number;
  gap: number | null;
  booked: number;
  arrived: number;
  noShow: number;
  waitingApproval: number;
  waitingParts: number;
  unassignedActive: number;
  activeMechanics: number;
  averageMechanicUtilizationPct: number | null;
  freeLiftHours: number;
  warrantyRatePct: number | null;
  partsMarginPct: number | null;
  averageCheck: number | null;
  previousAverageCheck: number | null;
}) {
  const rows: DeviationSignal[] = [];
  const gap = Math.max(0, finite(input.gap));
  if (input.target && gap > 0 && input.booked === 0) rows.push({ code: "TRAFFIC_SHORTAGE", severity: "CRITICAL", description: "На тиждень немає достатнього вхідного потоку для закриття плану.", impactAmount: gap, recommendedAction: "Підсилити запис: реактивація бази, реклама, вихідні дзвінки та дозаповнення вільних слотів." });
  if (input.booked > 0 && input.arrived / input.booked < 0.7) rows.push({ code: "BOOKING_ARRIVAL_CONVERSION", severity: "WARNING", description: "Конверсія запис → приїзд нижча 70%.", impactClients: Math.max(1, Math.round(input.booked * 0.7 - input.arrived)), recommendedAction: "Підтверджувати записи, нагадувати клієнтам та швидко перепризначати звільнені слоти." });
  if (input.waitingApproval > 0) rows.push({ code: "APPROVAL_DELAY", severity: input.waitingApproval >= 3 ? "CRITICAL" : "WARNING", description: `${input.waitingApproval} авто очікують погодження/рішення.`, impactAmount: gap || null, impactClients: input.waitingApproval, recommendedAction: "Закрити калькуляцію, зв'язатися з клієнтами та зафіксувати рішення по КП." });
  if (input.waitingParts > 0) rows.push({ code: "PARTS_SHORTAGE", severity: input.waitingParts >= 3 ? "CRITICAL" : "WARNING", description: `${input.waitingParts} авто блокуються запчастинами.`, impactClients: input.waitingParts, recommendedAction: "Перевірити ETA, альтернативних постачальників та перенести ресурс на авто з готовими деталями." });
  if (input.unassignedActive > 0) rows.push({ code: "STAFF_SHORTAGE", severity: "WARNING", description: `${input.unassignedActive} активних авто без призначеного механіка.`, impactClients: input.unassignedActive, recommendedAction: "Перерозподілити авто між механіками або змінити графік зміни." });
  if (input.averageMechanicUtilizationPct != null && input.averageMechanicUtilizationPct < 55 && gap > 0) rows.push({ code: "MECHANIC_UNDERLOAD", severity: "WARNING", description: `Середнє завантаження механіків ${Math.round(input.averageMechanicUtilizationPct)}%.`, impactHours: input.freeLiftHours, impactAmount: gap, recommendedAction: "Довантажити зміну роботами з підтвердженого pipeline та вирівняти розподіл між механіками." });
  if (input.freeLiftHours >= 8 && gap > 0) rows.push({ code: "LIFT_DOWNTIME", severity: input.freeLiftHours >= 20 ? "CRITICAL" : "WARNING", description: `Доступно близько ${Math.round(input.freeLiftHours)} вільних підйомник-годин.`, impactHours: input.freeLiftHours, impactAmount: gap, recommendedAction: "Заповнити вільну потужність короткими роботами, ТО та авто без блокерів." });
  if (input.noShow > 0) rows.push({ code: "NO_SHOW", severity: input.noShow >= 3 ? "WARNING" : "INFO", description: `${input.noShow} клієнтів не прибули.`, impactClients: input.noShow, recommendedAction: "Зв'язатися з no-show та одразу запропонувати новий слот." });
  if (input.warrantyRatePct != null && input.warrantyRatePct > 5) rows.push({ code: "WARRANTY_REWORK", severity: input.warrantyRatePct > 10 ? "CRITICAL" : "WARNING", description: `Гарантійні звернення ${input.warrantyRatePct.toFixed(1)}% від закритих робіт.`, recommendedAction: "Перевірити повторні ремонти, виконавців, технологію та причини гарантій." });
  if (input.partsMarginPct != null && input.partsMarginPct < 20) rows.push({ code: "LOW_PARTS_MARGIN", severity: "WARNING", description: `Маржа деталей ${input.partsMarginPct.toFixed(1)}%.`, impactAmount: gap || null, recommendedAction: "Перевірити закупівельні ціни, націнку, знижки та альтернативи постачальників." });
  if (input.averageCheck != null && input.previousAverageCheck != null && input.previousAverageCheck > 0 && input.averageCheck < input.previousAverageCheck * 0.85) rows.push({ code: "LOW_AVERAGE_CHECK", severity: "WARNING", description: "Середній чек більш ніж на 15% нижче попереднього періоду.", impactAmount: gap || null, recommendedAction: "Перевірити повноту діагностики, допродаж рекомендованих робіт та структуру КП." });
  if (input.target && input.weightedForecast < input.target * 0.8 && rows.length === 0) rows.push({ code: "PLANNING_ERROR", severity: "WARNING", description: "Зважений прогноз суттєво нижчий за план, але очевидний операційний блокер не визначено.", impactAmount: gap, recommendedAction: "Переглянути план потужності, pipeline і коректність цільових припущень." });
  return rows;
}

export function gapClosingRecommendations(deviations: DeviationSignal[], gap: number | null, max = 5) {
  if (!gap || gap <= 0) return ["Підтверджений прогноз уже закриває план. Контролюйте якість і Cash In."];
  const severityRank = { CRITICAL: 3, WARNING: 2, INFO: 1 } as const;
  const actions = [...deviations]
    .sort((a, b) => severityRank[b.severity] - severityRank[a.severity] || (b.impactAmount || 0) - (a.impactAmount || 0))
    .map((row) => row.recommendedAction)
    .filter((value, index, array) => array.indexOf(value) === index)
    .slice(0, max);
  if (!actions.length) actions.push("Збільшити підтверджений pipeline і завантаження доступної виробничої потужності.");
  return actions;
}
