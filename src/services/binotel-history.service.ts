import "server-only";

import { randomUUID } from "node:crypto";
import { CommunicationChannel, Prisma } from "@/src/generated/prisma/client";
import { getPrisma } from "@/src/lib/prisma";
import { normalizePhone } from "@/src/lib/phone";
import { getBinotelService, type BinotelApiResponse } from "@/src/services/binotel.service";
import { processBinotelWebhook } from "@/src/services/binotel-webhook.service";

type JsonRecord = Record<string, unknown>;

export type BinotelHistorySummary = {
  callId: string;
  callType: number | null;
  externalNumber: string | null;
  internalNumber: string | null;
  startTime: number | null;
  waitsec: number;
  billsec: number;
  disposition: string | null;
  employeeName: string | null;
  employeeEmail: string | null;
  pbxNumber: string | null;
};

const BINOTEL_HEAVY_SLOT_ID = "rest-heavy-api-slot";
const BINOTEL_HEAVY_SLOT_EVENT = "restHeavyApiSlot";
const BINOTEL_RECONCILIATION_EVENT = "restHistoryReconciliation";
const BINOTEL_HEAVY_MIN_INTERVAL_MS = 11_000;

function record(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;
}

function text(obj: JsonRecord | null, key: string): string | null {
  if (!obj) return null;
  const value = obj[key];
  if (typeof value !== "string" && typeof value !== "number") return null;
  const result = String(value).trim();
  return result || null;
}

function integer(obj: JsonRecord | null, key: string): number | null {
  const value = text(obj, key);
  if (value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? Math.floor(number) : null;
}

function toJson(value: JsonRecord): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function prismaErrorCode(error: unknown): string {
  return error && typeof error === "object" && "code" in error
    ? String((error as { code?: unknown }).code || "")
    : "";
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function extractBinotelCallDetails(response: BinotelApiResponse): JsonRecord[] {
  const source = response.callDetails;
  if (Array.isArray(source)) return source.map(record).filter(Boolean) as JsonRecord[];
  const object = record(source);
  if (!object) return [];

  const directCall = text(object, "generalCallID") || text(object, "callID");
  if (directCall) return [object];

  return Object.values(object).map(record).filter(Boolean) as JsonRecord[];
}

export function buildBinotelCompletedPayload(detail: JsonRecord): JsonRecord {
  const startTime = integer(detail, "startTime");
  const waitsec = Math.max(0, integer(detail, "waitsec") || 0);
  const billsec = Math.max(0, integer(detail, "billsec") || 0);
  const disposition = (text(detail, "disposition") || "").toUpperCase();
  const answered = disposition === "ANSWER" || disposition === "TRANSFER" || billsec > 0;

  return {
    ...detail,
    ...(startTime && detail.answerTime == null && answered ? { answerTime: startTime + waitsec } : {}),
    ...(startTime && detail.endTime == null ? { endTime: startTime + waitsec + billsec } : {}),
  };
}

export function summarizeBinotelCall(detail: JsonRecord): BinotelHistorySummary | null {
  const callId = text(detail, "generalCallID") || text(detail, "callID");
  if (!callId) return null;
  const employeeData = record(detail.employeeData);
  const pbxNumberData = record(detail.pbxNumberData);
  const external = text(detail, "externalNumber");

  return {
    callId,
    callType: integer(detail, "callType"),
    externalNumber: external ? normalizePhone(external) || external : null,
    internalNumber: text(detail, "internalAdditionalData") || text(detail, "internalNumber"),
    startTime: integer(detail, "startTime"),
    waitsec: Math.max(0, integer(detail, "waitsec") || 0),
    billsec: Math.max(0, integer(detail, "billsec") || 0),
    disposition: text(detail, "disposition"),
    employeeName: text(employeeData, "name"),
    employeeEmail: text(employeeData, "email"),
    pbxNumber: text(pbxNumberData, "number"),
  };
}

export async function getBinotelHistoryForPhone(phone: string) {
  const normalized = normalizePhone(phone);
  if (!normalized) throw new TypeError("PHONE_REQUIRED");
  const response = await getBinotelService().getHistoryByExternalNumber([normalized]);
  return extractBinotelCallDetails(response)
    .map(summarizeBinotelCall)
    .filter(Boolean) as BinotelHistorySummary[];
}

export async function claimBinotelHeavyApiSlot(minIntervalMs = BINOTEL_HEAVY_MIN_INTERVAL_MS) {
  const prisma = getPrisma();
  const safeInterval = Math.max(5_000, Math.floor(minIntervalMs));
  const now = new Date();
  const cutoff = new Date(now.getTime() - safeInterval);
  const payload = toJson({ claimedAt: now.toISOString(), minIntervalMs: safeInterval });

  const updated = await prisma.webhookEvent.updateMany({
    where: {
      channel: CommunicationChannel.BINOTEL,
      externalEventId: BINOTEL_HEAVY_SLOT_ID,
      OR: [
        { processedAt: null },
        { processedAt: { lte: cutoff } },
      ],
    },
    data: {
      eventType: BINOTEL_HEAVY_SLOT_EVENT,
      payload,
      status: "PROCESSED",
      processedAt: now,
      error: null,
    },
  });
  if (updated.count > 0) return true;

  try {
    await prisma.webhookEvent.create({
      data: {
        id: randomUUID(),
        channel: CommunicationChannel.BINOTEL,
        externalEventId: BINOTEL_HEAVY_SLOT_ID,
        eventType: BINOTEL_HEAVY_SLOT_EVENT,
        payload,
        status: "PROCESSED",
        processedAt: now,
      },
    });
    return true;
  } catch (error) {
    if (prismaErrorCode(error) === "P2002") return false;
    throw error;
  }
}

export async function waitForBinotelHeavyApiSlot(
  minIntervalMs = BINOTEL_HEAVY_MIN_INTERVAL_MS,
  timeoutMs = 30_000,
) {
  const deadline = Date.now() + Math.max(minIntervalMs, timeoutMs);
  while (Date.now() <= deadline) {
    if (await claimBinotelHeavyApiSlot(minIntervalMs)) return;
    await sleep(500);
  }
  throw new Error("BINOTEL_HEAVY_API_SLOT_TIMEOUT");
}

export async function isBinotelReconciliationInProgress() {
  const recent = new Date(Date.now() - 2 * 60_000);
  const event = await getPrisma().webhookEvent.findFirst({
    where: {
      channel: CommunicationChannel.BINOTEL,
      eventType: BINOTEL_RECONCILIATION_EVENT,
      status: "RECEIVED",
      createdAt: { gte: recent },
    },
    select: { id: true },
  });
  return Boolean(event);
}

export async function claimBinotelReconciliationBucket(bucketMinutes = 30) {
  const now = new Date();
  const bucketMs = bucketMinutes * 60_000;
  const bucket = new Date(Math.floor(now.getTime() / bucketMs) * bucketMs).toISOString();
  const externalEventId = `rest-reconcile:${bucket}`;
  const payload = toJson({ bucket, bucketMinutes });
  try {
    await getPrisma().webhookEvent.create({
      data: {
        id: randomUUID(),
        channel: CommunicationChannel.BINOTEL,
        externalEventId,
        eventType: BINOTEL_RECONCILIATION_EVENT,
        payload,
        status: "RECEIVED",
      },
    });
    return { claimed: true, externalEventId };
  } catch (error) {
    if (prismaErrorCode(error) !== "P2002") throw error;

    const reclaimed = await getPrisma().webhookEvent.updateMany({
      where: {
        channel: CommunicationChannel.BINOTEL,
        externalEventId,
        status: "ERROR",
      },
      data: {
        eventType: BINOTEL_RECONCILIATION_EVENT,
        payload,
        status: "RECEIVED",
        processedAt: null,
        error: null,
      },
    });
    return { claimed: reclaimed.count > 0, externalEventId };
  }
}

export async function finishBinotelReconciliationBucket(externalEventId: string, status: "PROCESSED" | "ERROR", payload: JsonRecord) {
  await getPrisma().webhookEvent.update({
    where: {
      channel_externalEventId: {
        channel: CommunicationChannel.BINOTEL,
        externalEventId,
      },
    },
    data: {
      status,
      payload: toJson(payload),
      processedAt: status === "PROCESSED" ? new Date() : null,
      error: status === "ERROR" ? String(payload.error || "REST reconciliation failed") : null,
    },
  }).catch(() => undefined);
}

export async function reconcileRecentBinotelHistory(lookbackMinutes = 90) {
  const stopTime = Math.floor(Date.now() / 1000);
  const boundedLookback = Math.min(Math.max(Math.floor(lookbackMinutes), 15), 24 * 60);
  const startTime = stopTime - boundedLookback * 60;
  const service = getBinotelService();

  await waitForBinotelHeavyApiSlot();
  const incoming = await service.getIncomingCallsForPeriod({ startTime, stopTime });

  await waitForBinotelHeavyApiSlot();
  const outgoing = await service.getOutgoingCallsForPeriod({ startTime, stopTime });

  const details = [
    ...extractBinotelCallDetails(incoming),
    ...extractBinotelCallDetails(outgoing),
  ];
  const unique = new Map<string, JsonRecord>();
  for (const detail of details) {
    const id = text(detail, "generalCallID") || text(detail, "callID");
    if (id) unique.set(id, detail);
  }

  const ids = [...unique.keys()];
  const existing = ids.length
    ? await getPrisma().callHistory.findMany({
        where: { binotelCallId: { in: ids } },
        select: { binotelCallId: true, endedAt: true, status: true },
      })
    : [];
  const complete = new Set(existing.filter((call) => call.endedAt && call.status).map((call) => call.binotelCallId));

  let restored = 0;
  let refreshed = 0;
  const failed: Array<{ callId: string; error: string }> = [];

  for (const [callId, detail] of unique) {
    if (complete.has(callId)) continue;
    try {
      await processBinotelWebhook({
        requestType: "apiCallCompleted",
        callDetails: buildBinotelCompletedPayload(detail),
      });
      if (existing.some((call) => call.binotelCallId === callId)) refreshed += 1;
      else restored += 1;
    } catch (error) {
      failed.push({ callId, error: error instanceof Error ? error.message : "unknown error" });
    }
  }

  return {
    startTime,
    stopTime,
    providerCalls: unique.size,
    alreadyComplete: complete.size,
    restored,
    refreshed,
    failed,
  };
}
