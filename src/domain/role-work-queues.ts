import {
  CANONICAL_ROLE_CODES,
  normalizeRoleCode,
  type CanonicalRoleCode,
} from "@/src/security/role-contract";

export type RoleQueueLevel = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
export type RoleQueueBucket = "ACTION" | "WAITING" | "MONITORING";

export type RoleQueueSignal = {
  id: string;
  sourceType: string;
  taskId: string | null;
  category: string;
  level: RoleQueueLevel;
  bucket: RoleQueueBucket;
  dueAt: string | null;
  occurredAt: string;
  isOverdue: boolean;
  metadata: Record<string, unknown>;
};

export type RoleQueuePolicy = {
  role: CanonicalRoleCode;
  actionCategories: readonly string[];
  attentionCategories: readonly string[];
  minLiveActionLevel: RoleQueueLevel;
  minAttentionLevel: RoleQueueLevel;
  requireOwnershipForLiveAction?: boolean;
};

export type RoleWorkQueues<T extends RoleQueueSignal = RoleQueueSignal> = {
  primaryRole: CanonicalRoleCode | null;
  generatedAt: string;
  actionRequired: T[];
  attentionCenter: T[];
  hidden: number;
  summary: {
    actionRequired: number;
    attentionCenter: number;
    criticalActions: number;
    overdueActions: number;
    criticalAttention: number;
  };
};

const ALL_ATTENTION_CATEGORIES = [
  "COMMUNICATIONS",
  "SERVICE",
  "DIAGNOSTICS",
  "PARTS",
  "SUPPLIERS",
  "FINANCE",
  "PAYROLL",
  "POSTS",
  "QUALITY",
  "WARRANTY",
  "MANUAL",
] as const;

const SERVICE_CONTROL = ["COMMUNICATIONS", "SERVICE", "DIAGNOSTICS", "PARTS", "SUPPLIERS", "POSTS", "QUALITY", "WARRANTY", "MANUAL"] as const;
const SERVICE_ADVISOR_CONTROL = ["COMMUNICATIONS", "SERVICE", "DIAGNOSTICS", "PARTS", "FINANCE", "QUALITY", "WARRANTY", "MANUAL"] as const;
const PARTS_CONTROL = ["PARTS", "SUPPLIERS", "SERVICE", "MANUAL"] as const;
const SALES_CONTROL = ["COMMUNICATIONS", "MANUAL"] as const;
const FINANCE_CONTROL = ["FINANCE", "PAYROLL", "MANUAL"] as const;

export const ROLE_QUEUE_POLICIES: Readonly<Record<CanonicalRoleCode, RoleQueuePolicy>> = {
  OWNER: {
    role: "OWNER",
    actionCategories: ["FINANCE", "PAYROLL", "WARRANTY", "MANUAL"],
    attentionCategories: ALL_ATTENTION_CATEGORIES,
    minLiveActionLevel: "CRITICAL",
    minAttentionLevel: "MEDIUM",
  },
  EXECUTIVE_DIRECTOR: {
    role: "EXECUTIVE_DIRECTOR",
    actionCategories: ["SERVICE", "FINANCE", "PAYROLL", "QUALITY", "WARRANTY", "MANUAL"],
    attentionCategories: ALL_ATTENTION_CATEGORIES,
    minLiveActionLevel: "HIGH",
    minAttentionLevel: "MEDIUM",
  },
  STATION_MANAGER: {
    role: "STATION_MANAGER",
    actionCategories: ["COMMUNICATIONS", "SERVICE", "DIAGNOSTICS", "PARTS", "POSTS", "QUALITY", "WARRANTY", "MANUAL"],
    attentionCategories: SERVICE_CONTROL,
    minLiveActionLevel: "HIGH",
    minAttentionLevel: "MEDIUM",
  },
  SERVICE_ADVISOR: {
    role: "SERVICE_ADVISOR",
    actionCategories: ["COMMUNICATIONS", "SERVICE", "PARTS", "FINANCE", "WARRANTY", "MANUAL"],
    attentionCategories: SERVICE_ADVISOR_CONTROL,
    minLiveActionLevel: "MEDIUM",
    minAttentionLevel: "MEDIUM",
  },
  MECHANIC: {
    role: "MECHANIC",
    actionCategories: ["DIAGNOSTICS", "SERVICE", "QUALITY", "MANUAL"],
    attentionCategories: ["DIAGNOSTICS", "SERVICE", "PARTS", "QUALITY", "MANUAL"],
    minLiveActionLevel: "MEDIUM",
    minAttentionLevel: "MEDIUM",
    requireOwnershipForLiveAction: true,
  },
  PARTS_SPECIALIST: {
    role: "PARTS_SPECIALIST",
    actionCategories: ["PARTS", "SUPPLIERS", "MANUAL"],
    attentionCategories: PARTS_CONTROL,
    minLiveActionLevel: "MEDIUM",
    minAttentionLevel: "MEDIUM",
  },
  WAREHOUSE_KEEPER: {
    role: "WAREHOUSE_KEEPER",
    actionCategories: ["PARTS", "MANUAL"],
    attentionCategories: ["PARTS", "SUPPLIERS", "MANUAL"],
    minLiveActionLevel: "MEDIUM",
    minAttentionLevel: "MEDIUM",
  },
  HEAD_OF_SALES: {
    role: "HEAD_OF_SALES",
    actionCategories: ["COMMUNICATIONS", "MANUAL"],
    attentionCategories: SALES_CONTROL,
    minLiveActionLevel: "HIGH",
    minAttentionLevel: "MEDIUM",
  },
  SALES: {
    role: "SALES",
    actionCategories: ["COMMUNICATIONS", "MANUAL"],
    attentionCategories: SALES_CONTROL,
    minLiveActionLevel: "MEDIUM",
    minAttentionLevel: "MEDIUM",
    requireOwnershipForLiveAction: true,
  },
  ACCOUNTANT: {
    role: "ACCOUNTANT",
    actionCategories: ["FINANCE", "PAYROLL", "MANUAL"],
    attentionCategories: FINANCE_CONTROL,
    minLiveActionLevel: "MEDIUM",
    minAttentionLevel: "MEDIUM",
  },
  MARKETING_DIRECTOR: {
    role: "MARKETING_DIRECTOR",
    actionCategories: ["MANUAL"],
    attentionCategories: ["COMMUNICATIONS", "MANUAL"],
    minLiveActionLevel: "HIGH",
    minAttentionLevel: "HIGH",
  },
  MARKETER: {
    role: "MARKETER",
    actionCategories: ["MANUAL"],
    attentionCategories: ["COMMUNICATIONS", "MANUAL"],
    minLiveActionLevel: "MEDIUM",
    minAttentionLevel: "HIGH",
    requireOwnershipForLiveAction: true,
  },
  HR_MANAGER: {
    role: "HR_MANAGER",
    actionCategories: ["MANUAL"],
    attentionCategories: ["PAYROLL", "MANUAL"],
    minLiveActionLevel: "MEDIUM",
    minAttentionLevel: "HIGH",
  },
  ADMINISTRATOR: {
    role: "ADMINISTRATOR",
    actionCategories: ["MANUAL"],
    attentionCategories: ["SERVICE", "COMMUNICATIONS", "MANUAL"],
    minLiveActionLevel: "MEDIUM",
    minAttentionLevel: "HIGH",
  },
  CRM_ADMIN: {
    role: "CRM_ADMIN",
    actionCategories: ["SUPPLIERS", "MANUAL"],
    attentionCategories: ALL_ATTENTION_CATEGORIES,
    minLiveActionLevel: "CRITICAL",
    minAttentionLevel: "HIGH",
  },
};

const LEVEL_WEIGHT: Record<RoleQueueLevel, number> = {
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  CRITICAL: 4,
};

function atLeast(level: RoleQueueLevel, minimum: RoleQueueLevel) {
  return LEVEL_WEIGHT[level] >= LEVEL_WEIGHT[minimum];
}

function textMetadata(signal: RoleQueueSignal, key: string) {
  const value = signal.metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function liveSignalOwnedByUser(signal: RoleQueueSignal, userId: string | null) {
  if (!userId) return false;
  const ownershipKeys = [
    "userId",
    "assigneeUserId",
    "assignedUserId",
    "responsibleUserId",
    "ownerUserId",
    "managerUserId",
  ];
  return ownershipKeys.some((key) => textMetadata(signal, key) === userId);
}

export function resolveRoleQueuePrimaryRole(
  roles: ReadonlyArray<{ code: string; isPrimary?: boolean }>,
): CanonicalRoleCode | null {
  const normalized = roles
    .map((role) => ({ ...role, code: normalizeRoleCode(role.code) }))
    .filter((role): role is { code: CanonicalRoleCode; isPrimary?: boolean } => Boolean(role.code));

  if (normalized.some((role) => role.code === "OWNER")) return "OWNER";
  if (normalized.some((role) => role.code === "EXECUTIVE_DIRECTOR")) return "EXECUTIVE_DIRECTOR";
  return normalized.find((role) => role.isPrimary)?.code ?? normalized[0]?.code ?? null;
}

function compareSignals(a: RoleQueueSignal, b: RoleQueueSignal) {
  const level = LEVEL_WEIGHT[b.level] - LEVEL_WEIGHT[a.level];
  if (level) return level;
  if (a.isOverdue !== b.isOverdue) return a.isOverdue ? -1 : 1;
  const aDue = a.dueAt ? new Date(a.dueAt).getTime() : Number.POSITIVE_INFINITY;
  const bDue = b.dueAt ? new Date(b.dueAt).getTime() : Number.POSITIVE_INFINITY;
  if (aDue !== bDue) return aDue - bDue;
  return new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime();
}

function categoryAllowed(categories: readonly string[], signal: RoleQueueSignal) {
  return categories.includes(signal.category);
}

function isPersonalAction(signal: RoleQueueSignal) {
  return Boolean(signal.taskId) && signal.bucket === "ACTION";
}

function shouldBeLiveAction(signal: RoleQueueSignal, policy: RoleQueuePolicy, userId: string | null) {
  if (signal.bucket !== "ACTION") return false;
  if (!categoryAllowed(policy.actionCategories, signal)) return false;
  if (!atLeast(signal.level, policy.minLiveActionLevel)) return false;
  if (policy.requireOwnershipForLiveAction && !liveSignalOwnedByUser(signal, userId)) return false;
  return true;
}

function shouldBeAttention(signal: RoleQueueSignal, policy: RoleQueuePolicy) {
  return categoryAllowed(policy.attentionCategories, signal)
    && atLeast(signal.level, policy.minAttentionLevel);
}

export function buildRoleWorkQueues<T extends RoleQueueSignal>(input: {
  roles: ReadonlyArray<{ code: string; isPrimary?: boolean }>;
  signals: readonly T[];
  userId?: string | null;
  now?: Date;
}): RoleWorkQueues<T> {
  const primaryRole = resolveRoleQueuePrimaryRole(input.roles);
  const generatedAt = (input.now ?? new Date()).toISOString();
  if (!primaryRole) {
    return {
      primaryRole: null,
      generatedAt,
      actionRequired: [],
      attentionCenter: [],
      hidden: input.signals.length,
      summary: { actionRequired: 0, attentionCenter: 0, criticalActions: 0, overdueActions: 0, criticalAttention: 0 },
    };
  }

  const policy = ROLE_QUEUE_POLICIES[primaryRole];
  const actionRequired: T[] = [];
  const attentionCenter: T[] = [];
  let hidden = 0;

  for (const signal of input.signals) {
    // Tasks returned by listTasksForUser are already personalized server-side.
    if (isPersonalAction(signal)) {
      actionRequired.push(signal);
      continue;
    }

    if (shouldBeLiveAction(signal, policy, input.userId ?? null)) {
      actionRequired.push(signal);
      continue;
    }

    if (shouldBeAttention(signal, policy)) {
      attentionCenter.push(signal);
      continue;
    }

    hidden += 1;
  }

  actionRequired.sort(compareSignals);
  attentionCenter.sort(compareSignals);

  return {
    primaryRole,
    generatedAt,
    actionRequired,
    attentionCenter,
    hidden,
    summary: {
      actionRequired: actionRequired.length,
      attentionCenter: attentionCenter.length,
      criticalActions: actionRequired.filter((signal) => signal.level === "CRITICAL").length,
      overdueActions: actionRequired.filter((signal) => signal.isOverdue).length,
      criticalAttention: attentionCenter.filter((signal) => signal.level === "CRITICAL").length,
    },
  };
}

export function assertRoleQueuePolicyCoverage() {
  const missing = CANONICAL_ROLE_CODES.filter((role) => !ROLE_QUEUE_POLICIES[role]);
  if (missing.length) throw new Error(`ROLE_QUEUE_POLICY_MISSING:${missing.join(",")}`);
  return true;
}
