import assert from "node:assert/strict";
import {
  buildCommunicationConversations,
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
assert.equal(getDefaultCommunicationReplyInquiry(replyConversation).channel, "INSTAGRAM", "live messaging channel must be preferred for the composer");
assert.deepEqual(getCommunicationReplyInquiries(replyConversation).map((item) => item.channel), ["INSTAGRAM", "BINOTEL"]);

console.log("communications-inbox-smoke: ok");
