import type {
  AttentionCenterResult,
  AttentionCategory,
  AttentionLevel,
  AttentionSignal,
} from "@/src/services/attention-center.service";

const DAY_MINUTES = 24 * 60;
const HISTORY_MINUTES = 7 * DAY_MINUTES;

type IncidentClass = "OPERATIONS" | "DATA_QUALITY" | "DATA_CLEANUP";

type RelatedSignal = {
  id: string;
  title: string;
  reason: string;
  category: AttentionCategory;
  level: AttentionLevel;
  bucket: AttentionSignal["bucket"];
  dueAt: string | null;
  isOverdue: boolean;
  overdueMinutes: number;
};

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function metadataText(signal: AttentionSignal, key: string) {
  return text(signal.metadata?.[key]);
}

function actionParam(signal: AttentionSignal, key: string) {
  return text(signal.action?.params?.[key]);
}

function isVehicleWorkflow(signal: AttentionSignal) {
  return ["SERVICE", "DIAGNOSTICS", "PARTS", "QUALITY", "WARRANTY"].includes(signal.category);
}

function incidentKey(signal: AttentionSignal) {
  if (!isVehicleWorkflow(signal)) return `signal:${signal.id}`;

  const appointmentId =
    metadataText(signal, "appointmentId")
    || actionParam(signal, "appointmentId")
    || ((signal.sourceType === "APPOINTMENT" || signal.sourceType.startsWith("WALK_IN_")) ? signal.sourceId : null);
  if (appointmentId) return `appointment:${appointmentId}`;

  const workOrderId = metadataText(signal, "workOrderId") || actionParam(signal, "workOrderId");
  if (workOrderId) return `work-order:${workOrderId}`;

  const diagnosticId =
    metadataText(signal, "diagnosticId")
    || actionParam(signal, "diagnosticId")
    || (signal.sourceType === "DIAGNOSTIC" ? signal.sourceId : null);
  if (diagnosticId) return `diagnostic:${diagnosticId}`;

  if (signal.taskId) return `task:${signal.taskId}`;
  return `signal:${signal.id}`;
}

function combinedText(signal: AttentionSignal) {
  return `${signal.title} ${signal.reason} ${metadataText(signal, "attentionReason") || ""}`.toLocaleLowerCase("uk-UA");
}

function stageRank(signal: AttentionSignal) {
  const value = combinedText(signal);
  if (/не підтверджено приїзд|не приїхав|no[- ]?show|booked/.test(value)) return 10;
  if (/механік|постом|сервісний пост/.test(value)) return 20;
  if (/діагност|inspection|diagnostic/.test(value)) return 30;
  if (/кошторис|розрахунк|estimate|calculation/.test(value)) return 40;
  if (/погоджен|approval/.test(value)) return 50;
  if (/запчаст|parts/.test(value)) return 60;
  if (/ремонт|repair/.test(value)) return 70;
  if (/контроль якості|\bqc\b/.test(value)) return 80;
  if (/оплат|payment/.test(value)) return 90;
  if (/видач|pickup/.test(value)) return 100;
  return 55;
}

function levelRank(level: AttentionLevel) {
  return level === "CRITICAL" ? 0 : level === "HIGH" ? 1 : level === "MEDIUM" ? 2 : 3;
}

function rootSignal(items: AttentionSignal[]) {
  return [...items].sort((a, b) => {
    const stage = stageRank(a) - stageRank(b);
    if (stage) return stage;
    const level = levelRank(a.level) - levelRank(b.level);
    if (level) return level;
    if (a.bucket !== b.bucket) return a.bucket === "ACTION" ? -1 : b.bucket === "ACTION" ? 1 : 0;
    return b.overdueMinutes - a.overdueMinutes;
  })[0];
}

function labelOf(signal: AttentionSignal) {
  const plate = metadataText(signal, "plateNumber");
  if (plate) return plate;
  const fromTitle = signal.title.includes(":") ? signal.title.split(":")[0]?.trim() : null;
  if (fromTitle && fromTitle.length <= 30) return fromTitle;
  const vehicle = metadataText(signal, "vehicleLabel");
  return vehicle || signal.counterparty || "Авто";
}

function hasArrivalPair(items: AttentionSignal[]) {
  const values = items.map(combinedText);
  return values.some((v) => v.includes("не підтверджено приїзд"))
    && values.some((v) => v.includes("booked"));
}

function hasContradictoryStages(items: AttentionSignal[]) {
  const hasBooked = items.some((item) => /booked|не підтверджено приїзд|не приїхав/.test(combinedText(item)));
  const hasDownstream = items.some((item) => stageRank(item) >= 30 && stageRank(item) <= 100);
  return hasBooked && hasDownstream;
}

function latestTimestamp(items: AttentionSignal[]) {
  return Math.max(...items.map((item) => new Date(item.occurredAt).getTime()).filter(Number.isFinite));
}

function incidentClass(items: AttentionSignal[], now: Date): IncidentClass {
  if (hasContradictoryStages(items)) return "DATA_QUALITY";
  const latest = latestTimestamp(items);
  const old = Number.isFinite(latest) && now.getTime() - latest > 7 * 86_400_000;
  const money = items.some((item) => (item.amount || 0) > 0);
  const protectedCategory = items.some((item) => ["FINANCE", "PAYROLL", "WARRANTY"].includes(item.category));
  return old && !money && !protectedCategory ? "DATA_CLEANUP" : "OPERATIONS";
}

function ownerRole(root: AttentionSignal) {
  const value = combinedText(root);
  if (root.category === "DIAGNOSTICS" || /діагност/.test(value)) return "Сервіс-менеджер";
  if (root.category === "PARTS") return "Запчастини";
  if (root.category === "SUPPLIERS") return "Закупівлі";
  if (root.category === "FINANCE" || root.category === "PAYROLL") return "Фінанси";
  if (root.category === "POSTS") return "Керівник СТО";
  if (root.category === "SERVICE") return "Сервіс-менеджер";
  return "Відповідальний";
}

function stageLabel(root: AttentionSignal) {
  const rank = stageRank(root);
  if (rank <= 10) return "Запис / приїзд";
  if (rank <= 20) return "Приймання";
  if (rank <= 30) return "Діагностика";
  if (rank <= 40) return "Розрахунок";
  if (rank <= 50) return "Погодження";
  if (rank <= 60) return "Запчастини";
  if (rank <= 70) return "Ремонт";
  if (rank <= 80) return "Контроль якості";
  if (rank <= 90) return "Оплата";
  return "Видача";
}

function friendlyTitle(root: AttentionSignal, items: AttentionSignal[], klass: IncidentClass) {
  const label = labelOf(root);
  if (klass === "DATA_QUALITY") return `${label}: суперечливий стан візиту`;
  if (hasArrivalPair(items)) return `${label}: не визначено результат запланованого приїзду`;

  const value = combinedText(root);
  if (value.includes("діагностична карта на перевірці")) return `${label}: ДК очікує перевірки сервіс-менеджером`;
  if (value.includes("час запису минув") && value.includes("booked")) return `${label}: не визначено результат запланованого приїзду`;
  if (value.includes("авто вийшло за плановий час")) return `${label}: візит вийшов за плановий час`;
  return root.title;
}

function businessScore(items: AttentionSignal[], klass: IncidentClass) {
  if (klass === "DATA_CLEANUP") return 5;
  let score = 0;
  const best = rootSignal(items);
  score += best.level === "CRITICAL" ? 35 : best.level === "HIGH" ? 25 : best.level === "MEDIUM" ? 15 : 5;
  score += items.some((item) => item.bucket === "ACTION") ? 25 : items.some((item) => item.bucket === "WAITING") ? 10 : 0;
  score += items.some((item) => item.category === "DIAGNOSTICS") ? 15 : 0;
  score += items.some((item) => /оплат|payment/.test(combinedText(item))) ? 15 : 0;
  score += items.some((item) => /механік|постом/.test(combinedText(item))) ? 10 : 0;
  score += items.some((item) => (item.amount || 0) > 0) ? 20 : 0;
  score += items.some((item) => item.isOverdue && item.overdueMinutes <= DAY_MINUTES) ? 15 : 0;
  score += klass === "DATA_QUALITY" ? 25 : 0;
  return Math.min(100, score);
}

function priorityReasons(items: AttentionSignal[], klass: IncidentClass) {
  const reasons: string[] = [];
  if (klass === "DATA_QUALITY") reasons.push("статуси процесу суперечать один одному");
  if (klass === "DATA_CLEANUP") reasons.push("процес не оновлювався понад 7 днів");
  if (items.some((item) => item.bucket === "ACTION")) reasons.push("потрібна дія співробітника");
  if (items.some((item) => item.category === "DIAGNOSTICS")) reasons.push("затримка блокує наступний етап після діагностики");
  if (items.some((item) => /оплат|payment/.test(combinedText(item)))) reasons.push("є фінансовий етап");
  if (items.some((item) => /механік|постом/.test(combinedText(item)))) reasons.push("можливий простій виробництва");
  return reasons.slice(0, 3);
}

function makeIncident(items: AttentionSignal[], key: string, now: Date): AttentionSignal {
  const root = rootSignal(items);
  const klass = incidentClass(items, now);
  const related: RelatedSignal[] = items.map((item) => ({
    id: item.id,
    title: item.title,
    reason: item.reason,
    category: item.category,
    level: item.level,
    bucket: item.bucket,
    dueAt: item.dueAt,
    isOverdue: item.isOverdue,
    overdueMinutes: item.overdueMinutes,
  }));

  const oldestDue = items
    .map((item) => item.dueAt)
    .filter((value): value is string => Boolean(value))
    .sort((a, b) => new Date(a).getTime() - new Date(b).getTime())[0] || root.dueAt;
  const maxOverdue = Math.max(0, ...items.map((item) => item.overdueMinutes));
  const anyToday = items.some((item) => item.isToday);
  const actionRoot = items.find((item) => item.bucket === "ACTION" && item.action) || root;
  const score = businessScore(items, klass);

  const level: AttentionLevel = klass === "DATA_CLEANUP"
    ? "MEDIUM"
    : items.map((item) => item.level).sort((a, b) => levelRank(a) - levelRank(b))[0];
  const bucket = klass === "DATA_CLEANUP"
    ? "MONITORING"
    : items.some((item) => item.bucket === "ACTION")
      ? "ACTION"
      : items.some((item) => item.bucket === "WAITING")
        ? "WAITING"
        : "MONITORING";

  const reason = klass === "DATA_QUALITY"
    ? "CRM бачить події з різних етапів одного візиту, які не узгоджуються між собою. Перевірте фактичний стан і залиште один коректний етап."
    : klass === "DATA_CLEANUP"
      ? "Старий незакритий процес не повинен конкурувати з поточними проблемами. Перевірте фактичний результат і закрийте або виправте статус."
      : hasArrivalPair(items)
        ? "Час запису минув, але результат приїзду не зафіксовано. Вкажіть: приїхав, не приїхав, перенесено або скасовано."
        : root.reason;

  return {
    ...root,
    id: `incident:${key}`,
    title: friendlyTitle(root, items, klass),
    reason,
    level,
    bucket,
    dueAt: oldestDue,
    isOverdue: items.some((item) => item.isOverdue),
    overdueMinutes: maxOverdue,
    isToday: anyToday,
    action: actionRoot.action,
    metadata: {
      ...root.metadata,
      incident: true,
      incidentKey: key,
      incidentClass: klass,
      stageLabel: stageLabel(root),
      ownerRole: ownerRole(root),
      businessScore: score,
      priorityReasons: priorityReasons(items, klass),
      recommendedAction: actionRoot.action?.label || null,
      relatedSignalCount: items.length,
      relatedSignalIds: items.map((item) => item.id),
      relatedReasons: items.map((item) => item.reason),
      relatedSignals: related,
      latestActivityAt: new Date(latestTimestamp(items)).toISOString(),
      historical: klass === "DATA_CLEANUP",
      dataQualityIssue: klass === "DATA_QUALITY",
    },
  };
}

function categoriesOf(signals: AttentionSignal[]) {
  const categories: AttentionCenterResult["categories"] = {
    COMMUNICATIONS: 0,
    SERVICE: 0,
    DIAGNOSTICS: 0,
    PARTS: 0,
    SUPPLIERS: 0,
    FINANCE: 0,
    PAYROLL: 0,
    POSTS: 0,
    QUALITY: 0,
    WARRANTY: 0,
    MANUAL: 0,
  };
  for (const signal of signals) categories[signal.category] += 1;
  return categories;
}

function classRank(signal: AttentionSignal) {
  const value = metadataText(signal, "incidentClass");
  return value === "OPERATIONS" ? 0 : value === "DATA_QUALITY" ? 1 : value === "DATA_CLEANUP" ? 2 : 0;
}

function scoreOf(signal: AttentionSignal) {
  const value = Number(signal.metadata?.businessScore ?? 0);
  return Number.isFinite(value) ? value : 0;
}

export function finalizeAttentionIncidents(center: AttentionCenterResult, now = new Date()): AttentionCenterResult {
  const rawSignals = center.signals.length;
  const groups = new Map<string, AttentionSignal[]>();

  for (const signal of center.signals) {
    const key = incidentKey(signal);
    const current = groups.get(key);
    if (current) current.push(signal);
    else groups.set(key, [signal]);
  }

  const incidents = [...groups.entries()].map(([key, items]) => {
    if (items.length === 1 && !isVehicleWorkflow(items[0])) {
      return {
        ...items[0],
        metadata: {
          ...items[0].metadata,
          incident: false,
          relatedSignalCount: 1,
          businessScore: 0,
        },
      };
    }
    return makeIncident(items, key, now);
  });

  incidents.sort((a, b) => {
    const klass = classRank(a) - classRank(b);
    if (klass) return klass;
    const score = scoreOf(b) - scoreOf(a);
    if (score) return score;
    const level = levelRank(a.level) - levelRank(b.level);
    if (level) return level;
    if (a.isOverdue !== b.isOverdue) return a.isOverdue ? -1 : 1;
    return b.overdueMinutes - a.overdueMinutes;
  });

  return {
    ...center,
    signals: incidents,
    categories: categoriesOf(incidents),
    summary: {
      total: incidents.length,
      critical: incidents.filter((item) => item.level === "CRITICAL").length,
      overdue: incidents.filter((item) => item.isOverdue).length,
      action: incidents.filter((item) => item.bucket === "ACTION").length,
      waiting: incidents.filter((item) => item.bucket === "WAITING").length,
      today: incidents.filter((item) => item.isToday).length,
    },
    generatedAt: now.toISOString(),
    // Kept in every response for audit/debug without changing the public UI contract.
    rawSignalCount: rawSignals,
  } as AttentionCenterResult & { rawSignalCount: number };
}
