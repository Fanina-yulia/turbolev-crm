import { createHash } from "node:crypto";
import { DiagnosticCardRevisionKind, DiagnosticReviewState, Prisma } from "@/src/generated/prisma/client";
import { getPrisma } from "@/src/lib/prisma";
import { toPrismaJson } from "@/src/lib/prisma-json";
import { getDiagnosticVisitContext } from "@/src/services/diagnostic-visit-link.service";
import { getStructuredDiagnostic } from "@/src/services/structured-diagnostics.service";

export class DiagnosticCardError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "DiagnosticCardError";
    this.code = code;
    this.status = status;
  }
}

type CardKind = "REVIEW" | "FINAL";

type DiagnosticCardSnapshot = {
  version: 1;
  cardNumber: string;
  diagnosticRequestId: string;
  revisionKind: CardKind;
  generatedAt: string;
  vehicle: {
    id: string;
    label: string;
    brand: string | null;
    model: string | null;
    year: number | null;
    plateNumber: string | null;
    vin: string | null;
    mileageKm: number | null;
  };
  visit?: {
    appointmentId: string | null;
    plannedStartAt: string | null;
    plannedEndAt: string | null;
    actualArrivalAt: string | null;
    actualStartAt: string | null;
    actualEndAt: string | null;
    locationId: string | null;
    postId: string | null;
    mechanicId: string | null;
    problem: string | null;
    source: string | null;
  };
  client: { id: string; name: string | null; phone: string };
  problem: string | null;
  station: { id: string | null; name: string | null };
  mechanic: { id: string | null; name: string | null };
  reviewer: { id: string | null; name: string | null };
  counts: { total: number; checked: number; ok: number; attention: number; defect: number; critical: number };
  technicalConclusion: string | null;
  mechanicComment: string | null;
  managerComment: string | null;
  recommendations: {
    works: Array<{ findingId: string; name: string; action: string; urgency: string; section: string; checkName: string }>;
    parts: Array<{ findingId: string; name: string; action: string; urgency: string; section: string; checkName: string }>;
  };
  inspections: Array<{
    name: string;
    sections: Array<{
      name: string;
      items: Array<{
        checkId: string | null;
        name: string;
        position: string | null;
        state: string;
        measurementValue: string | null;
        measurementText: string | null;
        measurementUnit: string | null;
        note: string | null;
        finding: null | {
          id: string;
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

type BuiltCard = {
  sourceFingerprint: string;
  snapshotWithoutIdentity: Omit<DiagnosticCardSnapshot, "cardNumber" | "revisionKind" | "generatedAt">;
};

function hash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function clean(value: string | null | undefined) {
  const next = value?.trim();
  return next || null;
}

function iso(value: Date | null | undefined) {
  return value ? value.toISOString() : null;
}

async function buildCardSource(
  diagnosticRequestId: string,
  options: { reviewerUserId?: string | null; technicalConclusion?: string | null } = {},
): Promise<BuiltCard> {
  const prisma = getPrisma();
  const view = await getStructuredDiagnostic(diagnosticRequestId);
  if (!view.inspections.length) {
    throw new DiagnosticCardError("DIAGNOSTIC_CARD_EMPTY", "Діагностичну карту можна сформувати лише зі структурованої діагностики.", 409);
  }
  const assignment = view.diagnostic.assignment;
  const [mechanic, station, reviewer, visitContext] = await Promise.all([
    assignment?.mechanicId ? prisma.serviceMechanic.findUnique({ where: { id: assignment.mechanicId }, select: { id: true, name: true } }) : null,
    assignment?.locationId ? prisma.serviceLocation.findUnique({ where: { id: assignment.locationId }, select: { id: true, name: true } }) : null,
    options.reviewerUserId ? prisma.user.findUnique({ where: { id: options.reviewerUserId }, select: { id: true, name: true } }) : null,
    getDiagnosticVisitContext(diagnosticRequestId),
  ]);

  const visit = {
    appointmentId: visitContext.appointmentId,
    plannedStartAt: iso(visitContext.plannedStartAt),
    plannedEndAt: iso(visitContext.plannedEndAt),
    actualArrivalAt: iso(visitContext.actualArrivalAt),
    actualStartAt: iso(visitContext.actualStartAt),
    actualEndAt: iso(visitContext.actualEndAt),
    locationId: visitContext.locationId,
    postId: visitContext.postId,
    mechanicId: visitContext.mechanicId,
    problem: visitContext.problem,
    source: visitContext.source,
  };

  const findings = view.inspections.flatMap((inspection) => inspection.sections.flatMap((section) => section.items.flatMap((item) => item.finding ? [{ inspection, section, item, finding: item.finding }] : [])));
  const critical = findings.filter(({ finding }) => finding.urgency === "CRITICAL").length;
  const works = findings.flatMap(({ section, item, finding }) => clean(finding.suggestedWorkName) ? [{ findingId: finding.id, name: clean(finding.suggestedWorkName)!, action: finding.action, urgency: finding.urgency, section: section.name, checkName: item.name }] : []);
  const parts = findings.flatMap(({ section, item, finding }) => clean(finding.suggestedPartName) ? [{ findingId: finding.id, name: clean(finding.suggestedPartName)!, action: finding.action, urgency: finding.urgency, section: section.name, checkName: item.name }] : []);

  const inspections = view.inspections.map((inspection) => ({
    name: inspection.templateName,
    sections: inspection.sections.map((section) => ({
      name: section.name,
      items: section.items.filter((item) => item.state !== "NOT_CHECKED").map((item) => ({
        checkId: item.id,
        name: item.name,
        position: item.position,
        state: item.state,
        measurementValue: item.measurementValue,
        measurementText: item.measurementText,
        measurementUnit: item.measurementUnit,
        note: item.note,
        finding: item.finding ? {
          id: item.finding.id,
          action: item.finding.action,
          urgency: item.finding.urgency,
          text: item.finding.findingText,
          suggestedWorkName: item.finding.suggestedWorkName,
          suggestedPartName: item.finding.suggestedPartName,
          mediaIds: item.finding.media.map((media) => media.id),
        } : null,
      })),
    })),
  }));

  const source = {
    diagnosticRequestId,
    vehicle: view.diagnostic.vehicle,
    visit,
    client: view.diagnostic.client,
    problem: view.diagnostic.problem,
    assignment,
    mechanicComment: view.diagnostic.review.mechanicComment,
    managerComment: view.diagnostic.review.managerComment,
    counts: view.counts,
    inspections,
  };

  return {
    sourceFingerprint: hash(source),
    snapshotWithoutIdentity: {
      version: 1,
      diagnosticRequestId,
      vehicle: {
        id: view.diagnostic.vehicle.id,
        label: view.diagnostic.vehicle.label,
        brand: view.diagnostic.vehicle.brand,
        model: view.diagnostic.vehicle.model,
        year: view.diagnostic.vehicle.year,
        plateNumber: view.diagnostic.vehicle.plateNumber,
        vin: view.diagnostic.vehicle.vin,
        mileageKm: view.diagnostic.vehicle.mileageKm,
      },
      visit,
      client: { id: view.diagnostic.client.id, name: view.diagnostic.client.name, phone: view.diagnostic.client.phone },
      problem: view.diagnostic.problem,
      station: { id: assignment?.locationId || null, name: station?.name || null },
      mechanic: { id: assignment?.mechanicId || null, name: mechanic?.name || null },
      reviewer: { id: options.reviewerUserId || null, name: reviewer?.name || null },
      counts: { ...view.counts, critical },
      technicalConclusion: clean(options.technicalConclusion) || clean(view.diagnostic.technicalConclusion),
      mechanicComment: view.diagnostic.review.mechanicComment,
      managerComment: view.diagnostic.review.managerComment,
      recommendations: { works, parts },
      inspections,
    },
  };
}

async function nextCardNumber(tx: Prisma.TransactionClient) {
  const rows = await tx.$queryRaw<Array<{ value: bigint }>>`SELECT nextval('diagnostic_card_number_seq') AS value`;
  const sequence = Number(rows[0]?.value || 0);
  const year = new Date().getFullYear();
  return `ДК-${year}-${String(sequence).padStart(6, "0")}`;
}

function snapshot(built: BuiltCard, cardNumber: string, kind: CardKind): DiagnosticCardSnapshot {
  return {
    ...built.snapshotWithoutIdentity,
    cardNumber,
    revisionKind: kind,
    generatedAt: new Date().toISOString(),
  };
}

export async function ensureDiagnosticCardReviewRevision(
  diagnosticRequestId: string,
  createdByUserId: string | null = null,
  actorName = "CRM / Автомеханік",
) {
  const prisma = getPrisma();
  const built = await buildCardSource(diagnosticRequestId);
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`diagnostic-card:${diagnosticRequestId}`}))`;
    let card = await tx.diagnosticCard.findUnique({ where: { diagnosticRequestId } });
    if (!card) {
      const number = await nextCardNumber(tx);
      card = await tx.diagnosticCard.create({ data: { diagnosticRequestId, number, currentRevision: 0 } });
    }
    const latest = await tx.diagnosticCardRevision.findFirst({ where: { diagnosticCardId: card.id }, orderBy: { revision: "desc" } });
    if (latest?.kind === DiagnosticCardRevisionKind.FINAL) return { card, revision: latest, created: false };
    if (latest?.kind === DiagnosticCardRevisionKind.REVIEW && latest.sourceFingerprint === built.sourceFingerprint) {
      return { card, revision: latest, created: false };
    }
    const revisionNumber = card.currentRevision + 1;
    const revision = await tx.diagnosticCardRevision.create({
      data: {
        diagnosticCardId: card.id,
        revision: revisionNumber,
        kind: DiagnosticCardRevisionKind.REVIEW,
        sourceFingerprint: built.sourceFingerprint,
        snapshot: toPrismaJson(snapshot(built, card.number, "REVIEW")),
        createdByUserId,
      },
    });
    card = await tx.diagnosticCard.update({ where: { id: card.id }, data: { currentRevision: revisionNumber } });
    await tx.auditEvent.create({
      data: {
        actorId: createdByUserId,
        actorName,
        entityType: "DiagnosticCard",
        entityId: card.id,
        action: "DIAGNOSTIC_CARD_REVIEW_GENERATED",
        metadata: toPrismaJson({ diagnosticRequestId, number: card.number, revision: revisionNumber, sourceFingerprint: built.sourceFingerprint, appointmentId: built.snapshotWithoutIdentity.visit?.appointmentId || null }),
      },
    });
    return { card, revision, created: true };
  });
}

export async function finalizeDiagnosticCard(
  diagnosticRequestId: string,
  input: { reviewerUserId: string | null; technicalConclusion?: string | null; actorName?: string | null },
) {
  const prisma = getPrisma();
  const view = await getStructuredDiagnostic(diagnosticRequestId);
  const reviewState = view.diagnostic.review.state;
  if (reviewState !== DiagnosticReviewState.SUBMITTED && reviewState !== DiagnosticReviewState.CONFIRMED) {
    throw new DiagnosticCardError("DIAGNOSTIC_NOT_SUBMITTED", "Спочатку автомеханік має завершити діагностику та передати її на перевірку.", 409);
  }
  const built = await buildCardSource(diagnosticRequestId, { reviewerUserId: input.reviewerUserId, technicalConclusion: input.technicalConclusion });
  const actorName = clean(input.actorName) || "CRM / Сервіс-менеджер";

  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`diagnostic-card:${diagnosticRequestId}`}))`;
    let card = await tx.diagnosticCard.findUnique({ where: { diagnosticRequestId } });
    if (!card) {
      const number = await nextCardNumber(tx);
      card = await tx.diagnosticCard.create({ data: { diagnosticRequestId, number, currentRevision: 0 } });
    }
    const latest = await tx.diagnosticCardRevision.findFirst({ where: { diagnosticCardId: card.id }, orderBy: { revision: "desc" } });
    if (latest?.kind === DiagnosticCardRevisionKind.FINAL) {
      return { card, revision: latest, created: false };
    }

    let currentRevision = card.currentRevision;
    if (!latest || latest.sourceFingerprint !== built.sourceFingerprint || latest.kind !== DiagnosticCardRevisionKind.REVIEW) {
      currentRevision += 1;
      await tx.diagnosticCardRevision.create({
        data: {
          diagnosticCardId: card.id,
          revision: currentRevision,
          kind: DiagnosticCardRevisionKind.REVIEW,
          sourceFingerprint: built.sourceFingerprint,
          snapshot: toPrismaJson(snapshot(built, card.number, "REVIEW")),
          createdByUserId: input.reviewerUserId,
        },
      });
    }

    currentRevision += 1;
    const revision = await tx.diagnosticCardRevision.create({
      data: {
        diagnosticCardId: card.id,
        revision: currentRevision,
        kind: DiagnosticCardRevisionKind.FINAL,
        sourceFingerprint: built.sourceFingerprint,
        snapshot: toPrismaJson(snapshot(built, card.number, "FINAL")),
        createdByUserId: input.reviewerUserId,
      },
    });
    card = await tx.diagnosticCard.update({
      where: { id: card.id },
      data: { currentRevision, finalizedAt: card.finalizedAt || new Date(), confirmedByUserId: input.reviewerUserId },
    });
    await tx.auditEvent.create({
      data: {
        actorId: input.reviewerUserId,
        actorName,
        entityType: "DiagnosticCard",
        entityId: card.id,
        action: "DIAGNOSTIC_CARD_CONFIRMED",
        metadata: toPrismaJson({ diagnosticRequestId, number: card.number, revision: currentRevision, sourceFingerprint: built.sourceFingerprint, appointmentId: built.snapshotWithoutIdentity.visit?.appointmentId || null }),
      },
    });
    return { card, revision, created: true };
  });
}

export async function getDiagnosticCard(diagnosticRequestId: string) {
  const prisma = getPrisma();
  const card = await prisma.diagnosticCard.findUnique({ where: { diagnosticRequestId } });
  if (!card) return null;
  const revisions = await prisma.diagnosticCardRevision.findMany({ where: { diagnosticCardId: card.id }, orderBy: { revision: "desc" } });
  const final = revisions.find((item) => item.kind === DiagnosticCardRevisionKind.FINAL) || null;
  const latest = revisions[0] || null;
  return { card, latest, final, revisions };
}

export async function getDiagnosticCardMeta(diagnosticRequestId: string) {
  return getPrisma().diagnosticCard.findUnique({
    where: { diagnosticRequestId },
    select: { id: true, number: true, currentRevision: true, finalizedAt: true },
  });
}

export async function getFinalDiagnosticCardSnapshot(diagnosticRequestId: string) {
  const state = await getDiagnosticCard(diagnosticRequestId);
  return (state?.final?.snapshot as DiagnosticCardSnapshot | undefined) ?? null;
}

export type { DiagnosticCardSnapshot };
