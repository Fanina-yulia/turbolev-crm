import type {
  Lead,
  LeadBusinessStatus,
  LeadStatus,
  PlannerLocation,
  PlannerResource,
  RejectReasonCode,
  UserOption,
} from "./leads-board-v2.types";

export const leadColumns: Array<{ key: LeadBusinessStatus; label: string; statusLabel: string }> = [
  { key: "NEW", label: "Нові", statusLabel: "Нове" },
  { key: "BOOKED", label: "Записані", statusLabel: "Записаний" },
  { key: "CANCELLED", label: "Скасовані", statusLabel: "Скасоване" },
];

export const leadSourceLabels: Record<string, string> = {
  PHONE: "Телефон",
  BINOTEL: "Binotel",
  WEBSITE: "Сайт",
  MESSENGER: "Messenger",
  INSTAGRAM: "Instagram",
  FACEBOOK: "Facebook",
  GOOGLE_MAPS: "Google Maps",
  VIBER: "Viber",
  WHATSAPP: "WhatsApp",
  OLX: "OLX",
  TIKTOK: "TikTok",
  REFERRAL: "Рекомендація",
  WALK_IN: "Без запису",
  OTHER: "Інше",
};

export const rejectReasonLabels: Record<RejectReasonCode, string> = {
  TOO_EXPENSIVE: "Дорого",
  NO_CAPACITY_NO_TIME: "Немає зручного часу / місця",
  SERVICE_NOT_PROVIDED: "Послугу не надаємо",
  WRONG_NUMBER: "Помилковий номер",
  SPAM_ADS: "Спам / реклама",
  OTHER: "Інше",
};

const LEAD_STATUS_SET = new Set<LeadStatus>([
  "NEW",
  "CONTACTED",
  "QUALIFIED",
  "ESTIMATE",
  "WAITING",
  "NO_ANSWER",
  "BOOKED",
  "ARRIVED",
  "LOST",
  "SPAM_WRONG",
  "SUPPLIER_PARTNER",
]);
const REJECT_REASON_SET = new Set<RejectReasonCode>(Object.keys(rejectReasonLabels) as RejectReasonCode[]);
const OPEN_LEAD_STATUSES = new Set<LeadStatus>(["NEW", "CONTACTED", "QUALIFIED", "ESTIMATE", "WAITING", "NO_ANSWER"]);
const CANCELLED_LEAD_STATUSES = new Set<LeadStatus>(["LOST", "SPAM_WRONG", "SUPPLIER_PARTNER"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function nullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function numberValue(value: unknown, fallback = 0) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function isLeadStatus(value: unknown): value is LeadStatus {
  return typeof value === "string" && LEAD_STATUS_SET.has(value as LeadStatus);
}

function rejectReasonValue(value: unknown): RejectReasonCode | null {
  return typeof value === "string" && REJECT_REASON_SET.has(value as RejectReasonCode) ? value as RejectReasonCode : null;
}

export function leadBusinessStatus(value: Lead | LeadStatus): LeadBusinessStatus | "HANDOFF" {
  const status = typeof value === "string" ? value : value.status;
  if (OPEN_LEAD_STATUSES.has(status)) return "NEW";
  if (status === "BOOKED") return "BOOKED";
  if (CANCELLED_LEAD_STATUSES.has(status)) return "CANCELLED";
  return "HANDOFF";
}

export function isLeadInBusinessInbox(lead: Lead) {
  return leadBusinessStatus(lead) !== "HANDOFF";
}

export function businessStatusLabel(lead: Lead) {
  const state = leadBusinessStatus(lead);
  if (state === "HANDOFF") return "Передано в сервіс";
  return leadColumns.find((column) => column.key === state)?.statusLabel || state;
}

function parseUserOption(value: unknown): UserOption | null {
  if (!isRecord(value)) return null;
  const id = stringValue(value.id).trim();
  const name = stringValue(value.name).trim();
  if (!id || !name) return null;
  return {
    id,
    name,
    internalNumber: value.internalNumber == null ? null : stringValue(value.internalNumber),
  };
}

export function parseUserOptions(value: unknown): UserOption[] {
  if (!Array.isArray(value)) return [];
  return value.map(parseUserOption).filter((item): item is UserOption => item !== null);
}

function parseLead(value: unknown): Lead | null {
  if (!isRecord(value) || !isLeadStatus(value.status)) return null;
  const id = stringValue(value.id).trim();
  const phone = stringValue(value.phone).trim();
  const phoneNormalized = stringValue(value.phoneNormalized).trim();
  const lastActivityAt = stringValue(value.lastActivityAt).trim();
  if (!id || !phone || !phoneNormalized || !lastActivityAt) return null;

  const assignedUser = value.assignedUser == null ? null : parseUserOption(value.assignedUser);
  const count = isRecord(value._count) ? { calls: numberValue(value._count.calls) } : undefined;
  const preliminaryAmount = typeof value.preliminaryAmount === "string" || typeof value.preliminaryAmount === "number"
    ? value.preliminaryAmount
    : null;

  return {
    id,
    name: nullableString(value.name),
    phone,
    phoneNormalized,
    status: value.status,
    rejectReason: rejectReasonValue(value.rejectReason),
    source: stringValue(value.source, "OTHER"),
    carBrand: nullableString(value.carBrand),
    carModel: nullableString(value.carModel),
    carYear: nullableNumber(value.carYear),
    plateNumber: nullableString(value.plateNumber),
    vin: nullableString(value.vin),
    need: nullableString(value.need),
    comment: nullableString(value.comment),
    nextAction: nullableString(value.nextAction),
    nextContactAt: nullableString(value.nextContactAt),
    contactAttempts: numberValue(value.contactAttempts),
    lastActivityAt,
    preliminaryAmount,
    assignedUserId: nullableString(value.assignedUserId),
    createdAt: stringValue(value.createdAt),
    updatedAt: stringValue(value.updatedAt),
    assignedUser,
    _count: count,
  };
}

export function parseLeadList(value: unknown): Lead[] {
  if (!Array.isArray(value)) return [];
  return value.map(parseLead).filter((lead): lead is Lead => lead !== null);
}

function parsePlannerResource(value: unknown): PlannerResource | null {
  if (!isRecord(value)) return null;
  const id = stringValue(value.id).trim();
  const name = stringValue(value.name).trim();
  return id && name ? { id, name } : null;
}

function parsePlannerLocation(value: unknown): PlannerLocation | null {
  if (!isRecord(value)) return null;
  const id = stringValue(value.id).trim();
  const name = stringValue(value.name).trim();
  if (!id || !name) return null;
  const posts = Array.isArray(value.posts)
    ? value.posts.map(parsePlannerResource).filter((item): item is PlannerResource => item !== null)
    : [];
  const mechanics = Array.isArray(value.mechanics)
    ? value.mechanics.map(parsePlannerResource).filter((item): item is PlannerResource => item !== null)
    : [];
  return { id, name, posts, mechanics };
}

export function parsePlannerLocations(value: unknown): PlannerLocation[] {
  if (!Array.isArray(value)) return [];
  return value.map(parsePlannerLocation).filter((item): item is PlannerLocation => item !== null);
}

export function readPayloadField(payload: unknown, key: string): unknown {
  return isRecord(payload) ? payload[key] : undefined;
}

export function payloadMessage(payload: unknown, fallback: string) {
  if (!isRecord(payload)) return fallback;
  const error = stringValue(payload.error).trim();
  if (error) return error;
  const message = stringValue(payload.message).trim();
  return message || fallback;
}

export function pad(value: number) {
  return String(value).padStart(2, "0");
}

export function carLabel(lead: Lead) {
  return [lead.carBrand, lead.carModel, lead.carYear].filter(Boolean).join(" ") || "Авто уточнюється";
}

export function isOverdue(lead: Lead, slaMinutes: number) {
  if (leadBusinessStatus(lead) !== "NEW") return false;
  const stale = Date.now() - new Date(lead.lastActivityAt).getTime() > slaMinutes * 60_000;
  const followup = lead.nextContactAt ? new Date(lead.nextContactAt).getTime() < Date.now() : false;
  return stale || followup;
}

export function toLocalInput(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
