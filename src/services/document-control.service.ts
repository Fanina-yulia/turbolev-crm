import { createHash } from "node:crypto";
import { getPrisma } from "@/src/lib/prisma";
import { toPrismaJson } from "@/src/lib/prisma-json";
import { getDiagnosticCard } from "@/src/services/diagnostic-card.service";
import { getDocumentTemplates } from "@/src/services/document-template.service";
import { getWorkOrderDocumentPackage } from "@/src/services/work-order-document-package.service";

export type ControlledDocumentTypeCode =
  | "DIAGNOSTIC_CARD"
  | "COMMERCIAL_PROPOSAL"
  | "INVOICE"
  | "COMPLETION_ACT";

export type ControlledDocumentRevisionInput = {
  documentKey: string;
  type: ControlledDocumentTypeCode;
  workOrderId?: string | null;
  diagnosticRequestId?: string | null;
  sourceEntityType: string;
  sourceEntityId: string;
  sourceRevision?: number | null;
  sourceFingerprint?: string | null;
  templateVersion?: number | null;
  templateFingerprint?: string | null;
  snapshot: unknown;
  fileName?: string | null;
  mimeType?: string | null;
  issuedByName?: string | null;
  actorId?: string | null;
};

export class ControlledDocumentError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "ControlledDocumentError";
    this.code = code;
    this.status = status;
  }
}

const DOCUMENT_TYPES: ControlledDocumentTypeCode[] = [
  "DIAGNOSTIC_CARD",
  "COMMERCIAL_PROPOSAL",
  "INVOICE",
  "COMPLETION_ACT",
];

function text(value: unknown, max: number) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
}

function hash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function typeValue(value: unknown): ControlledDocumentTypeCode {
  const normalized = text(value, 40);
  if (normalized && DOCUMENT_TYPES.includes(normalized as ControlledDocumentTypeCode)) {
    return normalized as ControlledDocumentTypeCode;
  }
  throw new ControlledDocumentError("INVALID_DOCUMENT_TYPE", "Невідомий тип документа.");
}

export function workOrderDocumentKey(workOrderId: string, type: ControlledDocumentTypeCode) {
  return `work-order:${workOrderId}:${type}`;
}

export function diagnosticDocumentKey(diagnosticRequestId: string) {
  return `diagnostic-request:${diagnosticRequestId}:DIAGNOSTIC_CARD`;
}

function builtInTemplate(type: ControlledDocumentTypeCode) {
  return {
    templateVersion: 1,
    templateFingerprint: hash({ type, renderer: "BUILT_IN", version: 1 }),
  };
}

export async function issueControlledDocumentRevision(input: ControlledDocumentRevisionInput) {
  const type = typeValue(input.type);
  const documentKey = text(input.documentKey, 180);
  const sourceEntityType = text(input.sourceEntityType, 64);
  const sourceEntityId = text(input.sourceEntityId, 96);
  if (!documentKey || !sourceEntityType || !sourceEntityId) {
    throw new ControlledDocumentError("DOCUMENT_SOURCE_REQUIRED", "Для документа потрібні ключ і джерело.");
  }
  if (!input.workOrderId && !input.diagnosticRequestId) {
    throw new ControlledDocumentError("DOCUMENT_CONTEXT_REQUIRED", "Документ не прив'язаний до Work Order або діагностики.");
  }

  const sourceFingerprint = text(input.sourceFingerprint, 64) || hash(input.snapshot);
  const templateFingerprint = text(input.templateFingerprint, 64) || hash({
    type,
    templateVersion: input.templateVersion || 1,
    template: "BUILT_IN",
  });
  const snapshot = toPrismaJson(input.snapshot);
  const contentHash = hash({
    type,
    sourceFingerprint,
    templateVersion: input.templateVersion || 1,
    templateFingerprint,
    snapshot: input.snapshot,
  });
  const issuedByName = text(input.issuedByName, 160);
  const fileName = text(input.fileName, 180);
  const mimeType = text(input.mimeType, 80) || "application/pdf";
  const prisma = getPrisma();

  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${documentKey}))`;

    const existing = await tx.controlledDocumentRevision.findUnique({
      where: { documentKey_contentHash: { documentKey, contentHash } },
    });
    if (existing) return { revision: existing, created: false, reused: true };

    const latest = await tx.controlledDocumentRevision.findFirst({
      where: { documentKey },
      orderBy: { revision: "desc" },
    });
    const revisionNumber = (latest?.revision || 0) + 1;
    const now = new Date();

    if (latest?.status === "ISSUED") {
      await tx.controlledDocumentRevision.update({
        where: { id: latest.id },
        data: { status: "SUPERSEDED", supersededAt: now },
      });
    }

    const revision = await tx.controlledDocumentRevision.create({
      data: {
        documentKey,
        type,
        revision: revisionNumber,
        status: "ISSUED",
        workOrderId: input.workOrderId || null,
        diagnosticRequestId: input.diagnosticRequestId || null,
        sourceEntityType,
        sourceEntityId,
        sourceRevision: input.sourceRevision || null,
        sourceFingerprint,
        templateVersion: input.templateVersion || null,
        templateFingerprint,
        contentHash,
        fileName,
        mimeType,
        snapshot,
        issuedByName,
      },
    });

    await tx.auditEvent.create({
      data: {
        actorId: input.actorId || null,
        actorName: issuedByName || "CRM / Документи",
        entityType: "ControlledDocumentRevision",
        entityId: revision.id,
        action: "CONTROLLED_DOCUMENT_REVISION_ISSUED",
        before: latest ? toPrismaJson({ id: latest.id, revision: latest.revision, status: latest.status, contentHash: latest.contentHash }) : undefined,
        after: toPrismaJson({
          documentKey,
          type,
          revision: revisionNumber,
          sourceEntityType,
          sourceEntityId,
          sourceRevision: input.sourceRevision || null,
          sourceFingerprint,
          templateVersion: input.templateVersion || null,
          contentHash,
        }),
        metadata: toPrismaJson({
          workOrderId: input.workOrderId || null,
          diagnosticRequestId: input.diagnosticRequestId || null,
          fileName,
          mimeType,
        }),
      },
    });

    return { revision, created: true, reused: false };
  });
}

export async function voidControlledDocumentRevision(
  revisionId: string,
  actorName = "CRM / Документи",
  reason?: string | null,
  actorId?: string | null,
) {
  const prisma = getPrisma();
  return prisma.$transaction(async (tx) => {
    const current = await tx.controlledDocumentRevision.findUnique({ where: { id: revisionId } });
    if (!current) throw new ControlledDocumentError("DOCUMENT_REVISION_NOT_FOUND", "Ревізію документа не знайдено.", 404);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${current.documentKey}))`;
    if (current.status === "VOIDED") return current;
    if (current.status !== "ISSUED") {
      throw new ControlledDocumentError("DOCUMENT_REVISION_NOT_CURRENT", "Можна анулювати лише актуальну ревізію документа.", 409);
    }

    const now = new Date();
    const updated = await tx.controlledDocumentRevision.update({
      where: { id: current.id },
      data: {
        status: "VOIDED",
        voidedAt: now,
        voidedReason: text(reason, 2000) || "Документ анульовано користувачем.",
      },
    });
    await tx.auditEvent.create({
      data: {
        actorId: actorId || null,
        actorName,
        entityType: "ControlledDocumentRevision",
        entityId: updated.id,
        action: "CONTROLLED_DOCUMENT_REVISION_VOIDED",
        before: toPrismaJson({ status: current.status, revision: current.revision }),
        after: toPrismaJson({ status: updated.status, revision: updated.revision, reason: updated.voidedReason }),
        metadata: toPrismaJson({ documentKey: updated.documentKey, type: updated.type }),
      },
    });
    return updated;
  });
}

export async function listControlledDocumentRevisions(
  workOrderId: string,
  type?: ControlledDocumentTypeCode | null,
) {
  const normalizedType = type ? typeValue(type) : null;
  return getPrisma().controlledDocumentRevision.findMany({
    where: { workOrderId, ...(normalizedType ? { type: normalizedType } : {}) },
    orderBy: [{ documentKey: "asc" }, { revision: "desc" }],
  });
}

export async function getLatestControlledDocumentRevision(
  workOrderId: string,
  type: ControlledDocumentTypeCode,
) {
  return getPrisma().controlledDocumentRevision.findFirst({
    where: { workOrderId, type: typeValue(type), status: "ISSUED" },
    orderBy: { revision: "desc" },
  });
}

export async function captureWorkOrderDocumentRevision(
  workOrderId: string,
  type: ControlledDocumentTypeCode,
  actorName = "CRM / Документи",
  actorId?: string | null,
) {
  const normalizedType = typeValue(type);
  const [packageData, source, templates] = await Promise.all([
    getWorkOrderDocumentPackage(workOrderId),
    getPrisma().workOrder.findUnique({ where: { id: workOrderId }, select: { id: true, diagnosticRequestId: true } }),
    getDocumentTemplates(),
  ]);
  if (!source) throw new ControlledDocumentError("WORK_ORDER_NOT_FOUND", "Замовлення-наряд не знайдено.", 404);

  const template = templates.templates.find((item) => item.type === normalizedType);
  const templateMeta = normalizedType === "DIAGNOSTIC_CARD" || normalizedType === "COMMERCIAL_PROPOSAL"
    ? {
        templateVersion: template?.version || 1,
        templateFingerprint: hash(template || { type: normalizedType, version: 1 }),
      }
    : builtInTemplate(normalizedType);

  if (normalizedType === "DIAGNOSTIC_CARD") {
    if (!source.diagnosticRequestId) throw new ControlledDocumentError("DOCUMENT_SOURCE_NOT_READY", "Для прямого ремонту діагностична карта не створюється.", 409);
    const cardState = await getDiagnosticCard(source.diagnosticRequestId);
    const final = cardState?.final;
    if (!final || !packageData.documents.diagnosticCard.available) {
      throw new ControlledDocumentError("DOCUMENT_SOURCE_NOT_READY", "Фінальна діагностична карта ще не готова.", 409);
    }
    return issueControlledDocumentRevision({
      documentKey: diagnosticDocumentKey(source.diagnosticRequestId),
      type: normalizedType,
      workOrderId,
      diagnosticRequestId: source.diagnosticRequestId,
      sourceEntityType: "DiagnosticCardRevision",
      sourceEntityId: final.id,
      sourceRevision: final.revision,
      sourceFingerprint: final.sourceFingerprint,
      templateVersion: templateMeta.templateVersion,
      templateFingerprint: templateMeta.templateFingerprint,
      snapshot: packageData.documents.diagnosticCard,
      fileName: `diagnostic-card-${packageData.documents.diagnosticCard.number || workOrderId}.pdf`,
      issuedByName: actorName,
      actorId,
    });
  }

  if (normalizedType === "COMMERCIAL_PROPOSAL") {
    const estimate = packageData.documents.estimate;
    if (!estimate.available || !["SENT", "APPROVED"].includes(estimate.status)) {
      throw new ControlledDocumentError("DOCUMENT_SOURCE_NOT_READY", "Комерційна пропозиція ще не надіслана клієнту.", 409);
    }
    return issueControlledDocumentRevision({
      documentKey: workOrderDocumentKey(workOrderId, normalizedType),
      type: normalizedType,
      workOrderId,
      sourceEntityType: "WorkOrderEstimate",
      sourceEntityId: estimate.id,
      sourceRevision: estimate.revision,
      sourceFingerprint: hash(estimate.lineSnapshot),
      templateVersion: templateMeta.templateVersion,
      templateFingerprint: templateMeta.templateFingerprint,
      snapshot: estimate,
      fileName: `commercial-proposal-${packageData.workOrder.displayNumber || workOrderId}.pdf`,
      issuedByName: actorName,
      actorId,
    });
  }

  if (normalizedType === "INVOICE") {
    if (!packageData.documents.invoice.available) {
      throw new ControlledDocumentError("DOCUMENT_SOURCE_NOT_READY", "Рахунок ще не має фінансових рядків.", 409);
    }
    return issueControlledDocumentRevision({
      documentKey: workOrderDocumentKey(workOrderId, normalizedType),
      type: normalizedType,
      workOrderId,
      sourceEntityType: "WorkOrderFinancialView",
      sourceEntityId: workOrderId,
      sourceRevision: packageData.documents.estimate.available ? packageData.documents.estimate.revision : null,
      sourceFingerprint: hash(packageData.documents.invoice),
      templateVersion: templateMeta.templateVersion,
      templateFingerprint: templateMeta.templateFingerprint,
      snapshot: packageData.documents.invoice,
      fileName: `invoice-${packageData.workOrder.displayNumber || workOrderId}.pdf`,
      issuedByName: actorName,
      actorId,
    });
  }

  if (!packageData.documents.act.available || packageData.documents.act.state !== "FINAL" || !packageData.documents.act.id) {
    throw new ControlledDocumentError("DOCUMENT_SOURCE_NOT_READY", "Акт доступний після завершення замовлення-наряду.", 409);
  }
  return issueControlledDocumentRevision({
    documentKey: workOrderDocumentKey(workOrderId, "COMPLETION_ACT"),
    type: "COMPLETION_ACT",
    workOrderId,
    sourceEntityType: "ServiceCompletionAct",
    sourceEntityId: packageData.documents.act.id,
    sourceRevision: 1,
    sourceFingerprint: hash(packageData.documents.act),
    templateVersion: templateMeta.templateVersion,
    templateFingerprint: templateMeta.templateFingerprint,
    snapshot: packageData.documents.act,
    fileName: `completion-act-${packageData.workOrder.displayNumber || workOrderId}.pdf`,
    issuedByName: actorName,
    actorId,
  });
}
