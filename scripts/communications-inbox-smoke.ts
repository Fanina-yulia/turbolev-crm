import assert from "node:assert/strict";
import {
  buildCommunicationConversations,
  getCommunicationLifecycleState,
  getCommunicationReplyInquiries,
  getDefaultCommunicationReplyInquiry,
  normalizeCommunicationPhone,
  type CommunicationInquiry,
} from "../src/domain/communications-inbox";

function missed(id: string, phone: string, at: string, unread = false): CommunicationInquiry {
  return {
    id,
    channel: "BINOTEL",
    state: "NEW",
    name: "Без імені",
    phone,
    subject: "Пропущений дзвінок",
    preview: "Пропущений дзвінок — потрібно передзвонити",
    unread,
    answered: false,
    receivedAt: at,
    messages: [{ id: `m-${id}`, direction: "system", text: "Пропущений вхідний дзвінок", at, metadata: { callStatus: "MISSED" } }],
  };
}

assert.equal(normalizeCommunicationPhone("067 329 24 56"), "380673292456");
assert.equal(normalizeCommunicationPhone("+380673292456"), "380673292456");

const notOurClient = {
  ...missed("not-our-client", "+380671234567", "2026-08-24T09:00:00.000Z"),
  state: "NOT_OUR_CLIENT" as const,
};
assert.equal(getCommunicationLifecycleState(notOurClient), "NOT_OUR_CLIENT");
assert.equal(buildCommunicationConversations([notOurClient])[0]?.lifecycleState, "NOT_OUR_CLIENT");
assert.equal(getCommunicationLifecycleState({
  ...missed("legacy-closed", "+380671234568", "2026-08-24T09:05:00.000Z"),
  automaticLifecycleState: "NEW",
  automaticLifecycleChangedAt: "2026-08-24T09:05:00.000Z",
  metadata: { lifecycleClosedAt: "2026-08-20T12:00:00.000Z" },
}), "NEW", "an old manual close must not override the current automatic workflow state");

const authoritativeName = buildCommunicationConversations([
  {
    ...missed("named-call", "+380673292456", "2026-08-16T08:20:00.000Z"),
    name: "Юрій Власник",
    duplicateLead: { id: "old-record", name: "Старе ім’я" },
  },
]);
assert.equal(authoritativeName[0]?.displayName, "Юрій Власник", "current client name must win over stale secondary identity data");

const grouped = buildCommunicationConversations([
  missed("call-1", "067 329 24 56", "2026-08-16T08:22:23.000Z"),
  missed("call-2", "+380673292456", "2026-08-16T08:25:25.000Z"),
  missed("call-3", "380673292456", "2026-08-16T08:37:55.000Z", true),
  {
    id: "instagram-1",
    channel: "INSTAGRAM",
    state: "NEW",
    name: "Інший клієнт",
    handle: "other-client",
    subject: "Instagram",
    preview: "Коли можна приїхати?",
    unread: true,
    answered: false,
    receivedAt: "2026-08-16T08:40:00.000Z",
    messages: [{ id: "ig-m1", direction: "in", text: "Коли можна приїхати?", at: "2026-08-16T08:40:00.000Z" }],
  },
]);

assert.equal(grouped.length, 2, "three calls from the same normalized phone must become one conversation");
const phoneConversation = grouped.find((item) => item.key === "phone:380673292456");
assert.ok(phoneConversation, "phone conversation must exist");
assert.equal(phoneConversation.inquiryCount, 3);
assert.equal(phoneConversation.missedCount, 3);
assert.equal(phoneConversation.unresolvedMissedCount, 3);
assert.equal(phoneConversation.unreadCount, 1);
assert.equal(phoneConversation.actionState, "MISSED");
assert.equal(phoneConversation.timeline.length, 3);

const handled = buildCommunicationConversations([
  ...phoneConversation.inquiries.map((item) => ({ ...item, unread: false })),
  {
    id: "reply-context",
    channel: "BINOTEL",
    state: "IN_WORK",
    name: "Без імені",
    phone: "+380673292456",
    subject: "Відповідь",
    preview: "Передзвонили клієнту",
    unread: false,
    answered: true,
    receivedAt: "2026-08-16T08:45:00.000Z",
    messages: [{ id: "out-1", direction: "out", text: "Передзвонили клієнту", at: "2026-08-16T08:45:00.000Z" }],
  },
]);
const handledPhone = handled.find((item) => item.key === "phone:380673292456");
assert.ok(handledPhone);
assert.equal(handledPhone.unresolvedMissedCount, 0, "a later response resolves earlier missed calls for the grouped contact");
assert.equal(handledPhone.actionState, "HANDLED");

const omnichannel = buildCommunicationConversations([
  {
    id: "binotel-latest",
    channel: "BINOTEL",
    state: "NEW",
    name: "Клієнт",
    phone: "+380671112233",
    subject: "Вхідний дзвінок",
    preview: "Розмова завершена",
    unread: false,
    answered: true,
    receivedAt: "2026-08-19T12:30:00.000Z",
    messages: [{ id: "call", direction: "system", text: "Розмова завершена", at: "2026-08-19T12:30:00.000Z" }],
  },
  {
    id: "instagram-earlier",
    channel: "INSTAGRAM",
    state: "NEW",
    name: "Клієнт",
    phone: "+380671112233",
    subject: "Instagram Direct",
    preview: "Запишіть мене на завтра",
    unread: false,
    answered: false,
    receivedAt: "2026-08-19T12:20:00.000Z",
    messages: [{ id: "ig-in", direction: "in", text: "Запишіть мене на завтра", at: "2026-08-19T12:20:00.000Z" }],
  },
]);
assert.equal(omnichannel.length, 1);
const replyConversation = omnichannel[0];
assert.equal(replyConversation.representative.channel, "BINOTEL", "latest event can still be a phone call");
assert.equal(replyConversation.activeChannel, "INSTAGRAM", "active channel follows the latest real inbound message rather than an unrelated system call");
assert.equal(getDefaultCommunicationReplyInquiry(replyConversation).channel, "INSTAGRAM", "live messaging channel must be preferred for the composer");
assert.deepEqual(getCommunicationReplyInquiries(replyConversation).map((item) => item.channel), ["INSTAGRAM", "BINOTEL"]);

const websiteToTelegram = buildCommunicationConversations([
  {
    id: "website-origin",
    channel: "WEBSITE",
    state: "IN_WORK",
    name: "Марійка Смірнова",
    phone: "+380997436439",
    subject: "Заявка із сайту",
    preview: "Потрібна консультація",
    unread: false,
    answered: true,
    receivedAt: "2026-08-20T18:00:00.000Z",
    messages: [{ id: "web-in", direction: "in", text: "Потрібна консультація", at: "2026-08-20T18:00:00.000Z" }],
  },
  {
    id: "telegram-legacy-website",
    channel: "WEBSITE",
    state: "NEW",
    name: "Марійка Смірнова",
    phone: "+380997436439",
    handle: "@mariika",
    subject: "Telegram · Марійка Смірнова",
    preview: "привіт, як в тебе справи?",
    unread: true,
    answered: false,
    receivedAt: "2026-08-20T21:06:00.000Z",
    sourceDetail: "Telegram Bot",
    lastInboundAt: "2026-08-20T21:06:00.000Z",
    metadata: { source: "TELEGRAM", clientId: "client-1", chatId: "123" },
    messages: [{ id: "tg-in", direction: "in", text: "привіт, як в тебе справи?", at: "2026-08-20T21:06:00.000Z", metadata: { source: "TELEGRAM" } }],
  },
]);
assert.equal(websiteToTelegram.length, 1);
const telegramConversation = websiteToTelegram[0];
assert.equal(telegramConversation.sourceChannel, "WEBSITE", "the first acquisition/contact source must remain Website");
assert.equal(telegramConversation.activeChannel, "TELEGRAM", "legacy Website+metadata Telegram inquiry must present as Telegram");
assert.equal(telegramConversation.representative.channel, "TELEGRAM", "latest Telegram inquiry must no longer be mislabeled as Website");
assert.deepEqual(telegramConversation.channels, ["TELEGRAM", "WEBSITE"]);
assert.equal(getDefaultCommunicationReplyInquiry(telegramConversation).channel, "TELEGRAM", "composer must automatically reply through Telegram after a Telegram inbound message");
assert.equal(telegramConversation.timeline.at(-1)?.channel, "TELEGRAM", "Telegram timeline messages must display their real transport channel");

console.log("communications-inbox-smoke: ok");
