import { getWorkflowDefinition, getWorkflowStatus, getWorkflowTransition, normalizeWorkflowStatus } from "./engine";
import type { HardGateCode, WorkflowActionCode, WorkflowEntity } from "./types";

export type WorkflowGateState = Partial<Record<HardGateCode, boolean>>;

export type WorkflowTransitionDecisionCode =
  | "ALLOWED"
  | "NOOP"
  | "UNKNOWN_FROM_STATUS"
  | "UNKNOWN_TO_STATUS"
  | "TRANSITION_NOT_ALLOWED"
  | "GATES_NOT_SATISFIED";

export type WorkflowTransitionDecision = {
  allowed: boolean;
  code: WorkflowTransitionDecisionCode;
  entity: WorkflowEntity;
  from: string;
  to: string;
  normalizedFrom: string;
  normalizedTo: string;
  requiredGates: readonly HardGateCode[];
  satisfiedGates: readonly HardGateCode[];
  missingGates: readonly HardGateCode[];
  actions: readonly WorkflowActionCode[];
  availableTargets: readonly string[];
};

export function evaluateWorkflowTransition(input: {
  entity: WorkflowEntity;
  from: string;
  to: string;
  gates?: WorkflowGateState;
}): WorkflowTransitionDecision {
  const definition = getWorkflowDefinition(input.entity);
  const normalizedFrom = normalizeWorkflowStatus(input.entity, input.from.trim().toUpperCase());
  const normalizedTo = normalizeWorkflowStatus(input.entity, input.to.trim().toUpperCase());
  const fromStatus = getWorkflowStatus(input.entity, normalizedFrom);
  const toStatus = getWorkflowStatus(input.entity, normalizedTo);
  const availableTargets = definition.transitions.filter((item) => item.from === normalizedFrom).map((item) => item.to);

  const base = {
    entity: input.entity,
    from: input.from,
    to: input.to,
    normalizedFrom,
    normalizedTo,
    requiredGates: [] as readonly HardGateCode[],
    satisfiedGates: [] as readonly HardGateCode[],
    missingGates: [] as readonly HardGateCode[],
    actions: [] as readonly WorkflowActionCode[],
    availableTargets,
  };

  if (!fromStatus) return { ...base, allowed: false, code: "UNKNOWN_FROM_STATUS" };
  if (!toStatus) return { ...base, allowed: false, code: "UNKNOWN_TO_STATUS" };
  if (normalizedFrom === normalizedTo) return { ...base, allowed: true, code: "NOOP" };

  const transition = getWorkflowTransition(input.entity, normalizedFrom, normalizedTo);
  if (!transition) return { ...base, allowed: false, code: "TRANSITION_NOT_ALLOWED" };

  const requiredGates = transition.gates ?? [];
  const gateState = input.gates ?? {};
  const satisfiedGates = requiredGates.filter((gate) => gateState[gate] === true);
  const missingGates = requiredGates.filter((gate) => gateState[gate] !== true);
  const actions = transition.actions ?? [];

  return {
    ...base,
    allowed: missingGates.length === 0,
    code: missingGates.length ? "GATES_NOT_SATISFIED" : "ALLOWED",
    requiredGates,
    satisfiedGates,
    missingGates,
    actions,
  };
}

export function assertWorkflowTransition(input: {
  entity: WorkflowEntity;
  from: string;
  to: string;
  gates?: WorkflowGateState;
}) {
  const decision = evaluateWorkflowTransition(input);
  if (!decision.allowed) {
    const error = new Error(decision.code) as Error & { decision?: WorkflowTransitionDecision };
    error.decision = decision;
    throw error;
  }
  return decision;
}
