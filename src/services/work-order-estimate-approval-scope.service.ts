import { createHash } from "node:crypto";
import { Prisma } from "@/src/generated/prisma/client";
import { getPrisma } from "@/src/lib/prisma";

type Tx = Prisma.TransactionClient;

const ACTIVE_LINE_STATUSES = ["DRAFT", "APPROVED", "IN_PROGRESS", "COMPLETED"] as const;

type ApprovalScopeLine = {
  type: string;
  description: string;
  code: string | null;
  article: string | null;
  brand: string | null;
  unit: string;
  currency: string;
  plannedQuantity: string;
  plannedUnitPrice: string;
  plannedDiscount: string;
};

function cleanText(value: unknown) {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

function nullableText(value: unknown) {
  const result = cleanText(value);
  return result || null;
}

function decimalText(value: unknown, places: number) {
  try {
    return new Prisma.Decimal(String(value ?? 0)).toFixed(places);
  } catch {
    return new Prisma.Decimal(0).toFixed(places);
  }
}

function approvalScopeLine(value: Record<string, unknown>): ApprovalScopeLine {
  return {
    type: cleanText(value.type).toUpperCase(),
    description: cleanText(value.description),
    code: nullableText(value.code),
    article: nullableText(value.article),
    brand: nullableText(value.brand),
    unit: cleanText(value.unit),
    currency: cleanText(value.currency).toUpperCase(),
    plannedQuantity: decimalText(value.plannedQuantity, 3),
    plannedUnitPrice: decimalText(value.plannedUnitPrice, 2),
    plannedDiscount: decimalText(value.plannedDiscount, 2),
  };
}

function canonicalizeScope(lines: ApprovalScopeLine[]) {
  return [...lines].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

export function estimateApprovalFingerprintFromSnapshot(snapshot: unknown) {
  if (!Array.isArray(snapshot)) return null;
  const scope = canonicalizeScope(
    snapshot
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
      .map(approvalScopeLine),
  );
  return createHash("sha256").update(JSON.stringify(scope)).digest("hex");
}

async function currentApprovalFingerprintTx(tx: Tx, workOrderId: string) {
  const lines = await tx.workOrderLine.findMany({
    where: { workOrderId, status: { in: [...ACTIVE_LINE_STATUSES] } },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      type: true,
      description: true,
      code: true,
      article: true,
      brand: true,
      unit: true,
      currency: true,
      plannedQuantity: true,
      plannedUnitPrice: true,
      plannedDiscount: true,
    },
  });
  const scope = canonicalizeScope(lines.map((line) => approvalScopeLine(line as unknown as Record<string, unknown>)));
  return {
    lineCount: lines.length,
    lineIds: lines.map((line) => line.id),
    fingerprint: createHash("sha256").update(JSON.stringify(scope)).digest("hex"),
  };
}

export async function getWorkOrderEstimateApprovalStateTx(tx: Tx, workOrderId: string) {
  const [current, estimate] = await Promise.all([
    currentApprovalFingerprintTx(tx, workOrderId),
    tx.workOrderEstimate.findFirst({
      where: { workOrderId },
      orderBy: [{ revision: "desc" }, { createdAt: "desc" }],
      select: {
        id: true,
        status: true,
        approvedAt: true,
        revision: true,
        lineFingerprint: true,
        lineSnapshot: true,
      },
    }),
  ]);

  const decisions = estimate
    ? await tx.clientEstimateLineDecision.findMany({
        where: { estimateId: estimate.id },
        orderBy: { decidedAt: "asc" },
        select: { lineId: true, decision: true, estimateFingerprint: true },
      })
    : [];
  const scopedDecisions = decisions.filter((item) => current.lineIds.includes(item.lineId) && item.estimateFingerprint === estimate?.lineFingerprint);
  const approvedDecisionCount = scopedDecisions.filter((item) => item.decision === "APPROVE").length;
  const rejectedDecisionCount = scopedDecisions.filter((item) => item.decision === "REJECT").length;
  const completeDecisionSet = scopedDecisions.length === current.lineCount && current.lineCount > 0;
  const selectionMode = !completeDecisionSet
    ? null
    : rejectedDecisionCount === 0 ? "ALL_APPROVED" as const : approvedDecisionCount === 0 ? "ALL_REJECTED" as const : "MIXED" as const;

  const estimateFingerprint = estimateApprovalFingerprintFromSnapshot(estimate?.lineSnapshot ?? null);
  const isCurrent = Boolean(estimate && current.lineCount > 0 && estimateFingerprint && estimateFingerprint === current.fingerprint);
  const approved = Boolean(isCurrent && estimate?.status === "APPROVED" && estimate.approvedAt);
  const mixedPending = Boolean(isCurrent && estimate?.status === "SENT" && completeDecisionSet && selectionMode === "MIXED");

  return {
    estimate,
    lineCount: current.lineCount,
    currentFingerprint: current.fingerprint,
    estimateFingerprint,
    isCurrent,
    approved,
    decisionCount: scopedDecisions.length,
    approvedDecisionCount,
    rejectedDecisionCount,
    selectionMode,
    mixedPending,
  };
}

export async function getWorkOrderEstimateApprovalState(workOrderId: string) {
  return getWorkOrderEstimateApprovalStateTx(getPrisma(), workOrderId);
}
