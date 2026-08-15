import type { Prisma } from "@/src/generated/prisma/client";
import { getPrisma } from "@/src/lib/prisma";
import { getAccessContext } from "@/src/security/access-context";

type AuditInput = {
  entityType: string;
  entityId: string;
  action: string;
  actorId?: string | null;
  actorName?: string | null;
  before?: Prisma.InputJsonValue | null;
  after?: Prisma.InputJsonValue | null;
  metadata?: Prisma.InputJsonValue | null;
};

function isJsonObject(value: Prisma.InputJsonValue | null | undefined): value is Prisma.InputJsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function resolveAuditIdentity(input: AuditInput) {
  if (input.actorId || input.actorName) {
    return { actorId: input.actorId || null, actorName: input.actorName || null, securityMetadata: null };
  }

  try {
    const context = await getAccessContext();
    if (context.provisioningState !== "ACTIVE" || !context.user) {
      return { actorId: null, actorName: null, securityMetadata: null };
    }
    return {
      actorId: context.user.id,
      actorName: context.user.employeeName || context.user.name,
      securityMetadata: {
        authUserId: context.authIdentity?.id ?? null,
        roles: context.roles.map((role) => role.code),
      },
    };
  } catch {
    // Audit must never break a business transaction solely because session resolution failed.
    return { actorId: null, actorName: null, securityMetadata: null };
  }
}

export async function writeAuditEvent(input: AuditInput) {
  const prisma = getPrisma();
  const identity = await resolveAuditIdentity(input);
  let metadata = input.metadata ?? undefined;
  if (identity.securityMetadata) {
    metadata = isJsonObject(input.metadata)
      ? { ...input.metadata, security: identity.securityMetadata }
      : { security: identity.securityMetadata };
  }

  return prisma.auditEvent.create({
    data: {
      entityType: input.entityType,
      entityId: input.entityId,
      action: input.action,
      actorId: identity.actorId,
      actorName: identity.actorName,
      before: input.before ?? undefined,
      after: input.after ?? undefined,
      metadata,
    },
  });
}

export async function listAuditEvents(entityType: string, entityId: string, take = 50) {
  const prisma = getPrisma();
  return prisma.auditEvent.findMany({
    where: { entityType, entityId },
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(take, 1), 200),
  });
}
