export type CommunicationChannel = "FACEBOOK" | "INSTAGRAM" | "TIKTOK" | "BINOTEL" | "OLX" | "WEBSITE";
export type CommunicationLifecycleState = "NEW" | "IN_WORK" | "WAITING_CLIENT" | "CLOSED" | "SPAM";
export type CommunicationInquiryState = CommunicationLifecycleState | "CONVERTED" | "LINKED";
export type CommunicationMessage = {
  id: string;
  direction: "in" | "out" | "system";
  text: string;
  at: string;
  metadata?: unknown;
};
export type CommunicationInquiry = {
  id: string;
  channel: CommunicationChannel;
  state: CommunicationInquiryState;
  name: string;
  phone?: string;
  handle?: string;
  subject: string;
  preview: string;
  vehicle?: string;
  plate?: string;
  unread: boolean;
  answered: boolean;
  receivedAt: string;
  sourceDetail?: string;
  campaign?: string;
  utm?: string;
  existingLeadId?: string;
  duplicateLead?: { id: string; name?: string | null } | null;
  externalParticipantId?: string;
  replyAllowedUntil?: string;
  lastInboundAt?: string;
  lastOutboundAt?: string;
  metadata?: unknown;
  messages: CommunicationMessage[];
};

export type ConversationActionState = "MISSED" | "NEW" | "NEEDS_REPLY" | "HANDLED";
export type ConversationTimelineMessage = CommunicationMessage & {
  inquiryId: string;
  channel: CommunicationChannel;
};
export type CommunicationConversation = {
  key: string;
  representative: CommunicationInquiry;
  inquiries: CommunicationInquiry[];
  inquiryIds: string[];
  unreadInquiryIds: string[];
  timeline: ConversationTimelineMessage[];
  channels: CommunicationChannel[];
  displayName: string;
  phone?: string;
  handle?: string;
  receivedAt: string;
  preview: string;
  inquiryCount: number;
  unreadCount: number;
  unansweredCount: number;
  missedCount: number;
  unresolvedMissedCount: number;
  hasMessages: boolean;
  actionState: ConversationActionState;
  lifecycleState: CommunicationLifecycleState;
  existingLeadId?: string;
  duplicateLead?: { id: string; name?: string | null } | null;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function getCommunicationLifecycleState(inquiry: CommunicationInquiry): CommunicationLifecycleState {
  if (inquiry.state === "SPAM") return "SPAM";
  if (inquiry.state === "CLOSED") return "CLOSED";
  if (isObject(inquiry.metadata) && inquiry.metadata.lifecycleClosedAt) return "CLOSED";
  if (inquiry.state === "WAITING_CLIENT") return "WAITING_CLIENT";
  if (inquiry.state === "NEW") return "NEW";
  if (inquiry.answered) return "WAITING_CLIENT";
  return "IN_WORK";
}

export function getCommunicationLifecycleLabel(state: CommunicationLifecycleState) {
  if (state === "NEW") return "Нове";
  if (state === "IN_WORK") return "У роботі";
  if (state === "WAITING_CLIENT") return "Очікує клієнта";
  if (state === "CLOSED") return "Закрито";
  return "Спам";
}

export function normalizeCommunicationPhone(value?: string | null) {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 10 && digits.startsWith("0")) return `38${digits}`;
  if (digits.length === 12 && digits.startsWith("380")) return digits;
  if (digits.length === 11 && digits.startsWith("80")) return `3${digits}`;
  return digits;
}

export function getCommunicationConversationKey(inquiry: CommunicationInquiry) {
  const phone = normalizeCommunicationPhone(inquiry.phone);
  if (phone) return `phone:${phone}`;
  const handle = inquiry.handle?.trim().toLocaleLowerCase("uk-UA");
  if (handle) return `handle:${inquiry.channel}:${handle}`;
  if (inquiry.existingLeadId) return `lead:${inquiry.existingLeadId}`;
  return `inquiry:${inquiry.id}`;
}

export function isLiveReplyChannel(channel: CommunicationChannel) {
  return channel === "FACEBOOK" || channel === "INSTAGRAM" || channel === "OLX";
}

export function getCommunicationReplyInquiries(conversation: CommunicationConversation) {
  const byChannel = new Map<CommunicationChannel, CommunicationInquiry>();
  for (const inquiry of conversation.inquiries) {
    if (!byChannel.has(inquiry.channel)) byChannel.set(inquiry.channel, inquiry);
  }
  const items = Array.from(byChannel.values());
  return items.sort((left, right) => {
    const liveDelta = Number(isLiveReplyChannel(right.channel)) - Number(isLiveReplyChannel(left.channel));
    if (liveDelta) return liveDelta;
    return new Date(right.receivedAt).getTime() - new Date(left.receivedAt).getTime();
  });
}

export function getDefaultCommunicationReplyInquiry(conversation: CommunicationConversation) {
  return getCommunicationReplyInquiries(conversation)[0] || conversation.representative;
}

function metadataCallStatus(metadata: unknown): string | null {
  if (!isObject(metadata)) return null;
  const direct = metadata.callStatus;
  if (typeof direct === "string") return direct.toUpperCase();
  const nested = metadata.metadata;
  if (isObject(nested) && typeof nested.callStatus === "string") return nested.callStatus.toUpperCase();
  return null;
}

export function isMissedCommunicationInquiry(inquiry: CommunicationInquiry) {
  if (inquiry.channel !== "BINOTEL") return false;
  if (inquiry.messages.some((message) => metadataCallStatus(message.metadata) === "MISSED")) return true;
  const text = `${inquiry.subject} ${inquiry.preview}`.toLocaleLowerCase("uk-UA");
  return text.includes("пропущен");
}

function isGenericName(value?: string | null) {
  const normalized = String(value || "").trim().toLocaleLowerCase("uk-UA");
  return !normalized || normalized === "без імені" || normalized === "невідомий" || normalized === "невідомий клієнт" || normalized === "unknown";
}

function chooseDisplayName(inquiries: CommunicationInquiry[]) {
  for (const inquiry of inquiries) {
    if (!isGenericName(inquiry.name)) return inquiry.name.trim();
  }
  for (const inquiry of inquiries) {
    const leadName = inquiry.duplicateLead?.name?.trim();
    if (leadName && !isGenericName(leadName)) return leadName;
  }
  return inquiries[0]?.name?.trim() || "Без імені";
}

function toMillis(value: string) {
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

function latestHandledAt(inquiries: CommunicationInquiry[]) {
  let latest = 0;
  for (const inquiry of inquiries) {
    for (const message of inquiry.messages) {
      if (message.direction === "out") latest = Math.max(latest, toMillis(message.at));
    }
    if (inquiry.answered && !isMissedCommunicationInquiry(inquiry)) latest = Math.max(latest, toMillis(inquiry.receivedAt));
    if (inquiry.answered && isMissedCommunicationInquiry(inquiry) && inquiry.messages.some((message) => message.direction === "out")) {
      latest = Math.max(latest, ...inquiry.messages.filter((message) => message.direction === "out").map((message) => toMillis(message.at)));
    }
  }
  return latest;
}

function conversationLifecycleState(inquiries: CommunicationInquiry[]): CommunicationLifecycleState {
  const states = inquiries.map(getCommunicationLifecycleState);
  if (states.every((state) => state === "CLOSED")) return "CLOSED";
  if (states.some((state) => state === "NEW")) return "NEW";
  if (states.some((state) => state === "IN_WORK")) return "IN_WORK";
  if (states.some((state) => state === "WAITING_CLIENT")) return "WAITING_CLIENT";
  if (states.every((state) => state === "SPAM")) return "SPAM";
  return "IN_WORK";
}

export function buildCommunicationConversations(source: CommunicationInquiry[]) {
  const groups = new Map<string, CommunicationInquiry[]>();
  for (const inquiry of source) {
    if (getCommunicationLifecycleState(inquiry) === "SPAM") continue;
    const key = getCommunicationConversationKey(inquiry);
    const group = groups.get(key) || [];
    group.push(inquiry);
    groups.set(key, group);
  }

  return Array.from(groups.entries()).map(([key, raw]) => {
    const inquiries = [...raw].sort((a, b) => toMillis(b.receivedAt) - toMillis(a.receivedAt));
    const representative = inquiries[0];
    const handledAt = latestHandledAt(inquiries);
    const missed = inquiries.filter(isMissedCommunicationInquiry);
    const unreadInquiryIds = inquiries.filter((item) => item.unread).map((item) => item.id);
    const unresolvedMissed = missed.filter((item) => !item.answered && toMillis(item.receivedAt) > handledAt);
    const unanswered = inquiries.filter((item) => {
      if (getCommunicationLifecycleState(item) === "CLOSED") return false;
      if (item.answered || toMillis(item.receivedAt) <= handledAt) return false;
      return item.messages.some((message) => message.direction === "in") || isMissedCommunicationInquiry(item);
    });
    const timeline = inquiries
      .flatMap((inquiry) => inquiry.messages.map((message) => ({ ...message, inquiryId: inquiry.id, channel: inquiry.channel })))
      .filter((message, index, items) => items.findIndex((candidate) => candidate.id === message.id) === index)
      .sort((a, b) => toMillis(a.at) - toMillis(b.at));
    const channels = Array.from(new Set(inquiries.map((item) => item.channel)));
    const unreadCount = unreadInquiryIds.length;
    const unansweredCount = unanswered.length;
    const unresolvedMissedCount = unresolvedMissed.length;
    const actionState: ConversationActionState = unresolvedMissedCount > 0
      ? "MISSED"
      : unreadCount > 0
        ? "NEW"
        : unansweredCount > 0
          ? "NEEDS_REPLY"
          : "HANDLED";
    const phone = inquiries.map((item) => item.phone).find(Boolean);
    const handle = inquiries.map((item) => item.handle).find(Boolean);
    const existingLeadId = inquiries.map((item) => item.existingLeadId).find(Boolean);
    const duplicateLead = inquiries.map((item) => item.duplicateLead).find(Boolean) || null;

    return {
      key,
      representative,
      inquiries,
      inquiryIds: inquiries.map((item) => item.id),
      unreadInquiryIds,
      timeline,
      channels,
      displayName: chooseDisplayName(inquiries),
      phone,
      handle,
      receivedAt: representative.receivedAt,
      preview: representative.preview || representative.subject,
      inquiryCount: inquiries.length,
      unreadCount,
      unansweredCount,
      missedCount: missed.length,
      unresolvedMissedCount,
      hasMessages: inquiries.some((item) => item.channel !== "BINOTEL" || item.messages.some((message) => message.direction !== "system")),
      actionState,
      lifecycleState: conversationLifecycleState(inquiries),
      existingLeadId,
      duplicateLead,
    } satisfies CommunicationConversation;
  }).sort((a, b) => toMillis(b.receivedAt) - toMillis(a.receivedAt));
}