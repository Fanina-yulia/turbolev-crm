export type WorkflowEntity =
  | "INQUIRY"
  | "LEAD"
  | "CLIENT"
  | "VEHICLE"
  | "APPOINTMENT"
  | "DIAGNOSTIC"
  | "WORK_ORDER"
  | "PARTS_REQUEST"
  | "SUPPLIER_ORDER"
  | "STOCK_RESERVATION"
  | "PAYMENT"
  | "QUALITY_CONTROL"
  | "WARRANTY";

export type WorkflowKind = "PROCESS" | "PROFILE";

export type WorkflowStage =
  | "INQUIRY"
  | "QUALIFICATION"
  | "BOOKING"
  | "INTAKE"
  | "DIAGNOSTICS"
  | "ESTIMATE"
  | "APPROVAL"
  | "PARTS"
  | "READY_FOR_REPAIR"
  | "REPAIR"
  | "QUALITY_CONTROL"
  | "PAYMENT"
  | "DELIVERY"
  | "AFTERSALES"
  | "PROFILE"
  | "CLOSED";

export type WorkflowTone = "neutral" | "info" | "accent" | "warning" | "success" | "danger";

/**
 * Workflow presentation uses the same role codes as RBAC.
 * Legacy role aliases stay in the union only so saved presentation settings from
 * older deployments can still be parsed and ignored/migrated safely.
 */
export type WorkflowRole =
  | "OWNER"
  | "EXECUTIVE_DIRECTOR"
  | "HEAD_OF_SALES"
  | "SALES"
  | "SERVICE_ADVISOR"
  | "PARTS_SPECIALIST"
  | "STATION_MANAGER"
  | "SHIFT_MASTER"
  | "MECHANIC"
  | "CASHIER"
  | "ACCOUNTANT"
  | "ADMINISTRATOR"
  // legacy presentation role codes
  | "SERVICE_MANAGER"
  | "PARTS_MANAGER"
  | "QUALITY_CONTROLLER"
  | "CASHIER_ACCOUNTING"
  | "ADMIN";

export type BlockerCode =
  | "CUSTOMER_REPLY"
  | "CUSTOMER_APPROVAL"
  | "CUSTOMER_PAYMENT"
  | "PARTS_SELECTION"
  | "PARTS_PAYMENT"
  | "SUPPLIER_CONFIRMATION"
  | "SUPPLIER_DELIVERY"
  | "PARTS_MISSING"
  | "POST_UNAVAILABLE"
  | "MECHANIC_UNAVAILABLE"
  | "TECHNICAL_DECISION"
  | "THIRD_PARTY_SERVICE"
  | "QC_REWORK"
  | "INTERNAL_HOLD"
  | "OTHER";

export type HardGateCode =
  | "WORK_ORDER_AFTER_CONFIRMED_DIAGNOSTICS"
  | "ESTIMATE_APPROVED_BEFORE_REPAIR"
  | "PARTS_PAYMENT_BEFORE_ORDER"
  | "REQUIRED_PARTS_READY_BEFORE_REPAIR"
  | "MECHANIC_ASSIGNED_BEFORE_REPAIR"
  | "ADDITIONAL_WORK_REQUIRES_APPROVAL"
  | "QC_PASSED_BEFORE_READY"
  | "ZERO_BALANCE_BEFORE_DELIVERY";

export type WorkflowActionCode =
  | "CREATE_LEAD"
  | "CREATE_APPOINTMENT"
  | "UPDATE_LEAD_ARRIVED"
  | "SET_VEHICLE_LOCATION_RECEPTION"
  | "CREATE_DIAGNOSTIC_REQUEST"
  | "CREATE_WORK_ORDER"
  | "CREATE_ESTIMATE"
  | "OPEN_PARTS_REQUEST"
  | "CREATE_QC_TASK"
  | "SET_VEHICLE_LOCATION_QC"
  | "SET_VEHICLE_LOCATION_READY"
  | "CLOSE_APPOINTMENT"
  | "CLOSE_WORK_ORDER";

export type VehicleLocationCode =
  | "OUTSIDE"
  | "RECEPTION"
  | "QUEUE"
  | "POST"
  | "PARKING"
  | "WAITING_PARTS"
  | "QUALITY_CONTROL"
  | "READY_ZONE"
  | "DELIVERED";

export type WorkflowStatusDefinition = {
  code: string;
  label: string;
  stage: WorkflowStage;
  tone: WorkflowTone;
  sortOrder: number;
  system: true;
  terminal?: boolean;
  legacy?: boolean;
  compatibilityOnly?: boolean;
  blocksResource?: boolean;
  description?: string;
  responsibleRoles?: readonly WorkflowRole[];
};

export type WorkflowTransitionDefinition = {
  from: string;
  to: string;
  gates?: readonly HardGateCode[];
  actions?: readonly WorkflowActionCode[];
  description?: string;
};

export type WorkflowDefinition = {
  entity: WorkflowEntity;
  label: string;
  kind: WorkflowKind;
  description: string;
  statuses: readonly WorkflowStatusDefinition[];
  transitions: readonly WorkflowTransitionDefinition[];
  aliases?: Readonly<Record<string, string>>;
};
