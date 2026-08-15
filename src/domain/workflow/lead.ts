import { LeadSource, LeadStatus, RejectReason } from "@/src/generated/prisma/client";
import { getWorkflowStatusLabel, normalizeWorkflowStatus } from "./index";

export const ACTIVE_LEAD_STATUSES: LeadStatus[] = [
  LeadStatus.NEW,
  LeadStatus.CONTACTED,
  LeadStatus.QUALIFIED,
  LeadStatus.ESTIMATE,
  LeadStatus.WAITING,
  LeadStatus.NO_ANSWER,
];

export const LEAD_BOARD_COLUMNS: Array<{ key: LeadStatus; label: string }> = [
  { key: LeadStatus.NEW, label: "Нові" },
  { key: LeadStatus.CONTACTED, label: "Контакт" },
  { key: LeadStatus.QUALIFIED, label: "Потреба" },
  { key: LeadStatus.ESTIMATE, label: "Прорахунок" },
  { key: LeadStatus.WAITING, label: "Думає / очікує" },
  { key: LeadStatus.NO_ANSWER, label: "Не додзвонились" },
  { key: LeadStatus.BOOKED, label: "Записані" },
  { key: LeadStatus.LOST, label: "Неуспішні" },
];

export const LEAD_STATUS_LABELS = Object.fromEntries(
  Object.values(LeadStatus).map((status) => [status, getWorkflowStatusLabel("LEAD", status)]),
) as Partial<Record<LeadStatus, string>>;

export function normalizeLegacyLeadStatus(status: LeadStatus): LeadStatus {
  return normalizeWorkflowStatus("LEAD", status) as LeadStatus;
}

export function mapUiSourceToLeadSource(value?: string | null): LeadSource {
  const source = (value || "").trim().toLowerCase();
  if (["телефон", "phone"].includes(source)) return LeadSource.PHONE;
  if (source.includes("binotel")) return LeadSource.BINOTEL;
  if (source.includes("instagram")) return LeadSource.INSTAGRAM;
  if (source.includes("facebook")) return LeadSource.FACEBOOK;
  if (source.includes("google")) return LeadSource.GOOGLE_MAPS;
  if (source.includes("viber")) return LeadSource.VIBER;
  if (source.includes("whatsapp")) return LeadSource.WHATSAPP;
  if (source.includes("olx")) return LeadSource.OLX;
  if (source.includes("tiktok")) return LeadSource.TIKTOK;
  if (source.includes("сайт") || source.includes("website")) return LeadSource.WEBSITE;
  if (source.includes("рекоменда")) return LeadSource.REFERRAL;
  if (source.includes("walk") || source.includes("заїзд")) return LeadSource.WALK_IN;
  if (source.includes("messenger")) return LeadSource.MESSENGER;
  return LeadSource.OTHER;
}

export function rejectReasonFromLossReason(value?: string | null): RejectReason {
  const reason = (value || "").toLowerCase();
  if (reason.includes("дорог")) return RejectReason.TOO_EXPENSIVE;
  if (reason.includes("час") || reason.includes("місц")) return RejectReason.NO_CAPACITY_NO_TIME;
  if (reason.includes("не нада") || reason.includes("послуг")) return RejectReason.SERVICE_NOT_PROVIDED;
  if (reason.includes("номер")) return RejectReason.WRONG_NUMBER;
  return RejectReason.OTHER;
}
