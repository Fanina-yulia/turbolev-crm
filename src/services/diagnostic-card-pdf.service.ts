import { createHash, randomBytes } from "node:crypto";
import { getPrisma } from "@/src/lib/prisma";
import { toPrismaJson } from "@/src/lib/prisma-json";
import {
  DiagnosticCardError,
  ensureDiagnosticCardReviewRevision,
  type DiagnosticCardSnapshot,
} from "@/src/services/diagnostic-card.service";
import { renderDiagnosticCardPdf, type DiagnosticCardPdfMedia } from "@/src/services/diagnostic-card-pdf-renderer";

const PDF_MAX_BYTES = 15 * 1024 * 1024;
const SHARE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export class DiagnosticCardPdfError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "DiagnosticCardPdfError";
    this.code = code;
    this.status = status;
  }
}

type PdfMetaRow = {
  id: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  generatedAt: Date;
  revision: { revision: number };
};

function hashToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function safeFileName(cardNumber: string) {
  const normalized = cardNumber.replace(/[^a-zA-Z0-9а-яА-ЯіІїЇєЄґҐ._-]+/g, "-").replace(/^-+|-+$/g, "");
  return `${normalized || "diagnostic-card"}.pdf`;
}

function meta(row: PdfMetaRow, currentRevision: number) {
  return {
    id: row.id,
    fileName: row.fileName,
    mimeType: row.mimeType,
    fileSize: row.fileSize,
    generatedAt: row.generatedAt,
    revision: row.revision.revision,
    currentRevision,
    isCurrent: row.revision.revision === currentRevision,
  };
}

async function latestPdfForCard(diagnosticCardId: string) {
  return getPrisma().diagnosticCardPdf.findFirst({
    where: { diagnosticCardId },
    orderBy: { generatedAt: "desc" },
    select: {
      id: true,
      fileName: true,
      mimeType: true,
      fileSize: true,
      generatedAt: true,
      revision: { select: { revision: true } },
    },
  });
}

export async function getLatestDiagnosticCardPdf(diagnosticRequestId: string) {
  const prisma = getPrisma();
  const card = await prisma.diagnosticCard.findUnique({ where: { diagnosticRequestId }, select: { id: true, currentRevision: true } });
  if (!card) return null;
  const pdf = await latestPdfForCard(card.id);
  return pdf ? meta(pdf, card.currentRevision) : null;
}

export async function getDiagnosticCardPdfFile(diagnosticRequestId: string) {
  const prisma = getPrisma();
  const card = await prisma.diagnosticCard.findUnique({ where: { diagnosticRequestId }, select: { id: true, currentRevision: true } });
  if (!card) return null;
  const pdf = await prisma.diagnosticCardPdf.findFirst({
    where: { diagnosticCardId: card.id },
    orderBy: { generatedAt: "desc" },
    select: {
      id: true,
      fileName: true,
      mimeType: true,
      fileSize: true,
      fileData: true,
      generatedAt: true,
      revision: { select: { revision: true } },
    },
  });
  if (!pdf) return null;
  return { ...pdf, meta: meta(pdf, card.currentRevision) };
}

export async function saveDiagnosticCardPdf(
  diagnosticRequestId: string,
  createdByUserId: string | null,
  actorName = "CRM / Сервіс-менеджер",
) {
  const ensured = await ensureDiagnosticCardReviewRevision(diagnosticRequestId, createdByUserId, actorName);
  const snapshot = ensured.revision.snapshot as unknown as DiagnosticCardSnapshot;
  const mediaIds = snapshot.inspections.flatMap((inspection) => inspection.sections.flatMap((section) => section.items.flatMap((item) => item.finding?.mediaIds || [])));
  const media = mediaIds.length
    ? await getPrisma().diagnosticMedia.findMany({ where: { id: { in: mediaIds } }, select: { id: true, fileName: true, mimeType: true, fileData: true } })
    : [];
  const bytes = await renderDiagnosticCardPdf(snapshot, media as DiagnosticCardPdfMedia[]);
  if (bytes.byteLength > PDF_MAX_BYTES) {
    throw new DiagnosticCardPdfError("PDF_TOO_LARGE", "Діагностична карта містить забагато фото для одного PDF-файла.", 413);
  }

  const prisma = getPrisma();
  const saved = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`diagnostic-card-pdf:${diagnosticRequestId}`}))`;
    const existing = await tx.diagnosticCardPdf.findUnique({
      where: { diagnosticCardRevisionId: ensured.revision.id },
      select: { id: true, fileName: true, mimeType: true, fileSize: true, generatedAt: true, revision: { select: { revision: true } } },
    });
    if (existing) return { row: existing, created: false };
    const created = await tx.diagnosticCardPdf.create({
      data: {
        diagnosticCardId: ensured.card.id,
        diagnosticCardRevisionId: ensured.revision.id,
        fileName: safeFileName(ensured.card.number),
        mimeType: "application/pdf",
        fileSize: bytes.byteLength,
        fileData: bytes,
        generatedByUserId: createdByUserId,
      },
      select: { id: true, fileName: true, mimeType: true, fileSize: true, generatedAt: true, revision: { select: { revision: true } } },
    });
    await tx.auditEvent.create({
      data: {
        actorId: createdByUserId,
        actorName,
        entityType: "DiagnosticCardPdf",
        entityId: created.id,
        action: "DIAGNOSTIC_CARD_PDF_CREATED",
        metadata: toPrismaJson({ diagnosticRequestId, diagnosticCardId: ensured.card.id, revision: ensured.revision.revision, fileName: created.fileName, fileSize: created.fileSize }),
      },
    });
    return { row: created, created: true };
  });

  return {
    created: saved.created,
    cardNumber: ensured.card.number,
    revision: ensured.revision.revision,
    pdf: meta(saved.row, ensured.card.currentRevision),
  };
}

export async function createDiagnosticCardPdfShare(diagnosticRequestId: string, createdByUserId: string | null) {
  const pdf = await getDiagnosticCardPdfFile(diagnosticRequestId);
  if (!pdf) throw new DiagnosticCardPdfError("PDF_NOT_SAVED", "Спочатку збережіть діагностичну карту у PDF-файл.", 409);
  if (!pdf.meta.isCurrent) throw new DiagnosticCardPdfError("PDF_OUTDATED", "Діагностична карта змінилася. Спочатку збережіть актуальну версію у PDF-файл.", 409);
  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SHARE_TTL_MS);
  const prisma = getPrisma();
  const share = await prisma.$transaction(async (tx) => {
    await tx.diagnosticCardPdfShare.updateMany({ where: { pdfId: pdf.id, revokedAt: null }, data: { revokedAt: now } });
    const created = await tx.diagnosticCardPdfShare.create({
      data: { pdfId: pdf.id, tokenHash: hashToken(token), expiresAt, createdByUserId },
    });
    await tx.auditEvent.create({
      data: {
        actorId: createdByUserId,
        actorName: "CRM / Сервіс-менеджер",
        entityType: "DiagnosticCardPdf",
        entityId: pdf.id,
        action: "DIAGNOSTIC_CARD_PDF_SHARED",
        metadata: toPrismaJson({ diagnosticRequestId, shareId: created.id, expiresAt: expiresAt.toISOString() }),
      },
    });
    return created;
  });
  return {
    share: { id: share.id, expiresAt: share.expiresAt, pdfId: share.pdfId },
    token,
    path: `/api/public/diagnostic-card-pdf/${token}`,
  };
}

export async function getDiagnosticCardPdfByToken(token: string) {
  if (!token || token.length < 20) throw new DiagnosticCardPdfError("INVALID_PDF_TOKEN", "Некоректне посилання на PDF-файл.", 404);
  const share = await getPrisma().diagnosticCardPdfShare.findUnique({ where: { tokenHash: hashToken(token) }, include: { pdf: true } });
  if (!share || share.revokedAt || (share.expiresAt && share.expiresAt.getTime() <= Date.now())) {
    throw new DiagnosticCardPdfError("PDF_LINK_EXPIRED", "Це посилання на PDF-файл недійсне або строк його дії завершився.", 404);
  }
  return share.pdf;
}

export { DiagnosticCardError };
