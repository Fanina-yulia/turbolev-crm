import {
  CallStatus,
  CallType,
  LeadSource,
  LeadStatus,
  Prisma,
} from "@/src/generated/prisma/client";
import { getPrisma } from "@/src/lib/prisma";
import { normalizePhone, phoneVariants } from "@/src/lib/phone";
import { getBinotelService } from "@/src/services/binotel.service";

export type SupportedBinotelEvent =
  | "incomingCall"
  | "answeredTheCall"
  | "hangupTheCall";

export class BinotelWebhookPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BinotelWebhookPayloadError";
  }
}

export class UnsupportedBinotelWebhookEvent extends Error {
  readonly eventName: string;

  constructor(eventName: string) {
    super(`Unsupported Binotel webhook event: ${eventName || "unknown"}`);
    this.name = "UnsupportedBinotelWebhookEvent";
    this.eventName = eventName;
  }
}

type JsonRecord = Record<string, unknown>;

type ParsedWebhook = {
  event: SupportedBinotelEvent;
  callId: string;
  externalNumber: string | null;
  internalNumber: string | null;
  type: CallType | null;
  duration: number | null;
  startedAt: Date | null;
  answeredAt: Date | null;
  endedAt: Date | null;
  terminalHint: string | null;
  raw: JsonRecord;
};

const ACTIVE_LEAD_STATUSES = new Set<LeadStatus>([
  LeadStatus.NEW,
  LeadStatus.QUALIFYING,
  LeadStatus.WARM_LEAD,
  LeadStatus.BOOKED,
]);

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function searchableContainers(raw: JsonRecord): JsonRecord[] {
  const nestedNames = ["data", "call", "request", "payload"];
  const nested = nestedNames.map((name) => raw[name]).filter(isRecord);
  return [raw, ...nested];
}

function firstField(raw: JsonRecord, names: string[]): unknown {
  for (const container of searchableContainers(raw)) {
    for (const name of names) {
      const value = container[name];
      if (value !== undefined && value !== null && value !== "") return value;
    }
  }
  return undefined;
}

function firstString(raw: JsonRecord, names: string[]): string | null {
  const value = firstField(raw, names);
  if (value === undefined || value === null) return null;
  const result = String(value).trim();
  return result || null;
}

function firstInteger(raw: JsonRecord, names: string[]): number | null {
  const value = firstField(raw, names);
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return null;
  return Math.floor(number);
}

function parseDateValue(value: unknown): Date | null {
  if (value === undefined || value === null || value === "") return null;

  if (typeof value === "number" || /^\d+$/.test(String(value))) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return null;
    const milliseconds = numeric < 10_000_000_000 ? numeric * 1000 : numeric;
    const date = new Date(milliseconds);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

function firstDate(raw: JsonRecord, names: string[]): Date | null {
  return parseDateValue(firstField(raw, names));
}

function normalizeEventName(value: string | null): SupportedBinotelEvent {
  const normalized = (value || "").toLowerCase().replace(/[^a-z]/g, "");

  if (normalized === "incomingcall" || normalized === "receivedthecall") {
    return "incomingCall";
  }
  if (normalized === "answeredthecall" || normalized === "callanswered") {
    return "answeredTheCall";
  }
  if (
    normalized === "hangupthecall" ||
    normalized === "callcompleted" ||
    normalized === "apicallcompleted" ||
    normalized === "hangup"
  ) {
    return "hangupTheCall";
  }

  throw new UnsupportedBinotelWebhookEvent(value || "");
}

function inferCallType(raw: JsonRecord, event: SupportedBinotelEvent): CallType | null {
  const rawDirection = firstString(raw, [
    "direction",
    "callDirection",
    "callType",
    "type",
  ]);
  const direction = rawDirection?.toLowerCase();

  if (direction === "0") return CallType.INCOMING;
  if (direction === "1") return CallType.OUTGOING;
  if (direction && /(outgoing|outbound|external)/.test(direction)) {
    return CallType.OUTGOING;
  }
  if (direction && /(incoming|inbound)/.test(direction)) {
    return CallType.INCOMING;
  }

  return event === "incomingCall" ? CallType.INCOMING : null;
}

function toJson(value: JsonRecord): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export function parseBinotelWebhook(raw: JsonRecord): ParsedWebhook {
  const event = normalizeEventName(
    firstString(raw, ["eventName", "eventType", "requestType", "action", "method", "event"]),
  );

  const callId = firstString(raw, [
    "generalCallID",
    "generalCallId",
    "callID",
    "callId",
    "id",
  ]);
  if (!callId) {
    throw new BinotelWebhookPayloadError("Binotel webhook has no call identifier");
  }

  const rawExternalNumber = firstString(raw, [
    "externalNumber",
    "externalPhone",
    "customerNumber",
    "clientNumber",
    "phone",
    "from",
  ]);

  const normalizedExternal = rawExternalNumber
    ? normalizePhone(rawExternalNumber)
    : null;

  return {
    event,
    callId,
    externalNumber: normalizedExternal || null,
    internalNumber: firstString(raw, [
      "internalNumber",
      "internalPhone",
      "employeeNumber",
      "extension",
      "to",
    ]),
    type: inferCallType(raw, event),
    duration: firstInteger(raw, ["duration", "callDuration", "billsec", "billSec", "seconds"]),
    startedAt: firstDate(raw, ["startedAt", "startTime", "startTimestamp", "callStartTime"]),
    answeredAt: firstDate(raw, ["answeredAt", "answerTime", "answerTimestamp"]),
    endedAt: firstDate(raw, ["endedAt", "endTime", "hangupTime", "endTimestamp"]),
    terminalHint: firstString(raw, [
      "status",
      "callStatus",
      "disposition",
      "reason",
      "hangupCause",
      "cause",
    ]),
    raw,
  };
}

function isBusyHint(hint: string | null): boolean {
  return Boolean(hint && /(busy|user.?busy|486|зайнят)/i.test(hint));
}

function isAnsweredHint(hint: string | null): boolean {
  return Boolean(hint && /(answered|answer|success|completed|normal.?clearing)/i.test(hint));
}

function calculateDurationSeconds(
  startedAt: Date | null,
  answeredAt: Date | null,
  endedAt: Date | null,
): number {
  if (!endedAt) return 0;
  const start = answeredAt || startedAt;
  if (!start) return 0;
  return Math.max(0, Math.floor((endedAt.getTime() - start.getTime()) / 1000));
}

export async function processBinotelWebhook(raw: JsonRecord) {
  const parsed = parseBinotelWebhook(raw);
  const prisma = getPrisma();

  const existing = await prisma.callHistory.findUnique({
    where: { binotelCallId: parsed.callId },
  });

  const externalNumber = parsed.externalNumber || existing?.externalNumber || "";
  if (!externalNumber) {
    throw new BinotelWebhookPayloadError(
      "Binotel webhook has no external number and call is unknown",
    );
  }

  const normalizedNumber = normalizePhone(externalNumber);
  if (!normalizedNumber) {
    throw new BinotelWebhookPayloadError("External number cannot be normalized");
  }

  const variants = phoneVariants(normalizedNumber);
  const now = new Date();

  const result = await prisma.$transaction(async (tx) => {
    let client = existing?.clientId
      ? await tx.client.findUnique({ where: { id: existing.clientId } })
      : null;

    let lead = existing?.leadId
      ? await tx.lead.findUnique({ where: { id: existing.leadId } })
      : null;

    if (!client && !lead) {
      client = await tx.client.findFirst({
        where: {
          OR: [
            { phoneNormalized: normalizedNumber },
            ...(variants.length ? [{ phone: { in: variants } }] : []),
          ],
        },
      });
    }

    let activeWorkOrder = client
      ? await tx.workOrder.findFirst({
          where: { clientId: client.id, closedAt: null },
          orderBy: { updatedAt: "desc" },
        })
      : null;

    let createdLead = false;

    if (!client && !lead) {
      lead = await tx.lead.findFirst({
        where: {
          OR: [
            { phoneNormalized: normalizedNumber },
            ...(variants.length ? [{ phone: { in: variants } }] : []),
          ],
        },
        orderBy: { updatedAt: "desc" },
      });
    }

    if (!client && !lead) {
      lead = await tx.lead.create({
        data: {
          phone: normalizedNumber,
          phoneNormalized: normalizedNumber,
          status: LeadStatus.NEW,
          source: LeadSource.BINOTEL,
        },
      });
      createdLead = true;
    } else if (!client && lead && ACTIVE_LEAD_STATUSES.has(lead.status)) {
      lead = await tx.lead.update({
        where: { id: lead.id },
        data: { updatedAt: now },
      });
    }

    const internalNumber = parsed.internalNumber || existing?.internalNumber || null;
    const manager = internalNumber
      ? await tx.user.findUnique({ where: { internalNumber } })
      : null;

    const startedAt =
      parsed.startedAt || existing?.startedAt ||
      (parsed.event === "incomingCall" ? now : null);
    const answeredAt =
      parsed.answeredAt || existing?.answeredAt ||
      (parsed.event === "answeredTheCall" ? now : null);
    const endedAt =
      parsed.endedAt || existing?.endedAt ||
      (parsed.event === "hangupTheCall" ? now : null);

    let status = existing?.status || null;
    if (parsed.event === "answeredTheCall") status = CallStatus.ANSWERED;

    if (parsed.event === "hangupTheCall") {
      if (
        answeredAt ||
        existing?.status === CallStatus.ANSWERED ||
        isAnsweredHint(parsed.terminalHint)
      ) {
        status = CallStatus.ANSWERED;
      } else if (isBusyHint(parsed.terminalHint)) {
        status = CallStatus.BUSY;
      } else {
        status = CallStatus.MISSED;
      }
    }

    const duration = Math.max(
      existing?.duration || 0,
      parsed.duration || 0,
      calculateDurationSeconds(startedAt, answeredAt, endedAt),
    );

    if (client && !activeWorkOrder && existing?.workOrderId) {
      activeWorkOrder = await tx.workOrder.findUnique({
        where: { id: existing.workOrderId },
      });
    }

    const call = await tx.callHistory.upsert({
      where: { binotelCallId: parsed.callId },
      create: {
        binotelCallId: parsed.callId,
        externalNumber: normalizedNumber,
        internalNumber,
        type: parsed.type || CallType.INCOMING,
        status,
        duration,
        startedAt,
        answeredAt,
        endedAt,
        rawPayload: toJson({ event: parsed.event, payload: parsed.raw }),
        clientId: client?.id || null,
        leadId: client ? null : lead?.id || null,
        workOrderId: activeWorkOrder?.id || null,
        managerId: manager?.id || null,
      },
      update: {
        externalNumber: normalizedNumber,
        internalNumber,
        type: parsed.type || existing?.type || CallType.INCOMING,
        status,
        duration,
        startedAt,
        answeredAt,
        endedAt,
        rawPayload: toJson({ event: parsed.event, payload: parsed.raw }),
        clientId: client?.id || existing?.clientId || null,
        leadId: client ? null : lead?.id || existing?.leadId || null,
        workOrderId: activeWorkOrder?.id || existing?.workOrderId || null,
        managerId: manager?.id || existing?.managerId || null,
      },
    });

    return { call, client, lead, activeWorkOrder, createdLead };
  });

  let recordingUrl = result.call.recordingUrl;

  if (
    parsed.event === "hangupTheCall" &&
    result.call.status === CallStatus.ANSWERED &&
    !recordingUrl
  ) {
    try {
      const media = await getBinotelService().getMediaFileLink(parsed.callId);
      if (media.url) {
        const updated = await prisma.callHistory.update({
          where: { binotelCallId: parsed.callId },
          data: { recordingUrl: media.url },
        });
        recordingUrl = updated.recordingUrl;
      }
    } catch (error) {
      console.warn("Binotel recording URL is not available yet", {
        callId: parsed.callId,
        message: error instanceof Error ? error.message : "unknown error",
      });
    }
  }

  return {
    event: parsed.event,
    callId: parsed.callId,
    callStatus: result.call.status,
    createdLead: result.createdLead,
    clientId: result.client?.id || null,
    leadId: result.client ? null : result.lead?.id || null,
    workOrderId: result.activeWorkOrder?.id || null,
    recordingUrl,
  };
}
