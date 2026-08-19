import {
  BLOCKER_LABELS,
  HARD_GATE_LABELS,
  MASTER_SERVICE_STAGES,
  OPERATIONAL_WORKFLOW_ROLE_LABELS,
  STATUS_ARCHITECTURE_VERSION,
  VEHICLE_LOCATION_LABELS,
  WORKFLOW_ACTION_LABELS,
} from "./catalog";
import { applyTurboLevOperatingPolicy } from "./operating-policy";
import { WORKFLOW_DEFINITIONS } from "./registry";
import type { WorkflowDefinition, WorkflowEntity, WorkflowStatusDefinition, WorkflowTransitionDefinition } from "./types";

const effectiveDefinitions = Object.fromEntries(
  Object.entries(WORKFLOW_DEFINITIONS).map(([key, definition]) => [key, applyTurboLevOperatingPolicy(definition)]),
) as Readonly<Record<string, WorkflowDefinition>>;

export function getWorkflowDefinition(entity: WorkflowEntity): WorkflowDefinition {
  const definition = effectiveDefinitions[entity];
  if (!definition) throw new Error(`Unknown workflow entity: ${entity}`);
  return definition;
}

export function normalizeWorkflowStatus(entity: WorkflowEntity, status: string): string {
  const definition = getWorkflowDefinition(entity);
  return definition.aliases?.[status] ?? status;
}

export function getWorkflowStatus(entity: WorkflowEntity, status: string): WorkflowStatusDefinition | null {
  const definition = getWorkflowDefinition(entity);
  const exact = definition.statuses.find((item) => item.code === status);
  if (exact) return exact;
  const normalized = normalizeWorkflowStatus(entity, status);
  return definition.statuses.find((item) => item.code === normalized) ?? null;
}

export function getWorkflowStatusLabel(entity: WorkflowEntity, status: string): string {
  return getWorkflowStatus(entity, status)?.label ?? status;
}

export function getAllowedTransitions(entity: WorkflowEntity, status: string): readonly WorkflowTransitionDefinition[] {
  const definition = getWorkflowDefinition(entity);
  const normalized = normalizeWorkflowStatus(entity, status);
  return definition.transitions.filter((item) => item.from === normalized);
}

export function getWorkflowTransition(entity: WorkflowEntity, from: string, to: string): WorkflowTransitionDefinition | null {
  const definition = getWorkflowDefinition(entity);
  const normalizedFrom = normalizeWorkflowStatus(entity, from);
  const normalizedTo = normalizeWorkflowStatus(entity, to);
  return definition.transitions.find((item) => item.from === normalizedFrom && item.to === normalizedTo) ?? null;
}

export function canTransition(entity: WorkflowEntity, from: string, to: string): boolean {
  return Boolean(getWorkflowTransition(entity, from, to));
}

export function assertWorkflowRegistryIntegrity(): true {
  for (const definition of Object.values(effectiveDefinitions)) {
    const codes = new Set(definition.statuses.map((status) => status.code));
    if (codes.size !== definition.statuses.length) throw new Error(`Duplicate status code in ${definition.entity}`);
    for (const transition of definition.transitions) {
      if (!codes.has(transition.from)) throw new Error(`${definition.entity}: transition source ${transition.from} is missing`);
      if (!codes.has(transition.to)) throw new Error(`${definition.entity}: transition target ${transition.to} is missing`);
    }
    for (const [legacy, canonical] of Object.entries(definition.aliases ?? {})) {
      if (!codes.has(canonical)) throw new Error(`${definition.entity}: alias ${legacy} points to missing ${canonical}`);
    }
  }
  return true;
}

export function getWorkflowCatalog() {
  assertWorkflowRegistryIntegrity();
  return {
    version: STATUS_ARCHITECTURE_VERSION,
    principles: {
      separateEntityLifecycles: true,
      vehicleOperationalStateIsDerived: true,
      blockerIsNotStatus: true,
      systemStatusesAreProtected: true,
      transitionGatesAreExplicit: true,
      automationsAreDeclarativeUntilImplemented: true,
    },
    masterStages: MASTER_SERVICE_STAGES,
    roles: OPERATIONAL_WORKFLOW_ROLE_LABELS,
    blockers: BLOCKER_LABELS,
    vehicleLocations: VEHICLE_LOCATION_LABELS,
    hardGates: HARD_GATE_LABELS,
    actions: WORKFLOW_ACTION_LABELS,
    entities: Object.values(effectiveDefinitions),
  };
}
