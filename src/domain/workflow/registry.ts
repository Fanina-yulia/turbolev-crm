import type { WorkflowDefinition, WorkflowStatusDefinition, WorkflowTransitionDefinition } from "./types";

const SALES = ["SALES"] as const;
const SERVICE = ["SERVICE_MANAGER"] as const;
const SERVICE_AND_MECHANIC = ["SERVICE_MANAGER", "MECHANIC"] as const;
const PARTS = ["PARTS_MANAGER"] as const;
const QC = ["QUALITY_CONTROLLER", "SERVICE_MANAGER"] as const;
const FINANCE = ["CASHIER_ACCOUNTING", "SERVICE_MANAGER"] as const;

function transition(from: string, to: string, extra: Omit<WorkflowTransitionDefinition, "from" | "to"> = {}): WorkflowTransitionDefinition {
  return { from, to, ...extra };
}

export const LEAD_CANONICAL_STATUS_CODES = [
  "NEW", "CONTACTED", "QUALIFIED", "ESTIMATE", "WAITING", "NO_ANSWER", "BOOKED", "ARRIVED", "LOST",
] as const;

export const APPOINTMENT_STATUS_CODES = [
  "BOOKED", "ARRIVED", "DIAGNOSTICS", "WAITING_PARTS_SELECTION", "WAITING_CALCULATION", "WAITING_APPROVAL",
  "WAITING_PARTS", "READY_FOR_REPAIR", "IN_REPAIR", "WAITING_QC", "READY_FOR_PICKUP", "COMPLETED",
  "WARRANTY", "PAUSED", "NO_SHOW", "CANCELLED", "RESERVE",
] as const;

export type AppointmentStatusCode = (typeof APPOINTMENT_STATUS_CODES)[number];

export const APPOINTMENT_BLOCKING_STATUS_CODES = [
  "BOOKED", "ARRIVED", "DIAGNOSTICS", "WAITING_PARTS_SELECTION", "WAITING_CALCULATION", "WAITING_APPROVAL",
  "WAITING_PARTS", "READY_FOR_REPAIR", "IN_REPAIR", "WAITING_QC", "READY_FOR_PICKUP", "WARRANTY", "PAUSED", "RESERVE",
] as const satisfies readonly AppointmentStatusCode[];

export const WORK_ORDER_STATUS_CODES = [
  "PARTS_REVIEW", "WAITING_APPROVAL", "WAITING_PARTS", "READY_FOR_REPAIR", "IN_REPAIR", "PAUSED",
  "WAITING_QC", "REWORK", "READY_FOR_PICKUP", "WAITING_PAYMENT", "CLOSED", "CANCELLED",
] as const;

export type WorkOrderStatusCode = (typeof WORK_ORDER_STATUS_CODES)[number];
export const WORK_ORDER_INITIAL_STATUS: WorkOrderStatusCode = "PARTS_REVIEW";

export const WORK_ORDER_LEGACY_PRE_CREATION_CODES = [
  "LEAD", "QUALIFICATION", "PREQUOTE", "BOOKED", "ARRIVED", "DIAGNOSTIC_REQUEST", "DIAGNOSTICS",
] as const;

const inquiryStatuses: readonly WorkflowStatusDefinition[] = [
  { code: "NEW", label: "Нове", stage: "INQUIRY", tone: "accent", sortOrder: 10, system: true, responsibleRoles: SALES },
  { code: "IN_WORK", label: "В роботі", stage: "INQUIRY", tone: "info", sortOrder: 20, system: true, responsibleRoles: SALES },
  { code: "CONVERTED", label: "Конвертовано в Lead", stage: "QUALIFICATION", tone: "success", sortOrder: 80, system: true, terminal: true, responsibleRoles: SALES },
  { code: "LINKED", label: "Прив'язано до існуючого Lead", stage: "QUALIFICATION", tone: "success", sortOrder: 90, system: true, terminal: true, responsibleRoles: SALES },
  { code: "SPAM", label: "Спам / нецільове", stage: "CLOSED", tone: "danger", sortOrder: 100, system: true, terminal: true, responsibleRoles: SALES },
];

const leadStatuses: readonly WorkflowStatusDefinition[] = [
  { code: "NEW", label: "Новий", stage: "QUALIFICATION", tone: "accent", sortOrder: 10, system: true, responsibleRoles: SALES },
  { code: "CONTACTED", label: "Контакт встановлено", stage: "QUALIFICATION", tone: "info", sortOrder: 20, system: true, responsibleRoles: SALES },
  { code: "QUALIFIED", label: "Потреба визначена", stage: "QUALIFICATION", tone: "info", sortOrder: 30, system: true, responsibleRoles: SALES },
  { code: "ESTIMATE", label: "Попередній прорахунок", stage: "ESTIMATE", tone: "warning", sortOrder: 40, system: true, responsibleRoles: SALES },
  { code: "WAITING", label: "Очікує рішення", stage: "APPROVAL", tone: "warning", sortOrder: 50, system: true, responsibleRoles: SALES },
  { code: "NO_ANSWER", label: "Не додзвонились", stage: "QUALIFICATION", tone: "warning", sortOrder: 60, system: true, responsibleRoles: SALES },
  { code: "BOOKED", label: "Записаний", stage: "BOOKING", tone: "success", sortOrder: 70, system: true, responsibleRoles: SALES },
  { code: "ARRIVED", label: "Приїхав", stage: "INTAKE", tone: "success", sortOrder: 80, system: true, terminal: true, responsibleRoles: SERVICE },
  { code: "LOST", label: "Неуспішний", stage: "CLOSED", tone: "danger", sortOrder: 90, system: true, terminal: true, responsibleRoles: SALES },
  { code: "QUALIFYING", label: "Кваліфікація (legacy)", stage: "QUALIFICATION", tone: "neutral", sortOrder: 910, system: true, legacy: true, compatibilityOnly: true },
  { code: "WARM_LEAD", label: "Теплий лід (legacy)", stage: "QUALIFICATION", tone: "neutral", sortOrder: 920, system: true, legacy: true, compatibilityOnly: true },
  { code: "REJECTED", label: "Відхилений (legacy)", stage: "CLOSED", tone: "neutral", sortOrder: 930, system: true, legacy: true, compatibilityOnly: true },
  { code: "SPAM_WRONG", label: "Спам / помилковий", stage: "CLOSED", tone: "danger", sortOrder: 940, system: true, legacy: true, compatibilityOnly: true },
  { code: "SUPPLIER_PARTNER", label: "Постачальник / партнер", stage: "CLOSED", tone: "neutral", sortOrder: 950, system: true, legacy: true, compatibilityOnly: true },
];

const appointmentStatuses: readonly WorkflowStatusDefinition[] = [
  { code: "BOOKED", label: "Записаний", stage: "BOOKING", tone: "accent", sortOrder: 10, system: true, blocksResource: true, responsibleRoles: ["SALES", "SERVICE_MANAGER"] },
  { code: "ARRIVED", label: "Приїхав", stage: "INTAKE", tone: "success", sortOrder: 20, system: true, blocksResource: true, responsibleRoles: SERVICE },
  { code: "NO_SHOW", label: "Не приїхав", stage: "CLOSED", tone: "danger", sortOrder: 80, system: true, terminal: true, responsibleRoles: SALES },
  { code: "CANCELLED", label: "Скасований", stage: "CLOSED", tone: "neutral", sortOrder: 90, system: true, terminal: true, responsibleRoles: ["SALES", "SERVICE_MANAGER"] },
  { code: "RESERVE", label: "Резерв", stage: "BOOKING", tone: "warning", sortOrder: 100, system: true, blocksResource: true, responsibleRoles: ["SALES", "SERVICE_MANAGER"] },
  { code: "DIAGNOSTICS", label: "На діагностиці", stage: "DIAGNOSTICS", tone: "info", sortOrder: 210, system: true, blocksResource: true, compatibilityOnly: true, description: "Тимчасовий bridge-статус Планувальника. Після декомпозиції джерелом правди буде DiagnosticRequest." },
  { code: "WAITING_PARTS_SELECTION", label: "Очікує підбору деталей", stage: "PARTS", tone: "warning", sortOrder: 220, system: true, blocksResource: true, compatibilityOnly: true },
  { code: "WAITING_CALCULATION", label: "Очікує калькуляції", stage: "ESTIMATE", tone: "warning", sortOrder: 230, system: true, blocksResource: true, compatibilityOnly: true },
  { code: "WAITING_APPROVAL", label: "Очікує погодження", stage: "APPROVAL", tone: "warning", sortOrder: 240, system: true, blocksResource: true, compatibilityOnly: true },
  { code: "WAITING_PARTS", label: "Очікує запчастини", stage: "PARTS", tone: "warning", sortOrder: 250, system: true, blocksResource: true, compatibilityOnly: true },
  { code: "READY_FOR_REPAIR", label: "Готовий до ремонту", stage: "READY_FOR_REPAIR", tone: "success", sortOrder: 260, system: true, blocksResource: true, compatibilityOnly: true },
  { code: "IN_REPAIR", label: "У ремонті", stage: "REPAIR", tone: "accent", sortOrder: 270, system: true, blocksResource: true, compatibilityOnly: true },
  { code: "WAITING_QC", label: "Очікує контроль якості", stage: "QUALITY_CONTROL", tone: "warning", sortOrder: 280, system: true, blocksResource: true, compatibilityOnly: true },
  { code: "READY_FOR_PICKUP", label: "Готовий до видачі", stage: "DELIVERY", tone: "success", sortOrder: 290, system: true, blocksResource: true, compatibilityOnly: true },
  { code: "COMPLETED", label: "Завершений", stage: "CLOSED", tone: "success", sortOrder: 300, system: true, terminal: true, compatibilityOnly: true },
  { code: "WARRANTY", label: "Гарантійне звернення", stage: "AFTERSALES", tone: "danger", sortOrder: 310, system: true, blocksResource: true, compatibilityOnly: true },
  { code: "PAUSED", label: "Призупинений", stage: "REPAIR", tone: "warning", sortOrder: 320, system: true, blocksResource: true, compatibilityOnly: true },
];

const diagnosticStatuses: readonly WorkflowStatusDefinition[] = [
  { code: "PENDING", label: "Очікує діагностики", stage: "DIAGNOSTICS", tone: "warning", sortOrder: 10, system: true, responsibleRoles: SERVICE_AND_MECHANIC },
  { code: "IN_PROGRESS", label: "Діагностика триває", stage: "DIAGNOSTICS", tone: "accent", sortOrder: 20, system: true, responsibleRoles: SERVICE_AND_MECHANIC },
  { code: "CONFIRMED", label: "Діагностику підтверджено", stage: "DIAGNOSTICS", tone: "success", sortOrder: 30, system: true, terminal: true, responsibleRoles: SERVICE },
  { code: "CANCELLED", label: "Діагностику скасовано", stage: "CLOSED", tone: "neutral", sortOrder: 90, system: true, terminal: true, responsibleRoles: SERVICE },
];

const workOrderStatuses: readonly WorkflowStatusDefinition[] = [
  { code: "PARTS_REVIEW", label: "Опрацювання робіт і деталей", stage: "PARTS", tone: "info", sortOrder: 10, system: true, responsibleRoles: ["SERVICE_MANAGER", "PARTS_MANAGER"] },
  { code: "WAITING_APPROVAL", label: "Очікує погодження клієнта", stage: "APPROVAL", tone: "warning", sortOrder: 20, system: true, responsibleRoles: SERVICE },
  { code: "WAITING_PARTS", label: "Очікує запчастини", stage: "PARTS", tone: "warning", sortOrder: 30, system: true, responsibleRoles: ["SERVICE_MANAGER", "PARTS_MANAGER"] },
  { code: "READY_FOR_REPAIR", label: "Готовий до ремонту", stage: "READY_FOR_REPAIR", tone: "success", sortOrder: 40, system: true, responsibleRoles: SERVICE },
  { code: "IN_REPAIR", label: "У ремонті", stage: "REPAIR", tone: "accent", sortOrder: 50, system: true, responsibleRoles: SERVICE_AND_MECHANIC },
  { code: "PAUSED", label: "Призупинений / проблема", stage: "REPAIR", tone: "warning", sortOrder: 60, system: true, responsibleRoles: SERVICE },
  { code: "WAITING_QC", label: "Очікує контроль якості", stage: "QUALITY_CONTROL", tone: "warning", sortOrder: 70, system: true, responsibleRoles: QC },
  { code: "REWORK", label: "Повернено на доопрацювання", stage: "REPAIR", tone: "danger", sortOrder: 80, system: true, responsibleRoles: ["SERVICE_MANAGER", "MECHANIC", "QUALITY_CONTROLLER"] },
  { code: "READY_FOR_PICKUP", label: "Готовий до видачі", stage: "DELIVERY", tone: "success", sortOrder: 90, system: true, responsibleRoles: SERVICE },
  { code: "WAITING_PAYMENT", label: "Очікує оплату (legacy)", stage: "PAYMENT", tone: "warning", sortOrder: 100, system: true, legacy: true, compatibilityOnly: true, responsibleRoles: FINANCE, description: "Залишено для старих ЗН. Поточний стан оплати зберігається у фінансовому контурі; фізично готове авто має статус READY_FOR_PICKUP." },
  { code: "CLOSED", label: "Закритий / виданий", stage: "CLOSED", tone: "success", sortOrder: 110, system: true, terminal: true, responsibleRoles: SERVICE },
  { code: "CANCELLED", label: "Скасований", stage: "CLOSED", tone: "neutral", sortOrder: 120, system: true, terminal: true, responsibleRoles: SERVICE },
];

const partsRequestStatuses: readonly WorkflowStatusDefinition[] = [
  { code: "NEW", label: "Потрібно опрацювати", stage: "PARTS", tone: "accent", sortOrder: 10, system: true, responsibleRoles: PARTS },
  { code: "SELECTING", label: "Підбір деталей", stage: "PARTS", tone: "info", sortOrder: 20, system: true, responsibleRoles: PARTS },
  { code: "SELECTED", label: "Деталі підібрано", stage: "PARTS", tone: "success", sortOrder: 30, system: true, responsibleRoles: PARTS },
  { code: "WAITING_APPROVAL", label: "Очікує погодження", stage: "APPROVAL", tone: "warning", sortOrder: 40, system: true, responsibleRoles: ["PARTS_MANAGER", "SERVICE_MANAGER"] },
  { code: "APPROVED", label: "Погоджено", stage: "PARTS", tone: "success", sortOrder: 50, system: true, responsibleRoles: PARTS },
  { code: "ORDER_REQUIRED", label: "Потрібно замовити", stage: "PARTS", tone: "warning", sortOrder: 60, system: true, responsibleRoles: PARTS },
  { code: "ORDERED", label: "Замовлено", stage: "PARTS", tone: "info", sortOrder: 70, system: true, responsibleRoles: PARTS },
  { code: "PARTIALLY_RECEIVED", label: "Отримано частково", stage: "PARTS", tone: "warning", sortOrder: 80, system: true, responsibleRoles: PARTS },
  { code: "RECEIVED", label: "Отримано повністю", stage: "PARTS", tone: "success", sortOrder: 90, system: true, responsibleRoles: PARTS },
  { code: "INSTALLED", label: "Встановлено", stage: "REPAIR", tone: "success", sortOrder: 100, system: true, terminal: true, responsibleRoles: ["PARTS_MANAGER", "MECHANIC"] },
  { code: "RETURNED", label: "Повернено", stage: "CLOSED", tone: "neutral", sortOrder: 110, system: true, terminal: true, responsibleRoles: PARTS },
  { code: "CANCELLED", label: "Скасовано", stage: "CLOSED", tone: "neutral", sortOrder: 120, system: true, terminal: true, responsibleRoles: PARTS },
];

const supplierOrderStatuses: readonly WorkflowStatusDefinition[] = [
  { code: "DRAFT", label: "Чернетка", stage: "PARTS", tone: "neutral", sortOrder: 10, system: true, responsibleRoles: PARTS },
  { code: "SUBMITTED", label: "Відправлено постачальнику", stage: "PARTS", tone: "accent", sortOrder: 20, system: true, responsibleRoles: PARTS },
  { code: "CONFIRMED", label: "Підтверджено постачальником", stage: "PARTS", tone: "info", sortOrder: 30, system: true, responsibleRoles: PARTS },
  { code: "PARTIAL", label: "Виконано частково", stage: "PARTS", tone: "warning", sortOrder: 40, system: true, responsibleRoles: PARTS },
  { code: "FULFILLED", label: "Виконано", stage: "PARTS", tone: "success", sortOrder: 50, system: true, terminal: true, responsibleRoles: PARTS },
  { code: "CANCELLED", label: "Скасовано", stage: "CLOSED", tone: "neutral", sortOrder: 90, system: true, terminal: true, responsibleRoles: PARTS },
  { code: "ERROR", label: "Помилка постачальника / API", stage: "PARTS", tone: "danger", sortOrder: 100, system: true, responsibleRoles: PARTS },
];

const stockReservationStatuses: readonly WorkflowStatusDefinition[] = [
  { code: "OPEN", label: "Очікує резервування", stage: "PARTS", tone: "warning", sortOrder: 10, system: true, responsibleRoles: PARTS },
  { code: "RESERVED", label: "Зарезервовано", stage: "PARTS", tone: "info", sortOrder: 20, system: true, responsibleRoles: PARTS },
  { code: "ISSUED", label: "Видано в роботу", stage: "REPAIR", tone: "accent", sortOrder: 30, system: true, responsibleRoles: ["PARTS_MANAGER", "MECHANIC"] },
  { code: "INSTALLED", label: "Встановлено", stage: "REPAIR", tone: "success", sortOrder: 40, system: true, terminal: true, responsibleRoles: ["PARTS_MANAGER", "MECHANIC"] },
  { code: "RELEASED", label: "Резерв знято", stage: "CLOSED", tone: "neutral", sortOrder: 50, system: true, terminal: true, responsibleRoles: PARTS },
  { code: "RETURNED", label: "Повернено на склад", stage: "PARTS", tone: "neutral", sortOrder: 60, system: true, terminal: true, responsibleRoles: PARTS },
];

const paymentStatuses: readonly WorkflowStatusDefinition[] = [
  { code: "UNPAID", label: "Не оплачено", stage: "PAYMENT", tone: "warning", sortOrder: 10, system: true, responsibleRoles: FINANCE },
  { code: "PARTIAL", label: "Частково оплачено", stage: "PAYMENT", tone: "warning", sortOrder: 20, system: true, responsibleRoles: FINANCE },
  { code: "PAID", label: "Оплачено", stage: "PAYMENT", tone: "success", sortOrder: 30, system: true, terminal: true, responsibleRoles: FINANCE },
  { code: "REFUND_PENDING", label: "Очікує повернення", stage: "PAYMENT", tone: "warning", sortOrder: 40, system: true, responsibleRoles: FINANCE },
  { code: "REFUNDED", label: "Повернено", stage: "CLOSED", tone: "neutral", sortOrder: 50, system: true, terminal: true, responsibleRoles: FINANCE },
  { code: "CANCELLED", label: "Скасовано", stage: "CLOSED", tone: "neutral", sortOrder: 90, system: true, terminal: true, responsibleRoles: FINANCE },
];

const qualityStatuses: readonly WorkflowStatusDefinition[] = [
  { code: "PENDING", label: "Очікує QC", stage: "QUALITY_CONTROL", tone: "warning", sortOrder: 10, system: true, responsibleRoles: QC },
  { code: "IN_PROGRESS", label: "Перевірка триває", stage: "QUALITY_CONTROL", tone: "accent", sortOrder: 20, system: true, responsibleRoles: QC },
  { code: "PASSED", label: "QC пройдено", stage: "QUALITY_CONTROL", tone: "success", sortOrder: 30, system: true, terminal: true, responsibleRoles: QC },
  { code: "FAILED", label: "QC не пройдено", stage: "QUALITY_CONTROL", tone: "danger", sortOrder: 40, system: true, responsibleRoles: QC },
  { code: "RECHECK", label: "Повторна перевірка", stage: "QUALITY_CONTROL", tone: "warning", sortOrder: 50, system: true, responsibleRoles: QC },
];

const warrantyStatuses: readonly WorkflowStatusDefinition[] = [
  { code: "OPEN", label: "Відкрите звернення", stage: "AFTERSALES", tone: "accent", sortOrder: 10, system: true, responsibleRoles: SERVICE },
  { code: "DIAGNOSTICS", label: "Гарантійна діагностика", stage: "AFTERSALES", tone: "info", sortOrder: 20, system: true, responsibleRoles: SERVICE_AND_MECHANIC },
  { code: "APPROVED", label: "Гарантію визнано", stage: "AFTERSALES", tone: "success", sortOrder: 30, system: true, responsibleRoles: ["SERVICE_MANAGER", "EXECUTIVE_DIRECTOR"] },
  { code: "REJECTED", label: "У гарантії відмовлено", stage: "CLOSED", tone: "danger", sortOrder: 40, system: true, terminal: true, responsibleRoles: ["SERVICE_MANAGER", "EXECUTIVE_DIRECTOR"] },
  { code: "IN_REPAIR", label: "Гарантійний ремонт", stage: "REPAIR", tone: "accent", sortOrder: 50, system: true, responsibleRoles: SERVICE_AND_MECHANIC },
  { code: "RESOLVED", label: "Вирішено", stage: "AFTERSALES", tone: "success", sortOrder: 60, system: true, responsibleRoles: SERVICE },
  { code: "CLOSED", label: "Закрито", stage: "CLOSED", tone: "success", sortOrder: 70, system: true, terminal: true, responsibleRoles: SERVICE },
];

const clientStatuses: readonly WorkflowStatusDefinition[] = [
  { code: "ACTIVE", label: "Активний", stage: "PROFILE", tone: "success", sortOrder: 10, system: true },
  { code: "INACTIVE", label: "Неактивний", stage: "PROFILE", tone: "neutral", sortOrder: 20, system: true },
  { code: "BLOCKED", label: "Заблокований", stage: "PROFILE", tone: "danger", sortOrder: 30, system: true },
  { code: "ARCHIVED", label: "Архів", stage: "CLOSED", tone: "neutral", sortOrder: 40, system: true, terminal: true },
];

const vehicleStatuses: readonly WorkflowStatusDefinition[] = [
  { code: "ACTIVE", label: "Активне авто", stage: "PROFILE", tone: "success", sortOrder: 10, system: true },
  { code: "SOLD", label: "Продано / змінився власник", stage: "PROFILE", tone: "neutral", sortOrder: 20, system: true },
  { code: "ARCHIVED", label: "Архів", stage: "CLOSED", tone: "neutral", sortOrder: 30, system: true, terminal: true },
];

export const WORKFLOW_DEFINITIONS: Readonly<Record<string, WorkflowDefinition>> = {
  INQUIRY: {
    entity: "INQUIRY", label: "Звернення", kind: "PROCESS",
    description: "Вхідна комунікація до кваліфікації в Lead.", statuses: inquiryStatuses,
    transitions: [transition("NEW", "IN_WORK"), transition("NEW", "CONVERTED", { actions: ["CREATE_LEAD"] }), transition("NEW", "LINKED"), transition("NEW", "SPAM"), transition("IN_WORK", "CONVERTED", { actions: ["CREATE_LEAD"] }), transition("IN_WORK", "LINKED"), transition("IN_WORK", "SPAM")],
  },
  LEAD: {
    entity: "LEAD", label: "Лід", kind: "PROCESS",
    description: "Комерційний цикл від нового звернення до запису або втрати.", statuses: leadStatuses,
    aliases: { QUALIFYING: "CONTACTED", WARM_LEAD: "WAITING", REJECTED: "LOST", SPAM_WRONG: "LOST", SUPPLIER_PARTNER: "LOST" },
    transitions: [
      transition("NEW", "CONTACTED"), transition("NEW", "NO_ANSWER"), transition("NEW", "BOOKED", { actions: ["CREATE_APPOINTMENT"] }), transition("NEW", "LOST"),
      transition("CONTACTED", "QUALIFIED"), transition("CONTACTED", "NO_ANSWER"), transition("CONTACTED", "WAITING"), transition("CONTACTED", "BOOKED", { actions: ["CREATE_APPOINTMENT"] }), transition("CONTACTED", "LOST"),
      transition("QUALIFIED", "ESTIMATE"), transition("QUALIFIED", "WAITING"), transition("QUALIFIED", "BOOKED", { actions: ["CREATE_APPOINTMENT"] }), transition("QUALIFIED", "LOST"),
      transition("ESTIMATE", "QUALIFIED"), transition("ESTIMATE", "WAITING"), transition("ESTIMATE", "BOOKED", { actions: ["CREATE_APPOINTMENT"] }), transition("ESTIMATE", "LOST"),
      transition("WAITING", "CONTACTED"), transition("WAITING", "ESTIMATE"), transition("WAITING", "BOOKED", { actions: ["CREATE_APPOINTMENT"] }), transition("WAITING", "LOST"),
      transition("NO_ANSWER", "CONTACTED"), transition("NO_ANSWER", "LOST"),
      transition("BOOKED", "ARRIVED"), transition("BOOKED", "CONTACTED"), transition("BOOKED", "LOST"),
    ],
  },
  CLIENT: { entity: "CLIENT", label: "Клієнт", kind: "PROFILE", description: "Довгоживучий профіль клієнта; сервісні стани сюди не дублюються.", statuses: clientStatuses, transitions: [transition("ACTIVE", "INACTIVE"), transition("INACTIVE", "ACTIVE"), transition("ACTIVE", "BLOCKED"), transition("BLOCKED", "ACTIVE"), transition("ACTIVE", "ARCHIVED"), transition("INACTIVE", "ARCHIVED")] },
  VEHICLE: { entity: "VEHICLE", label: "Автомобіль", kind: "PROFILE", description: "Довгоживучий профіль авто. Поточний сервісний стан має бути похідним від активного Appointment/WorkOrder, а не зберігатися тут вручну.", statuses: vehicleStatuses, transitions: [transition("ACTIVE", "SOLD"), transition("SOLD", "ACTIVE"), transition("ACTIVE", "ARCHIVED"), transition("SOLD", "ARCHIVED")] },
  APPOINTMENT: {
    entity: "APPOINTMENT", label: "Запис / Планувальник", kind: "PROCESS",
    description: "Плановий запис. Канонічна зона відповідальності: BOOKED, ARRIVED, NO_SHOW, CANCELLED, RESERVE; downstream-статуси тимчасово залишені для сумісності Planner v2.", statuses: appointmentStatuses,
    transitions: [
      transition("RESERVE", "BOOKED"), transition("RESERVE", "CANCELLED"),
      transition("BOOKED", "ARRIVED", { actions: ["UPDATE_LEAD_ARRIVED", "SET_VEHICLE_LOCATION_RECEPTION", "CREATE_DIAGNOSTIC_REQUEST"] }), transition("BOOKED", "NO_SHOW"), transition("BOOKED", "CANCELLED"),
      transition("ARRIVED", "DIAGNOSTICS"), transition("ARRIVED", "CANCELLED"),
      transition("DIAGNOSTICS", "WAITING_PARTS_SELECTION"), transition("DIAGNOSTICS", "WAITING_CALCULATION"),
      transition("WAITING_PARTS_SELECTION", "WAITING_CALCULATION"), transition("WAITING_CALCULATION", "WAITING_APPROVAL"),
      transition("WAITING_APPROVAL", "WAITING_PARTS"), transition("WAITING_APPROVAL", "READY_FOR_REPAIR"),
      transition("WAITING_PARTS", "READY_FOR_REPAIR"), transition("READY_FOR_REPAIR", "IN_REPAIR"),
      transition("IN_REPAIR", "WAITING_QC"), transition("IN_REPAIR", "WAITING_PARTS"), transition("IN_REPAIR", "PAUSED"),
      transition("PAUSED", "IN_REPAIR"), transition("PAUSED", "WAITING_PARTS"),
      transition("WAITING_QC", "READY_FOR_PICKUP"), transition("READY_FOR_PICKUP", "COMPLETED", { actions: ["CLOSE_APPOINTMENT"] }),
      transition("COMPLETED", "WARRANTY"), transition("WARRANTY", "IN_REPAIR"),
    ],
  },
  DIAGNOSTIC: {
    entity: "DIAGNOSTIC", label: "Діагностика", kind: "PROCESS", description: "Технічне підтвердження дефектів до створення WorkOrder.", statuses: diagnosticStatuses,
    transitions: [transition("PENDING", "IN_PROGRESS"), transition("PENDING", "CANCELLED"), transition("IN_PROGRESS", "CONFIRMED", { actions: ["CREATE_WORK_ORDER"] }), transition("IN_PROGRESS", "CANCELLED")],
  },
  WORK_ORDER: {
    entity: "WORK_ORDER", label: "Замовлення-наряд", kind: "PROCESS", description: "Фактичний виробничий контур після підтвердженої діагностики.", statuses: workOrderStatuses,
    aliases: { QUOTE_DRAFT: "WAITING_APPROVAL", CLIENT_APPROVAL: "WAITING_APPROVAL", PARTS_PAYMENT: "WAITING_PARTS", PARTS_ORDERED: "WAITING_PARTS", REPAIR: "IN_REPAIR", QUALITY_CONTROL: "WAITING_QC", READY: "READY_FOR_PICKUP", WORK_PAYMENT: "READY_FOR_PICKUP", PAID: "READY_FOR_PICKUP", AFTERSALES: "CLOSED" },
    transitions: [
      transition("PARTS_REVIEW", "WAITING_APPROVAL", { actions: ["CREATE_ESTIMATE"] }), transition("PARTS_REVIEW", "WAITING_PARTS", { actions: ["OPEN_PARTS_REQUEST"] }), transition("PARTS_REVIEW", "READY_FOR_REPAIR"), transition("PARTS_REVIEW", "PAUSED"), transition("PARTS_REVIEW", "CANCELLED"),
      transition("WAITING_APPROVAL", "PARTS_REVIEW"), transition("WAITING_APPROVAL", "WAITING_PARTS", { actions: ["OPEN_PARTS_REQUEST"] }), transition("WAITING_APPROVAL", "READY_FOR_REPAIR"), transition("WAITING_APPROVAL", "PAUSED"), transition("WAITING_APPROVAL", "CANCELLED"),
      transition("WAITING_PARTS", "PARTS_REVIEW"), transition("WAITING_PARTS", "READY_FOR_REPAIR"), transition("WAITING_PARTS", "PAUSED"), transition("WAITING_PARTS", "CANCELLED"),
      transition("READY_FOR_REPAIR", "IN_REPAIR", { gates: ["ESTIMATE_APPROVED_BEFORE_REPAIR", "REQUIRED_PARTS_READY_BEFORE_REPAIR", "MECHANIC_ASSIGNED_BEFORE_REPAIR"] }), transition("READY_FOR_REPAIR", "PAUSED"), transition("READY_FOR_REPAIR", "CANCELLED"),
      transition("IN_REPAIR", "WAITING_QC", { actions: ["CREATE_QC_TASK", "SET_VEHICLE_LOCATION_QC"] }), transition("IN_REPAIR", "WAITING_PARTS"), transition("IN_REPAIR", "WAITING_APPROVAL", { gates: ["ADDITIONAL_WORK_REQUIRES_APPROVAL"] }), transition("IN_REPAIR", "PAUSED"),
      transition("PAUSED", "PARTS_REVIEW"), transition("PAUSED", "WAITING_APPROVAL"), transition("PAUSED", "WAITING_PARTS"), transition("PAUSED", "READY_FOR_REPAIR"), transition("PAUSED", "IN_REPAIR"),
      transition("WAITING_QC", "READY_FOR_PICKUP", { gates: ["QC_PASSED_BEFORE_READY"], actions: ["SET_VEHICLE_LOCATION_READY"] }), transition("WAITING_QC", "REWORK"),
      transition("REWORK", "IN_REPAIR"),
      transition("READY_FOR_PICKUP", "CLOSED", { gates: ["QC_PASSED_BEFORE_READY", "ZERO_BALANCE_BEFORE_DELIVERY"], actions: ["CLOSE_WORK_ORDER"] }),
      transition("WAITING_PAYMENT", "READY_FOR_PICKUP"), transition("WAITING_PAYMENT", "CLOSED", { gates: ["ZERO_BALANCE_BEFORE_DELIVERY"], actions: ["CLOSE_WORK_ORDER"] }),
    ],
  },
  PARTS_REQUEST: {
    entity: "PARTS_REQUEST", label: "Запит на деталі", kind: "PROCESS", description: "Підбір, погодження, замовлення, отримання та встановлення потрібних деталей.", statuses: partsRequestStatuses,
    transitions: [transition("NEW", "SELECTING"), transition("SELECTING", "SELECTED"), transition("SELECTING", "CANCELLED"), transition("SELECTED", "WAITING_APPROVAL"), transition("SELECTED", "APPROVED"), transition("WAITING_APPROVAL", "APPROVED"), transition("WAITING_APPROVAL", "SELECTING"), transition("WAITING_APPROVAL", "CANCELLED"), transition("APPROVED", "ORDER_REQUIRED"), transition("APPROVED", "RECEIVED"), transition("ORDER_REQUIRED", "ORDERED", { gates: ["PARTS_PAYMENT_BEFORE_ORDER"] }), transition("ORDERED", "PARTIALLY_RECEIVED"), transition("ORDERED", "RECEIVED"), transition("PARTIALLY_RECEIVED", "RECEIVED"), transition("RECEIVED", "INSTALLED"), transition("RECEIVED", "RETURNED")],
  },
  SUPPLIER_ORDER: {
    entity: "SUPPLIER_ORDER", label: "Замовлення постачальнику", kind: "PROCESS", description: "Життєвий цикл зовнішнього замовлення постачальнику.", statuses: supplierOrderStatuses,
    transitions: [transition("DRAFT", "SUBMITTED", { gates: ["PARTS_PAYMENT_BEFORE_ORDER"] }), transition("DRAFT", "CANCELLED"), transition("SUBMITTED", "CONFIRMED"), transition("SUBMITTED", "ERROR"), transition("SUBMITTED", "CANCELLED"), transition("CONFIRMED", "PARTIAL"), transition("CONFIRMED", "FULFILLED"), transition("CONFIRMED", "ERROR"), transition("PARTIAL", "FULFILLED"), transition("PARTIAL", "ERROR"), transition("ERROR", "SUBMITTED"), transition("ERROR", "CANCELLED")],
  },
  STOCK_RESERVATION: { entity: "STOCK_RESERVATION", label: "Резерв складу", kind: "PROCESS", description: "Резерв конкретних деталей під конкретний ремонт; не підміняє кількісний складський облік.", statuses: stockReservationStatuses, transitions: [transition("OPEN", "RESERVED"), transition("OPEN", "RELEASED"), transition("RESERVED", "ISSUED"), transition("RESERVED", "RELEASED"), transition("ISSUED", "INSTALLED"), transition("ISSUED", "RETURNED")] },
  PAYMENT: { entity: "PAYMENT", label: "Оплата", kind: "PROCESS", description: "Стан розрахунків за конкретним фінансовим зобов'язанням.", statuses: paymentStatuses, transitions: [transition("UNPAID", "PARTIAL"), transition("UNPAID", "PAID"), transition("UNPAID", "CANCELLED"), transition("PARTIAL", "PAID"), transition("PARTIAL", "REFUND_PENDING"), transition("PAID", "REFUND_PENDING"), transition("REFUND_PENDING", "REFUNDED")] },
  QUALITY_CONTROL: { entity: "QUALITY_CONTROL", label: "Контроль якості", kind: "PROCESS", description: "Незалежний контроль завершеного ремонту до готовності автомобіля.", statuses: qualityStatuses, transitions: [transition("PENDING", "IN_PROGRESS"), transition("IN_PROGRESS", "PASSED"), transition("IN_PROGRESS", "FAILED"), transition("FAILED", "RECHECK"), transition("RECHECK", "IN_PROGRESS")] },
  WARRANTY: { entity: "WARRANTY", label: "Гарантійне звернення", kind: "PROCESS", description: "Окремий післяпродажний цикл; гарантія не є звичайним статусом WorkOrder.", statuses: warrantyStatuses, transitions: [transition("OPEN", "DIAGNOSTICS"), transition("DIAGNOSTICS", "APPROVED"), transition("DIAGNOSTICS", "REJECTED"), transition("APPROVED", "IN_REPAIR"), transition("IN_REPAIR", "RESOLVED"), transition("RESOLVED", "CLOSED")] },
};
