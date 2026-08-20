import type { BlockerCode, HardGateCode, VehicleLocationCode, WorkflowActionCode, WorkflowRole, WorkflowStage } from "./types";

export const STATUS_ARCHITECTURE_VERSION = "1.1.0" as const;

export const MASTER_SERVICE_STAGES: ReadonlyArray<{ code: WorkflowStage; label: string; order: number }> = [
  { code: "INQUIRY", label: "Звернення", order: 10 },
  { code: "QUALIFICATION", label: "Кваліфікація", order: 20 },
  { code: "BOOKING", label: "Запис", order: 30 },
  { code: "INTAKE", label: "Приймання", order: 40 },
  { code: "DIAGNOSTICS", label: "Діагностика", order: 50 },
  { code: "ESTIMATE", label: "Кошторис", order: 60 },
  { code: "APPROVAL", label: "Погодження", order: 70 },
  { code: "PARTS", label: "Запчастини", order: 80 },
  { code: "READY_FOR_REPAIR", label: "Готовий до ремонту", order: 90 },
  { code: "REPAIR", label: "Ремонт", order: 100 },
  { code: "QUALITY_CONTROL", label: "Контроль якості", order: 110 },
  { code: "PAYMENT", label: "Оплата", order: 120 },
  { code: "DELIVERY", label: "Видача", order: 130 },
  { code: "AFTERSALES", label: "Післяпродажний / гарантійний контур", order: 140 },
  { code: "PROFILE", label: "Профіль", order: 900 },
  { code: "CLOSED", label: "Закрито", order: 990 },
];

export const WORKFLOW_ROLE_LABELS: Record<WorkflowRole, string> = {
  OWNER: "Власник",
  EXECUTIVE_DIRECTOR: "Виконавчий директор",
  HEAD_OF_SALES: "Керівник відділу продажів",
  SALES: "Продавець",
  SERVICE_ADVISOR: "Сервіс-менеджер",
  PARTS_SPECIALIST: "Підборщик запчастин",
  STATION_MANAGER: "Завідувач станцією",
  SHIFT_MASTER: "Майстер зміни",
  MECHANIC: "Автомеханік",
  ACCOUNTANT: "Бухгалтер / каса",
  ADMINISTRATOR: "Адміністратор",
  SERVICE_MANAGER: "Сервіс-менеджмент (legacy)",
  PARTS_MANAGER: "Запчастини (legacy)",
  QUALITY_CONTROLLER: "Контроль якості (legacy)",
  CASHIER_ACCOUNTING: "Каса / бухгалтерія (legacy)",
  ADMIN: "Адміністратор CRM (legacy)",
};

/** Roles that may be selected in current workflow responsibility settings. */
export const OPERATIONAL_WORKFLOW_ROLE_LABELS = {
  OWNER: WORKFLOW_ROLE_LABELS.OWNER,
  EXECUTIVE_DIRECTOR: WORKFLOW_ROLE_LABELS.EXECUTIVE_DIRECTOR,
  HEAD_OF_SALES: WORKFLOW_ROLE_LABELS.HEAD_OF_SALES,
  SALES: WORKFLOW_ROLE_LABELS.SALES,
  SERVICE_ADVISOR: WORKFLOW_ROLE_LABELS.SERVICE_ADVISOR,
  PARTS_SPECIALIST: WORKFLOW_ROLE_LABELS.PARTS_SPECIALIST,
  STATION_MANAGER: WORKFLOW_ROLE_LABELS.STATION_MANAGER,
  SHIFT_MASTER: WORKFLOW_ROLE_LABELS.SHIFT_MASTER,
  MECHANIC: WORKFLOW_ROLE_LABELS.MECHANIC,
  ACCOUNTANT: WORKFLOW_ROLE_LABELS.ACCOUNTANT,
  ADMINISTRATOR: WORKFLOW_ROLE_LABELS.ADMINISTRATOR,
} as const;

export const BLOCKER_LABELS: Record<BlockerCode, string> = {
  CUSTOMER_REPLY: "Очікуємо відповідь клієнта",
  CUSTOMER_APPROVAL: "Очікуємо погодження клієнта",
  CUSTOMER_PAYMENT: "Очікуємо оплату клієнта",
  PARTS_SELECTION: "Очікуємо підбір деталей",
  PARTS_PAYMENT: "Очікуємо оплату деталей",
  SUPPLIER_CONFIRMATION: "Очікуємо підтвердження постачальника",
  SUPPLIER_DELIVERY: "Очікуємо доставку постачальника",
  PARTS_MISSING: "Не вистачає деталей",
  POST_UNAVAILABLE: "Немає вільного поста",
  MECHANIC_UNAVAILABLE: "Немає доступного автомеханіка",
  TECHNICAL_DECISION: "Очікуємо технічне рішення",
  THIRD_PARTY_SERVICE: "Очікуємо сторонню послугу",
  QC_REWORK: "Потрібне доопрацювання після QC",
  INTERNAL_HOLD: "Внутрішня пауза",
  OTHER: "Інша причина",
};

export const VEHICLE_LOCATION_LABELS: Record<VehicleLocationCode, string> = {
  OUTSIDE: "Не на СТО",
  RECEPTION: "Зона приймання",
  QUEUE: "Черга",
  POST: "Ремонтний пост",
  PARKING: "Стоянка",
  WAITING_PARTS: "Зона очікування деталей",
  QUALITY_CONTROL: "Контроль якості",
  READY_ZONE: "Готові до видачі",
  DELIVERED: "Видано клієнту",
};

export const HARD_GATE_LABELS: Record<HardGateCode, string> = {
  WORK_ORDER_AFTER_CONFIRMED_DIAGNOSTICS: "ЗН створюється тільки після підтвердженої діагностики",
  ESTIMATE_APPROVED_BEFORE_REPAIR: "Ремонт тільки після погодженого кошторису",
  PARTS_PAYMENT_BEFORE_ORDER: "Замовлення деталей тільки після підтвердженої оплати, якщо вона потрібна",
  REQUIRED_PARTS_READY_BEFORE_REPAIR: "Для старту ремонту всі обов'язкові деталі мають бути доступні",
  MECHANIC_ASSIGNED_BEFORE_REPAIR: "Для старту ремонту має бути призначений автомеханік",
  ADDITIONAL_WORK_REQUIRES_APPROVAL: "Додаткові платні роботи потребують нового погодження",
  QC_PASSED_BEFORE_READY: "Після ремонту автомобіль має пройти контроль якості",
  ZERO_BALANCE_BEFORE_DELIVERY: "Статус «Готовий до видачі» доступний тільки після повної оплати",
};

export const WORKFLOW_ACTION_LABELS: Record<WorkflowActionCode, string> = {
  CREATE_LEAD: "Створити Lead",
  CREATE_APPOINTMENT: "Створити запис у Планувальнику",
  UPDATE_LEAD_ARRIVED: "Позначити Lead як ARRIVED",
  SET_VEHICLE_LOCATION_RECEPTION: "Перемістити авто в зону приймання",
  CREATE_DIAGNOSTIC_REQUEST: "Створити DiagnosticRequest",
  CREATE_WORK_ORDER: "Створити WorkOrder",
  CREATE_ESTIMATE: "Створити кошторис",
  OPEN_PARTS_REQUEST: "Відкрити запит на деталі",
  CREATE_QC_TASK: "Створити завдання контролю якості",
  SET_VEHICLE_LOCATION_QC: "Перемістити авто в зону QC",
  SET_VEHICLE_LOCATION_READY: "Перемістити авто в зону готових до видачі",
  CLOSE_APPOINTMENT: "Завершити запис",
  CLOSE_WORK_ORDER: "Закрити WorkOrder",
};

export const HARD_GATE_CODES = {
  WORK_ORDER_AFTER_CONFIRMED_DIAGNOSTICS: "WORK_ORDER_AFTER_CONFIRMED_DIAGNOSTICS",
  ESTIMATE_APPROVED_BEFORE_REPAIR: "ESTIMATE_APPROVED_BEFORE_REPAIR",
  PARTS_PAYMENT_BEFORE_ORDER: "PARTS_PAYMENT_BEFORE_ORDER",
  REQUIRED_PARTS_READY_BEFORE_REPAIR: "REQUIRED_PARTS_READY_BEFORE_REPAIR",
  MECHANIC_ASSIGNED_BEFORE_REPAIR: "MECHANIC_ASSIGNED_BEFORE_REPAIR",
  ADDITIONAL_WORK_REQUIRES_APPROVAL: "ADDITIONAL_WORK_REQUIRES_APPROVAL",
  QC_PASSED_BEFORE_READY: "QC_PASSED_BEFORE_READY",
  ZERO_BALANCE_BEFORE_DELIVERY: "ZERO_BALANCE_BEFORE_DELIVERY",
} as const satisfies Record<HardGateCode, HardGateCode>;
