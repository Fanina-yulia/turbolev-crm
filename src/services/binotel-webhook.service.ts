import { PRIMARY_BINOTEL_PBX_NUMBER } from "@/src/domain/binotel-config";
import {
  CallStatus,
  CallType,
  LeadStatus,
  Prisma,
} from "@/src/generated/prisma/client";
import { getPrisma } from "@/src/lib/prisma";
import { normalizePhone, phoneVariants } from "@/src/lib/phone";
import { getBinotelService } from "@/src/services/binotel.service";
import { syncBinotelInquiry } from "@/src/services/binotel-communications.service";

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
  customerName: string | null;
  employeeEmail: string | null;
  pbxNumber: string;
  type: CallType | null;
  duration: number | null;
  startedAt: Date | null;
  answeredAt: Date | null;
  endedAt: Date | null;
  terminalHint: string | null;
  raw: JsonRecord;
};

const ACTIVE_LEAD_STATUSES: LeadStatus[] = [
  LeadStatus.NEW,
  LeadStatus.CONTACTED,
  LeadStatus.QUALIFIED,
  LeadStatus.ESTIMATE,
  LeadStatus.WAITING,
  LeadStatus.NO_ANSWER,
  LeadStatus.BOOKED,
  LeadStatus.ARRIVED,
  // Legacy active states kept for existing records during transition.
  LeadStatus.QUALIFYING,
  LeadStatus.WARM_LEAD,
];

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function searchableContainers(raw: JsonRecord): JsonRecord[] {
  const primaryNames = ["data", "call", "request", "payload", "callDetails"];
  const primary = [raw, ...primaryNames.map((name) => raw[name]).filter(isRecord)];
  const secondaryNames = ["callDetails", "customerData", "employeeData", "pbxNumberData"];
  const secondary = primary.flatMap((container) =>
    secondaryNames.map((name) => container[name]).filter(isRecord),
  );
  return [...primary, ...secondary];
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

function nestedString(raw: JsonRecord, containerName: string, names: string[]): string | null {
  for (const container of searchableContainers(raw)) {
    const nested = container[containerName];
    if (!isRecord(nested)) continue;
    for (const name of names) {
      const value = nested[name];
      if (value !== undefined && value !== null && value !== "") {
        const result = String(value).trim();
        if (result) return result;
      }
    }
  }
  return null;
}

function resolveBinotelPbxNumber(raw: JsonRecord): string {
  const candidates = [
    firstString(raw, ["pbxNumber", "pbxLine", "lineNumber", "didNumber", "trunkNumber"]),
    nestedString(raw, "pbxNumberData", ["number", "pbxNumber", "phone"]),
  ];

  for (const candidate of candidates) {
    const normalized = normalizePhone(candidate);
    if (normalized) return normalized;
  }

  return normalizePhone(PRIMARY_BINOTEL_PBX_NUMBER);
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
      "internalAdditionalData",
      "internalNumber",
      "internalPhone",
      "employeeNumber",
      "extension",
      "to",
    ]),
    customerName: nestedString(raw, "customerData", ["name", "fullName", "customerName"]),
    employeeEmail: nestedString(raw, "employeeData", ["email", "employeeEmail"])?.toLowerCase() || null,
    pbxNumber: resolveBinotelPbxNumber(raw),
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
  if (!hint) return false;
  const normalized = hint.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
  if (/(no\s*answer|unanswered|not\s*answered|cancel(?:led)?|failed|busy)/i.test(normalized)) {
    return false;
  }
  return /(^|\s)(answer|answered|success|completed|normal clearing)(\s|$)/i.test(normalized);
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
  const rawPayload = toJson({ event: parsed.event, pbxNumber: parsed.pbxNumber, payload: parsed.raw });

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

    if (!client && !lead) {
      const secondaryPhone = await tx.clientPhone.findUnique({
        where: { phoneNormalized: normalizedNumber },
        select: { clientId: true },
      });
      if (secondaryPhone) {
        client = await tx.client.findUnique({ where: { id: secondaryPhone.clientId } });
      }
    }

    if (!client && !lead) {
      lead = await tx.lead.findFirst({
        where: {
          status: { in: ACTIVE_LEAD_STATUSES },
          OR: [
            { phoneNormalized: normalizedNumber },
            ...(variants.length ? [{ phone: { in: variants } }] : []),
          ],
        },
        orderBy: { updatedAt: "desc" },
      });
    }

    let activeWorkOrder = client
      ? await tx.workOrder.findFirst({
          where: { clientId: client.id, closedAt: null },
          orderBy: { updatedAt: "desc" },
        })
      : null;

    const internalNumber = parsed.internalNumber || existing?.internalNumber || null;
    let manager = internalNumber
      ? await tx.user.findUnique({ where: { internalNumber } })
      : null;
    if (!manager && parsed.employeeEmail) {
      manager = await tx.user.findFirst({
        where: { email: { equals: parsed.employeeEmail, mode: "insensitive" }, isActive: true },
      });
    }

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
        rawPayload,
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
        rawPayload,
        clientId: client?.id || existing?.clientId || null,
        leadId: client ? null : lead?.id || existing?.leadId || null,
        workOrderId: activeWorkOrder?.id || existing?.workOrderId || null,
        managerId: manager?.id || existing?.managerId || null,
      },
    });

    return { call, client, lead, activeWorkOrder };
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

  let inquiryId: string | null = null;

  if (result.call.type === CallType.INCOMING || result.call.type === CallType.OUTGOING) {
    const eventAt =
      parsed.event === "hangupTheCall"
        ? result.call.endedAt
        : parsed.event === "answeredTheCall"
          ? result.call.answeredAt
          : result.call.startedAt;

    const inquiry = await syncBinotelInquiry({
      callId: parsed.callId,
      event: parsed.event,
      callType: result.call.type,
      pbxNumber: parsed.pbxNumber,
      phone: normalizedNumber,
      name: result.client?.name || result.lead?.name || parsed.customerName || "Невідомий номер",
      status: result.call.status,
      duration: result.call.duration,
      internalNumber: result.call.internalNumber,
      recordingAvailable: Boolean(recordingUrl),
      clientId: result.client?.id || null,
      leadId: result.client ? null : result.lead?.id || null,
      workOrderId: result.activeWorkOrder?.id || null,
      occurredAt: eventAt,
    });
    inquiryId = inquiry.id;
  }

  return {
    event: parsed.event,
    callId: parsed.callId,
    callStatus: result.call.status,
    createdLead: false,
    clientId: result.client?.id || null,
    leadId: result.client ? null : result.lead?.id || null,
    workOrderId: result.activeWorkOrder?.id || null,
    inquiryId,
    recordingAvailable: Boolean(recordingUrl),
  };
}
