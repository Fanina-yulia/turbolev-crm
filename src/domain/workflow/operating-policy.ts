import type {
  WorkflowDefinition,
  WorkflowRole,
  WorkflowStatusDefinition,
  WorkflowTransitionDefinition,
} from "./types";

const SALES = ["SALES"] as const satisfies readonly WorkflowRole[];
const SALES_SERVICE = ["SALES", "SERVICE_ADVISOR"] as const satisfies readonly WorkflowRole[];
const SERVICE = ["SERVICE_ADVISOR"] as const satisfies readonly WorkflowRole[];
const MECHANIC = ["MECHANIC"] as const satisfies readonly WorkflowRole[];
const SERVICE_MECHANIC = ["SERVICE_ADVISOR", "MECHANIC"] as const satisfies readonly WorkflowRole[];
const SERVICE_PARTS = ["SERVICE_ADVISOR", "PARTS_SPECIALIST"] as const satisfies readonly WorkflowRole[];
const PARTS = ["PARTS_SPECIALIST"] as const satisfies readonly WorkflowRole[];
const STATION_MANAGER = ["STATION_MANAGER"] as const satisfies readonly WorkflowRole[];
const REWORK = ["STATION_MANAGER", "MECHANIC", "SERVICE_ADVISOR"] as const satisfies readonly WorkflowRole[];
const ACCOUNTANT = ["ACCOUNTANT"] as const satisfies readonly WorkflowRole[];

function withStatuses(
  definition: WorkflowDefinition,
  overrides: Record<string, Partial<WorkflowStatusDefinition>>,
  extra: readonly WorkflowStatusDefinition[] = [],
): readonly WorkflowStatusDefinition[] {
  const statuses = definition.statuses.map((status) => ({ ...status, ...(overrides[status.code] ?? {}) }));
  const existing = new Set(statuses.map((status) => status.code));
  return [...statuses, ...extra.filter((status) => !existing.has(status.code))];
}

function transition(
  from: string,
  to: string,
  extra: Omit<WorkflowTransitionDefinition, "from" | "to"> = {},
): WorkflowTransitionDefinition {
  return { from, to, ...extra };
}

function workOrderPolicy(definition: WorkflowDefinition): WorkflowDefinition {
  const statuses = withStatuses(definition, {
    PARTS_REVIEW: {
      label: "Кошторис і підбір",
      stage: "ESTIMATE",
      responsibleRoles: SERVICE_PARTS,
      description: "Сервіс-менеджер формує перелік робіт і кошторис; деталі може підбирати він або менеджер з запчастин.",
    },
    WAITING_APPROVAL: { responsibleRoles: SERVICE },
    WAITING_PARTS: { responsibleRoles: SERVICE_PARTS },
    READY_FOR_REPAIR: { responsibleRoles: SERVICE },
    IN_REPAIR: { responsibleRoles: SERVICE_MECHANIC },
    PAUSED: { responsibleRoles: SERVICE_MECHANIC },
    WAITING_QC: {
      label: "Очікує контроль якості",
      responsibleRoles: STATION_MANAGER,
      description: "Після завершення ремонту контроль якості виконується під відповідальністю Керівника станції.",
    },
    REWORK: { responsibleRoles: REWORK },
    WAITING_PAYMENT: {
      label: "Очікує повну оплату",
      sortOrder: 90,
      responsibleRoles: SERVICE,
      description: "Сервіс-менеджер контролює закриття балансу; оплату проводить бухгалтерія.",
    },
    READY_FOR_PICKUP: {
      label: "Готовий до видачі",
      sortOrder: 100,
      responsibleRoles: SERVICE,
      description: "Статус доступний тільки після успішного QC і повної оплати.",
    },
    CLOSED: { sortOrder: 110, responsibleRoles: SERVICE },
    CANCELLED: { sortOrder: 120, responsibleRoles: SERVICE },
  });

  const replacedSources = new Set(["WAITING_QC", "WAITING_PAYMENT", "READY_FOR_PICKUP"]);
  const transitions = definition.transitions.filter((item) => !replacedSources.has(item.from));
  transitions.push(
    transition("WAITING_QC", "WAITING_PAYMENT", {
      gates: ["QC_PASSED_BEFORE_READY"],
      description: "QC пройдено: фіналізувати суму та передати автомобіль у чергу оплати.",
    }),
    transition("WAITING_QC", "REWORK", { description: "QC не пройдено: повернути механіку на доопрацювання." }),
    transition("WAITING_PAYMENT", "READY_FOR_PICKUP", {
      gates: ["ZERO_BALANCE_BEFORE_DELIVERY"],
      actions: ["SET_VEHICLE_LOCATION_READY"],
      description: "Повна оплата підтверджена: автомобіль готовий до видачі.",
    }),
    transition("READY_FOR_PICKUP", "CLOSED", {
      gates: ["ZERO_BALANCE_BEFORE_DELIVERY"],
      actions: ["CLOSE_WORK_ORDER"],
      description: "Автомобіль фактично видано клієнту.",
    }),
  );

  return { ...definition, statuses, transitions };
}

function appointmentPolicy(definition: WorkflowDefinition): WorkflowDefinition {
  const waitingPayment: WorkflowStatusDefinition = {
    code: "WAITING_PAYMENT",
    label: "Очікує оплату",
    stage: "PAYMENT",
    tone: "warning",
    sortOrder: 285,
    system: true,
    blocksResource: true,
    compatibilityOnly: true,
    responsibleRoles: SERVICE,
    description: "Bridge-статус Планувальника, синхронізований із WorkOrder WAITING_PAYMENT.",
  };
  const statuses = withStatuses(definition, {
    BOOKED: { responsibleRoles: SALES_SERVICE },
    ARRIVED: { responsibleRoles: SERVICE },
    WAITING_QC: { responsibleRoles: STATION_MANAGER },
    READY_FOR_PICKUP: { responsibleRoles: SERVICE },
  }, [waitingPayment]);

  const transitions = definition.transitions.filter((item) => !(item.from === "WAITING_QC" && item.to === "READY_FOR_PICKUP"));
  transitions.push(
    transition("WAITING_QC", "WAITING_PAYMENT"),
    transition("WAITING_PAYMENT", "READY_FOR_PICKUP"),
  );
  return { ...definition, statuses, transitions };
}

function diagnosticPolicy(definition: WorkflowDefinition): WorkflowDefinition {
  return {
    ...definition,
    statuses: withStatuses(definition, {
      PENDING: {
        label: "Очікує призначення / діагностики",
        responsibleRoles: SERVICE,
        description: "Сервіс-менеджер приймає авто та передає діагностику призначеному механіку.",
      },
      IN_PROGRESS: { label: "Механік проводить діагностику", responsibleRoles: MECHANIC },
      CONFIRMED: { label: "Діагностику прийнято", responsibleRoles: SERVICE },
      CANCELLED: { responsibleRoles: SERVICE },
    }),
  };
}

function partsPolicy(definition: WorkflowDefinition): WorkflowDefinition {
  return {
    ...definition,
    statuses: withStatuses(definition, {
      NEW: { responsibleRoles: SERVICE_PARTS },
      SELECTING: { responsibleRoles: SERVICE_PARTS },
      SELECTED: { responsibleRoles: SERVICE_PARTS },
      WAITING_APPROVAL: { responsibleRoles: SERVICE },
      APPROVED: { responsibleRoles: SERVICE_PARTS },
      ORDER_REQUIRED: { responsibleRoles: SERVICE_PARTS },
      ORDERED: { responsibleRoles: SERVICE_PARTS },
      PARTIALLY_RECEIVED: { responsibleRoles: SERVICE_PARTS },
      RECEIVED: { responsibleRoles: SERVICE_PARTS },
      INSTALLED: { responsibleRoles: ["PARTS_SPECIALIST", "MECHANIC"] },
      RETURNED: { responsibleRoles: PARTS },
      CANCELLED: { responsibleRoles: SERVICE_PARTS },
    }),
  };
}

function qcPolicy(definition: WorkflowDefinition): WorkflowDefinition {
  const overrides = Object.fromEntries(definition.statuses.map((status) => [status.code, { responsibleRoles: STATION_MANAGER }]));
  return { ...definition, statuses: withStatuses(definition, overrides) };
}

function paymentPolicy(definition: WorkflowDefinition): WorkflowDefinition {
  const overrides = Object.fromEntries(definition.statuses.map((status) => [status.code, { responsibleRoles: ACCOUNTANT }]));
  return { ...definition, statuses: withStatuses(definition, overrides) };
}

function warrantyPolicy(definition: WorkflowDefinition): WorkflowDefinition {
  return {
    ...definition,
    statuses: withStatuses(definition, {
      OPEN: { responsibleRoles: SERVICE },
      DIAGNOSTICS: { responsibleRoles: SERVICE_MECHANIC },
      APPROVED: { responsibleRoles: ["SERVICE_ADVISOR", "EXECUTIVE_DIRECTOR"] },
      REJECTED: { responsibleRoles: ["SERVICE_ADVISOR", "EXECUTIVE_DIRECTOR"] },
      IN_REPAIR: { responsibleRoles: SERVICE_MECHANIC },
      RESOLVED: { responsibleRoles: SERVICE },
      CLOSED: { responsibleRoles: SERVICE },
    }),
  };
}

function leadPolicy(definition: WorkflowDefinition): WorkflowDefinition {
  return {
    ...definition,
    statuses: withStatuses(definition, {
      NEW: { responsibleRoles: SALES },
      CONTACTED: { responsibleRoles: SALES },
      QUALIFIED: { responsibleRoles: SALES },
      ESTIMATE: { responsibleRoles: SALES },
      WAITING: { responsibleRoles: SALES },
      NO_ANSWER: { responsibleRoles: SALES },
      BOOKED: { responsibleRoles: SALES_SERVICE },
      ARRIVED: { responsibleRoles: SERVICE },
    }),
  };
}

export function applyTurboLevOperatingPolicy(definition: WorkflowDefinition): WorkflowDefinition {
  switch (definition.entity) {
    case "LEAD": return leadPolicy(definition);
    case "APPOINTMENT": return appointmentPolicy(definition);
    case "DIAGNOSTIC": return diagnosticPolicy(definition);
    case "WORK_ORDER": return workOrderPolicy(definition);
    case "PARTS_REQUEST": return partsPolicy(definition);
    case "QUALITY_CONTROL": return qcPolicy(definition);
    case "PAYMENT": return paymentPolicy(definition);
    case "WARRANTY": return warrantyPolicy(definition);
    default: return definition;
  }
}
