import type {
  WorkOrderDetailContract,
  WorkOrderListItemContract,
} from "./crm-core";
import {
  isRecord,
  parseWorkOrderDetail,
  parseWorkOrderListItem,
  payloadMessage,
} from "./crm-core.parsers";

export type WorkOrderListPayload = {
  ok: true;
  workOrders: WorkOrderListItemContract[];
};

export type WorkOrderNumberRow = {
  workOrderId: string;
  number: number;
};

export type WorkOrderNumbersPayload = {
  ok: true;
  rows: WorkOrderNumberRow[];
};

export type WorkOrderTransitionFailurePayload = {
  error: string;
  missingGates: string[];
};

function requiredString(value: unknown) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text || null;
}

function positiveInteger(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

function parseArrayStrict<T>(value: unknown, parser: (item: unknown) => T | null) {
  if (!Array.isArray(value)) return null;
  const result: T[] = [];
  for (const item of value) {
    const parsed = parser(item);
    if (!parsed) return null;
    result.push(parsed);
  }
  return result;
}

function parseStringArrayStrict(value: unknown) {
  if (!Array.isArray(value)) return null;
  const result: string[] = [];
  for (const item of value) {
    const text = requiredString(item);
    if (!text) return null;
    result.push(text);
  }
  return result;
}

function hasStrictTransitions(value: Record<string, unknown>, parsed: WorkOrderListItemContract) {
  if (!Array.isArray(value.transitions) || value.transitions.length !== parsed.transitions.length) return false;
  return value.transitions.every((transition, index) => {
    const parsedTransition = parsed.transitions[index];
    if (!parsedTransition || !isRecord(transition)) return false;
    const pairs: Array<[unknown, readonly unknown[]]> = [
      [transition.requiredGates, parsedTransition.requiredGates],
      [transition.missingGates, parsedTransition.missingGates],
      [transition.actions, parsedTransition.actions],
      [transition.unsupportedActions, parsedTransition.unsupportedActions],
    ];
    return pairs.every(([source, result]) => Array.isArray(source) && source.length === result.length);
  });
}

function parseWorkOrderListItemStrict(value: unknown): WorkOrderListItemContract | null {
  if (!isRecord(value)) return null;
  const parsed = parseWorkOrderListItem(value);
  if (!parsed || !hasStrictTransitions(value, parsed)) return null;
  return parsed;
}

function parseWorkOrderDetailStrict(value: unknown): WorkOrderDetailContract | null {
  if (!isRecord(value)) return null;
  const list = parseWorkOrderListItemStrict(value);
  const parsed = parseWorkOrderDetail(value);
  if (!list || !parsed) return null;
  if (value.appointment != null && !parsed.appointment) return null;
  if (!Array.isArray(value.recentCalls) || value.recentCalls.length !== parsed.recentCalls.length) return null;
  return parsed;
}

export function parseWorkOrderListPayload(value: unknown): WorkOrderListPayload | null {
  if (!isRecord(value) || value.ok !== true) return null;
  const workOrders = parseArrayStrict(value.workOrders, parseWorkOrderListItemStrict);
  return workOrders ? { ok: true, workOrders } : null;
}

export function parseWorkOrderDetailPayload(value: unknown): WorkOrderDetailContract | null {
  if (!isRecord(value) || value.ok !== true) return null;
  return parseWorkOrderDetailStrict(value.workOrder);
}

function parseWorkOrderNumberRow(value: unknown): WorkOrderNumberRow | null {
  if (!isRecord(value)) return null;
  const workOrderId = requiredString(value.workOrderId);
  const number = positiveInteger(value.number);
  return workOrderId && number != null ? { workOrderId, number } : null;
}

export function parseWorkOrderNumbersPayload(value: unknown): WorkOrderNumbersPayload | null {
  if (!isRecord(value) || value.ok !== true) return null;
  const rows = parseArrayStrict(value.rows, parseWorkOrderNumberRow);
  return rows ? { ok: true, rows } : null;
}

export function parseWorkOrderTransitionPayload(value: unknown): WorkOrderListItemContract | null {
  if (!isRecord(value) || value.ok !== true) return null;
  return parseWorkOrderListItemStrict(value.workOrder);
}

export function parseWorkOrderTransitionFailurePayload(value: unknown): WorkOrderTransitionFailurePayload | null {
  if (!isRecord(value)) return null;
  const error = requiredString(value.error) || requiredString(value.message);
  if (!error) return null;
  let missingGates: string[] = [];
  if (isRecord(value.workflowDecision) && "missingGates" in value.workflowDecision) {
    const parsed = parseStringArrayStrict(value.workflowDecision.missingGates);
    if (!parsed) return null;
    missingGates = parsed;
  }
  return { error, missingGates };
}

export { payloadMessage };
