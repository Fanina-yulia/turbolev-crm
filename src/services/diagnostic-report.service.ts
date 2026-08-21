import { createHash, randomBytes } from "node:crypto";
import { DiagnosticReviewState } from "@/src/generated/prisma/client";
import { getPrisma } from "@/src/lib/prisma";
import { toPrismaJson } from "@/src/lib/prisma-json";
import { getFinalDiagnosticCardSnapshot, type DiagnosticCardSnapshot } from "@/src/services/diagnostic-card.service";
import { getStructuredDiagnostic } from "@/src/services/structured-diagnostics.service";

export class DiagnosticReportError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status = 400) { super(message); this.name = "DiagnosticReportError"; this.code = code; this.status = status; }
}

export type DiagnosticReportSnapshot = {
  version: 1;
  diagnosticRequestId: string;
  generatedAt: string;
  vehicle: { label: string; plateNumber: string | null; mileageKm: number | null };
  client: { name: string | null };
  problem: string | null;
  technicalConclusion: string | null;
  mechanicComment: string | null;
  stationName: string | null;
  mechanicName: string | null;
  counts: { total: number; checked: number; ok: number; attention: number; defect: number };
  inspections: Array<{
    name: string;
    sections: Array<{
      name: string;
      items: Array<{
        name: string;
        position: string | null;
        state: string;
        measurement: string | null;
        note: string | null;
        finding: null | {
          action: string;
          urgency: string;
          text: string | null;
          suggestedWorkName: string | null;
          suggestedPartName: string | null;
          mediaIds: string[];
        };
      }>;
    }>;
  }>;
};

type ShareMetaSource = {
  id: string;
  diagnosticRequestId: string;
  createdAt: Date;
  expiresAt: Date | null;
  revokedAt: Date | null;
  requestedPricingAt: Date | null;
};

function hashToken(token: string) { return createHash("sha256").update(token).digest("hex"); }
function clientFirstName(value: string | null) {
  if (!value) return null;
  return value.trim().split(/\s+/).filter(Boolean)[0] || null;
}
function measurement(item: { measurementValue: string | null; measurementText: string | null; measurementUnit: string | null }) {
  if (item.measurementValue) return `${item.measurementValue}${item.measurementUnit ? ` ${item.measurementUnit}` : ""}`;
  return item.measurementText || null;
}
function reviewCanBeShared(state: DiagnosticReviewState) {
  return state === DiagnosticReviewState.CONFIRMED;
}
function publicMeta(share: ShareMetaSource, contextualActive = true) {
  return {
    id: share.id,
    diagnosticRequestId: share.diagnosticRequestId,
    createdAt: share.createdAt,
    expiresAt: share.expiresAt,
    revokedAt: share.revokedAt,
    requestedPricingAt: share.requestedPricingAt,
    active: contextualActive && !share.revokedAt && (!share.expiresAt || share.expiresAt.getTime() > Date.now()),
  };
}

function fromDiagnosticCard(card: DiagnosticCardSnapshot): DiagnosticReportSnapshot {
  return {
    version: 1,
    diagnosticRequestId: card.diagnosticRequestId,
    generatedAt: card.generatedAt,
    vehicle: { label: card.vehicle.label, plateNumber: card.vehicle.plateNumber, mileageKm: card.vehicle.mileageKm },
    client: { name: clientFirstName(card.client.name) },
    problem: card.problem,
    technicalConclusion: card.technicalConclusion,
    mechanicComment: card.mechanicComment,
    stationName: card.station.name,
    mechanicName: card.mechanic.name,
    counts: {
      total: card.counts.total,
      checked: card.counts.checked,
      ok: card.counts.ok,
      attention: card.counts.attention,
      defect: card.counts.defect,
    },
    inspections: card.inspections.map((inspection) => ({
      name: inspection.name,
      sections: inspection.sections.map((section) => ({
        name: section.name,
        items: section.items.map((item) => ({
          name: item.name,
          position: item.position,
          state: item.state,
          measurement: measurement(item),
          note: item.note,
          finding: item.finding ? {
            action: item.finding.action,
            urgency: item.finding.urgency,
            text: item.finding.text,
            suggestedWorkName: item.finding.suggestedWorkName,
            suggestedPartName: item.finding.suggestedPartName,
            mediaIds: item.finding.mediaIds,
          } : null,
        })),
      })),
    })),
  };
}

async function buildLegacyConfirmedSnapshot(diagnosticRequestId: string): Promise<DiagnosticReportSnapshot> {
  const prisma = getPrisma();
  const view = await getStructuredDiagnostic(diagnosticRequestId);
  const reviewState = view.diagnostic.review.state;
  if (!reviewCanBeShared(reviewState)) {
    throw new DiagnosticReportError("REPORT_NOT_READY", "Клієнтський звіт можна надіслати лише після підтвердження Діагностичної карти сервіс-менеджером.", 409);
  }
  const mechanicId = view.diagnostic.assignment?.mechanicId || null;
  const locationId = view.diagnostic.assignment?.locationId || null;
  const [mechanic, location] = await Promise.all([
    mechanicId ? prisma.serviceMechanic.findUnique({ where: { id: mechanicId }, select: { name: true } }) : null,
    locationId ? prisma.serviceLocation.findUnique({ where: { id: locationId }, select: { name: true } }) : null,
  ]);
  return {
    version: 1,
    diagnosticRequestId,
    generatedAt: new Date().toISOString(),
    vehicle: { label: view.diagnostic.vehicle.label, plateNumber: view.diagnostic.vehicle.plateNumber, mileageKm: view.diagnostic.vehicle.mileageKm },
    client: { name: clientFirstName(view.diagnostic.client.name) },
    problem: view.diagnostic.problem,
    technicalConclusion: view.diagnostic.technicalConclusion,
    mechanicComment: view.diagnostic.review.mechanicComment,
    stationName: location?.name || null,
    mechanicName: mechanic?.name || null,
    counts: view.counts,
    inspections: view.inspections.map((inspection) => ({
      name: inspection.templateName,
      sections: inspection.sections.map((section) => ({
        name: section.name,
        items: section.items.filter((item) => item.state !== "NOT_CHECKED").map((item) => ({
          name: item.name,
          position: item.position,
          state: item.state,
          measurement: measurement(item),
          note: item.note,
          finding: item.finding ? {
            action: item.finding.action,
            urgency: item.finding.urgency,
            text: item.finding.findingText,
            suggestedWorkName: item.finding.suggestedWorkName,
            suggestedPartName: item.finding.suggestedPartName,
            mediaIds: item.finding.media.map((media) => media.id),
          } : null,
        })),
      })),
    })),
  };
}

export async function buildDiagnosticReportSnapshot(diagnosticRequestId: string): Promise<DiagnosticReportSnapshot> {
  const finalCard = await getFinalDiagnosticCardSnapshot(diagnosticRequestId);
  if (finalCard) return fromDiagnosticCard(finalCard);
  return buildLegacyConfirmedSnapshot(diagnosticRequestId);
}

export async function createDiagnosticReportShare(diagnosticRequestId: string, createdByUserId: string | null) {
  const prisma = getPrisma();
  const snapshot = await buildDiagnosticReportSnapshot(diagnosticRequestId);
  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const now = new Date();
  const share = await prisma.$transaction(async (tx) => {
    await tx.diagnosticReportShare.updateMany({ where: { diagnosticRequestId, revokedAt: null }, data: { revokedAt: now } });
    const created = await tx.diagnosticReportShare.create({ data: { diagnosticRequestId, tokenHash, snapshot: toPrismaJson(snapshot), expiresAt, createdByUserId } });
    await tx.auditEvent.create({
      data: {
        actorName: "CRM / Сервіс-менеджер",
        entityType: "DiagnosticRequest",
        entityId: diagnosticRequestId,
        action: "DIAGNOSTIC_CARD_SHARED",
        metadata: toPrismaJson({ shareId: created.id, expiresAt: created.expiresAt?.toISOString() || null, createdByUserId }),
      },
    });
    return created;
  });
  return { share: publicMeta(share), token, path: `/r/${token}` };
}

export async function latestDiagnosticReportShare(diagnosticRequestId: string) {
  const prisma = getPrisma();
  const [share, review, card] = await Promise.all([
    prisma.diagnosticReportShare.findFirst({ where: { diagnosticRequestId }, orderBy: { createdAt: "desc" } }),
    prisma.diagnosticReview.findUnique({ where: { diagnosticRequestId }, select: { state: true } }),
    prisma.diagnosticCard.findUnique({ where: { diagnosticRequestId }, select: { finalizedAt: true } }),
  ]);
  if (!share) return null;
  const currentRevision = Boolean(
    review &&
    reviewCanBeShared(review.state) &&
    (!card?.finalizedAt || share.createdAt.getTime() >= card.finalizedAt.getTime()),
  );
  return publicMeta(share, currentRevision);
}

export async function revokeDiagnosticReportShare(diagnosticRequestId: string, shareId?: string | null) {
  const prisma = getPrisma();
  const share = shareId ? await prisma.diagnosticReportShare.findFirst({ where: { id: shareId, diagnosticRequestId } }) : await prisma.diagnosticReportShare.findFirst({ where: { diagnosticRequestId, revokedAt: null }, orderBy: { createdAt: "desc" } });
  if (!share) throw new DiagnosticReportError("REPORT_SHARE_NOT_FOUND", "Активне посилання не знайдено.", 404);
  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.diagnosticReportShare.update({ where: { id: share.id }, data: { revokedAt: new Date() } });
    await tx.auditEvent.create({
      data: {
        actorName: "CRM / Сервіс-менеджер",
        entityType: "DiagnosticRequest",
        entityId: diagnosticRequestId,
        action: "DIAGNOSTIC_REPORT_LINK_REVOKED",
        metadata: toPrismaJson({ shareId: share.id }),
      },
    });
    return row;
  });
  return publicMeta(updated, false);
}

export async function getDiagnosticReportByToken(token: string) {
  if (!token || token.length < 20) throw new DiagnosticReportError("INVALID_REPORT_TOKEN", "Некоректне посилання на звіт.", 404);
  const prisma = getPrisma();
  const share = await prisma.diagnosticReportShare.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!share || share.revokedAt || (share.expiresAt && share.expiresAt.getTime() <= Date.now())) {
    throw new DiagnosticReportError("REPORT_LINK_EXPIRED", "Це посилання недійсне або строк його дії завершився.", 404);
  }
  const [review, card] = await Promise.all([
    prisma.diagnosticReview.findUnique({ where: { diagnosticRequestId: share.diagnosticRequestId }, select: { state: true } }),
    prisma.diagnosticCard.findUnique({ where: { diagnosticRequestId: share.diagnosticRequestId }, select: { finalizedAt: true } }),
  ]);
  if (!review || !reviewCanBeShared(review.state) || (card?.finalizedAt && share.createdAt.getTime() < card.finalizedAt.getTime())) {
    throw new DiagnosticReportError("REPORT_REVISION_OUTDATED", "Ця версія Діагностичної карти вже неактуальна. Запросіть нове посилання.", 404);
  }
  return { id: share.id, diagnosticRequestId: share.diagnosticRequestId, snapshot: share.snapshot as unknown as DiagnosticReportSnapshot, requestedPricingAt: share.requestedPricingAt, expiresAt: share.expiresAt };
}

export async function requestDiagnosticPricing(token: string) {
  const active = await getDiagnosticReportByToken(token);
  const prisma = getPrisma();
  const at = active.requestedPricingAt || new Date();
  if (!active.requestedPricingAt) {
    await prisma.$transaction(async (tx) => {
      await tx.diagnosticReportShare.update({ where: { id: active.id }, data: { requestedPricingAt: at } });
      await tx.auditEvent.create({
        data: {
          actorName: "Клієнт / public link",
          entityType: "DiagnosticRequest",
          entityId: active.diagnosticRequestId,
          action: "DIAGNOSTIC_PRICING_REQUESTED_PUBLIC",
          metadata: toPrismaJson({ shareId: active.id, source: "PUBLIC_LINK" }),
        },
      });
    });
  }
  return { ...active, requestedPricingAt: at };
}

export async function getSharedDiagnosticMedia(token: string, mediaId: string) {
  const active = await getDiagnosticReportByToken(token);
  const allowed = new Set(active.snapshot.inspections.flatMap((inspection) => inspection.sections.flatMap((section) => section.items.flatMap((item) => item.finding?.mediaIds || []))));
  if (!allowed.has(mediaId)) throw new DiagnosticReportError("REPORT_MEDIA_NOT_FOUND", "Фото не входить до цієї Діагностичної карти.", 404);
  const media = await getPrisma().diagnosticMedia.findUnique({ where: { id: mediaId } });
  if (!media) throw new DiagnosticReportError("REPORT_MEDIA_NOT_FOUND", "Фото не знайдено.", 404);
  return media;
}
