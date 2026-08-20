import { createHash, randomBytes, randomUUID } from "node:crypto";
import { getPrisma } from "@/src/lib/prisma";
import { getSqlPool } from "@/src/lib/sql";
import { getIntegrationCredential } from "@/src/services/integration-credentials.service";

const TELEGRAM_API = "https://api.telegram.org";
const LINK_TTL_MS = 24 * 60 * 60 * 1000;

const STATUS_LABELS: Record<string, string> = {
  BOOKED: "Заплановано",
  ARRIVED: "Автомобіль на СТО",
  DIAGNOSTICS: "Діагностика",
  WAITING_PARTS_SELECTION: "Підбираємо запчастини",
  WAITING_CALCULATION: "Розраховуємо вартість",
  WAITING_APPROVAL: "Очікуємо погодження",
  WAITING_PARTS: "Очікуємо запчастини",
  READY_FOR_REPAIR: "Готово до ремонту",
  IN_REPAIR: "Автомобіль у ремонті",
  WAITING_QC: "Контроль якості",
  WAITING_PAYMENT: "Очікуємо оплату",
  READY_FOR_PICKUP: "Автомобіль готовий до видачі",
  COMPLETED: "Автомобіль видано",
  WARRANTY: "Гарантійне звернення",
  PAUSED: "Роботу призупинено",
  NO_SHOW: "Візит не відбувся",
  CANCELLED: "Запис скасовано",
  RESERVE: "Резерв",
};

type TelegramConfig = {
  botToken: string;
  botUsername?: string;
  webhookSecret?: string;
};

type TelegramUser = {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  last_name?: string;
  username?: string;
};

type TelegramChat = {
  id: number;
  type?: string;
  first_name?: string;
  last_name?: string;
  username?: string;
};

type TelegramMessage = {
  message_id: number;
  date?: number;
  text?: string;
  from?: TelegramUser;
  chat: TelegramChat;
};

export type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessage;
};

type TelegramApiResponse<T> = {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
};

function makeId(prefix: string) {
  return `${prefix}_${randomUUID().replace(/-/g, "")}`;
}

function tokenHash(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function normalizeUsername(value?: string | null) {
  return (value || "").trim().replace(/^@/, "");
}

async function config(): Promise<TelegramConfig> {
  const stored = await getIntegrationCredential("TELEGRAM");
  const botToken = stored?.botToken?.trim() || "";
  if (!botToken) throw Object.assign(new Error("Telegram bot token не налаштований."), { code: "TELEGRAM_NOT_CONFIGURED" });
  return {
    botToken,
    botUsername: normalizeUsername(stored?.botUsername),
    webhookSecret: stored?.webhookSecret?.trim() || undefined,
  };
}

async function telegramApi<T>(method: string, body?: Record<string, unknown>): Promise<T> {
  const cfg = await config();
  const response = await fetch(`${TELEGRAM_API}/bot${cfg.botToken}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
    cache: "no-store",
  });
  const payload = await response.json().catch(() => null) as TelegramApiResponse<T> | null;
  if (!response.ok || !payload?.ok || payload.result === undefined) {
    throw Object.assign(
      new Error(payload?.description || `Telegram API HTTP ${response.status}`),
      { code: payload?.error_code ? `TELEGRAM_${payload.error_code}` : "TELEGRAM_API_ERROR" },
    );
  }
  return payload.result;
}

export async function testTelegramConnection() {
  const me = await telegramApi<TelegramUser>("getMe");
  const webhook = await telegramApi<{ url?: string; pending_update_count?: number; last_error_message?: string }>("getWebhookInfo");
  return {
    ok: true,
    message: `Telegram підключено: @${me.username || "bot"}. Webhook: ${webhook.url ? "активний" : "ще не встановлений"}.`,
    bot: { id: String(me.id), username: me.username || null, firstName: me.first_name || null },
    webhook: {
      url: webhook.url || null,
      pendingUpdates: webhook.pending_update_count || 0,
      lastError: webhook.last_error_message || null,
    },
  };
}

export async function configureTelegramWebhook(origin: string) {
  const cfg = await config();
  const cleanOrigin = origin.replace(/\/$/, "");
  const url = `${cleanOrigin}/api/integrations/telegram/webhook`;
  const result = await telegramApi<boolean>("setWebhook", {
    url,
    allowed_updates: ["message"],
    drop_pending_updates: false,
    ...(cfg.webhookSecret ? { secret_token: cfg.webhookSecret } : {}),
  });
  if (!result) throw new Error("Telegram не підтвердив встановлення webhook.");
  return { ok: true, url };
}

export async function verifyTelegramWebhookSecret(value: string | null) {
  const cfg = await config();
  if (!cfg.webhookSecret) return true;
  return value === cfg.webhookSecret;
}

export async function sendTelegramTextMessage(input: {
  chatId: string;
  text: string;
  replyMarkup?: Record<string, unknown>;
}) {
  const message = await telegramApi<TelegramMessage>("sendMessage", {
    chat_id: input.chatId,
    text: input.text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...(input.replyMarkup ? { reply_markup: input.replyMarkup } : {}),
  });
  await getPrisma().telegramContact.updateMany({
    where: { chatId: input.chatId },
    data: { lastOutboundAt: new Date() },
  });
  return {
    providerMessageId: String(message.message_id),
    providerPayload: message,
  };
}

function mainMenuMarkup() {
  return {
    keyboard: [
      [{ text: "📍 Статус ремонту" }, { text: "💬 Написати менеджеру" }],
      [{ text: "🚗 Мої авто" }, { text: "📞 Контакти СТО" }],
    ],
    resize_keyboard: true,
    is_persistent: true,
  };
}

export async function createTelegramClientLink(clientId: string) {
  const prisma = getPrisma();
  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { id: true } });
  if (!client) throw Object.assign(new Error("Клієнта не знайдено."), { code: "CLIENT_NOT_FOUND" });

  const rawToken = randomBytes(24).toString("base64url");
  const expiresAt = new Date(Date.now() + LINK_TTL_MS);
  await prisma.telegramContact.upsert({
    where: { clientId },
    create: {
      id: makeId("tg"),
      clientId,
      linkTokenHash: tokenHash(rawToken),
      linkExpiresAt: expiresAt,
      isActive: false,
    },
    update: {
      linkTokenHash: tokenHash(rawToken),
      linkExpiresAt: expiresAt,
    },
  });

  const cfg = await config();
  let username = normalizeUsername(cfg.botUsername);
  if (!username) {
    const me = await telegramApi<TelegramUser>("getMe");
    username = normalizeUsername(me.username);
  }
  if (!username) throw new Error("Telegram bot username недоступний.");

  return {
    url: `https://t.me/${username}?start=${rawToken}`,
    expiresAt: expiresAt.toISOString(),
    botUsername: username,
  };
}

export async function getTelegramClientState(clientId: string) {
  const row = await getPrisma().telegramContact.findUnique({ where: { clientId } });
  if (!row) return { configured: Boolean(await getIntegrationCredential("TELEGRAM")), linked: false, contact: null };
  return {
    configured: Boolean(await getIntegrationCredential("TELEGRAM")),
    linked: Boolean(row.isActive && row.chatId),
    contact: {
      username: row.username,
      firstName: row.firstName,
      lastName: row.lastName,
      linkedAt: row.linkedAt?.toISOString() || null,
      lastInboundAt: row.lastInboundAt?.toISOString() || null,
      lastOutboundAt: row.lastOutboundAt?.toISOString() || null,
      linkExpiresAt: row.linkExpiresAt?.toISOString() || null,
    },
  };
}

export async function unlinkTelegramClient(clientId: string) {
  await getPrisma().telegramContact.deleteMany({ where: { clientId } });
  return { ok: true };
}

async function latestClientStatus(clientId: string) {
  const prisma = getPrisma();
  const appointment = await prisma.serviceAppointment.findFirst({
    where: {
      clientId,
      vehicleId: { not: null },
      status: { notIn: ["RESERVE", "CANCELLED", "NO_SHOW"] },
    },
    orderBy: [{ actualArrivalAt: "desc" }, { plannedStartAt: "desc" }, { createdAt: "desc" }],
    select: {
      vehicleId: true,
      vehicleLabel: true,
      plateNumber: true,
      status: true,
      plannedStartAt: true,
      mechanic: { select: { name: true } },
    },
  });
  if (!appointment) return "Активного запису або ремонту зараз немає.";

  const vehicle = appointment.vehicleId
    ? await prisma.vehicle.findUnique({
        where: { id: appointment.vehicleId },
        select: { brand: true, model: true, plateNumber: true },
      })
    : null;
  const label = [vehicle?.brand, vehicle?.model].filter(Boolean).join(" ") || appointment.vehicleLabel || "Ваш автомобіль";
  const plate = vehicle?.plateNumber || appointment.plateNumber;
  const status = STATUS_LABELS[appointment.status] || appointment.status;
  const mechanic = appointment.mechanic?.name ? `\nМайстер: ${appointment.mechanic.name}` : "";
  return `<b>${label}</b>${plate ? ` · ${plate}` : ""}\nСтатус: <b>${status}</b>${mechanic}`;
}

async function clientVehicles(clientId: string) {
  const vehicles = await getPrisma().vehicle.findMany({
    where: { clientId },
    orderBy: { updatedAt: "desc" },
    select: { brand: true, model: true, year: true, plateNumber: true, vin: true },
  });
  if (!vehicles.length) return "У картці клієнта ще немає автомобілів.";
  return vehicles.map((vehicle, index) => {
    const label = [vehicle.brand, vehicle.model, vehicle.year].filter(Boolean).join(" ") || "Автомобіль";
    return `${index + 1}. <b>${label}</b>\n${vehicle.plateNumber || vehicle.vin || "Без номера"}`;
  }).join("\n\n");
}

async function ensureTelegramInquiry(input: {
  clientId: string;
  chatId: string;
  username?: string | null;
  text: string;
}) {
  const prisma = getPrisma();
  const client = await prisma.client.findUnique({
    where: { id: input.clientId },
    select: { id: true, name: true, phone: true, phoneNormalized: true },
  });
  if (!client) throw new Error("Linked client not found");
  const pool = getSqlPool();
  const externalId = `telegram:${input.chatId}`;
  const found = await pool.query(
    `SELECT "id" FROM "CommunicationInquiry" WHERE "channel"='WEBSITE' AND "externalId"=$1 LIMIT 1`,
    [externalId],
  );
  if (found.rowCount) return { id: String(found.rows[0].id), client };

  const inquiryId = makeId("inq");
  const now = new Date();
  await pool.query(
    `INSERT INTO "CommunicationInquiry"
     ("id","externalId","channel","state","name","phone","phoneNormalized","handle","subject","preview","unread","answered","receivedAt","sourceDetail","externalThreadId","externalParticipantId","lastInboundAt","lastSyncedAt","metadata","createdAt","updatedAt")
     VALUES ($1,$2,'WEBSITE','NEW',$3,$4,$5,$6,$7,$8,TRUE,FALSE,$9,'Telegram Bot',$10,$11,$9,$9,$12::jsonb,$9,$9)`,
    [
      inquiryId,
      externalId,
      client.name,
      client.phone,
      client.phoneNormalized,
      input.username ? `@${input.username}` : null,
      `Telegram · ${client.name || client.phone}`,
      input.text.slice(0, 500),
      now,
      externalId,
      input.chatId,
      JSON.stringify({ source: "TELEGRAM", clientId: client.id, chatId: input.chatId }),
    ],
  );
  return { id: inquiryId, client };
}

async function recordInboundMessage(inquiryId: string, update: TelegramUpdate, text: string) {
  const message = update.message!;
  const externalId = String(message.message_id);
  const pool = getSqlPool();
  await pool.query(
    `INSERT INTO "CommunicationMessage"
     ("id","inquiryId","externalId","direction","text","sentAt","metadata","providerMessageId","deliveryStatus","providerPayload","createdAt")
     VALUES ($1,$2,$3,'IN',$4,to_timestamp($5),$6::jsonb,$3,'RECEIVED',$7::jsonb,CURRENT_TIMESTAMP)
     ON CONFLICT ("inquiryId","externalId") DO NOTHING`,
    [
      makeId("msg"),
      inquiryId,
      externalId,
      text,
      message.date || Math.floor(Date.now() / 1000),
      JSON.stringify({ source: "TELEGRAM", updateId: update.update_id }),
      JSON.stringify(update),
    ],
  );
  await pool.query(
    `UPDATE "CommunicationInquiry"
     SET "preview"=$2,"unread"=TRUE,"answered"=FALSE,"receivedAt"=CURRENT_TIMESTAMP,
         "lastInboundAt"=CURRENT_TIMESTAMP,"lastSyncedAt"=CURRENT_TIMESTAMP,"updatedAt"=CURRENT_TIMESTAMP
     WHERE "id"=$1`,
    [inquiryId, text.slice(0, 500)],
  );
}

async function linkFromStart(message: TelegramMessage, token: string) {
  const prisma = getPrisma();
  const row = await prisma.telegramContact.findFirst({
    where: {
      linkTokenHash: tokenHash(token),
      linkExpiresAt: { gt: new Date() },
    },
  });
  if (!row) {
    await sendTelegramTextMessage({
      chatId: String(message.chat.id),
      text: "Посилання недійсне або вже прострочене. Попросіть менеджера Turbo LEV створити нове посилання.",
    });
    return false;
  }

  const user = message.from;
  await prisma.telegramContact.update({
    where: { id: row.id },
    data: {
      chatId: String(message.chat.id),
      telegramUserId: user?.id ? String(user.id) : String(message.chat.id),
      username: user?.username || message.chat.username || null,
      firstName: user?.first_name || message.chat.first_name || null,
      lastName: user?.last_name || message.chat.last_name || null,
      linkedAt: new Date(),
      lastInboundAt: new Date(),
      isActive: true,
      linkTokenHash: null,
      linkExpiresAt: null,
    },
  });
  await sendTelegramTextMessage({
    chatId: String(message.chat.id),
    text: "✅ Telegram підключено до вашої картки <b>Turbo LEV</b>. Тут можна отримувати статус авто та писати менеджеру.",
    replyMarkup: mainMenuMarkup(),
  });
  return true;
}

export async function processTelegramUpdate(update: TelegramUpdate) {
  const message = update.message;
  const text = message?.text?.trim();
  if (!message || !text) return { ok: true, ignored: true };
  const chatId = String(message.chat.id);

  const startMatch = text.match(/^\/start(?:\s+(.+))?$/i);
  if (startMatch) {
    const token = startMatch[1]?.trim();
    if (!token) {
      await sendTelegramTextMessage({
        chatId,
        text: "Вітаємо в <b>Turbo LEV</b>. Для підключення до вашого автомобіля відкрийте персональне Telegram-посилання з CRM або попросіть його у менеджера.",
        replyMarkup: mainMenuMarkup(),
      });
      return { ok: true, start: true, linked: false };
    }
    return { ok: true, start: true, linked: await linkFromStart(message, token) };
  }

  const contact = await getPrisma().telegramContact.findFirst({ where: { chatId, isActive: true } });
  if (!contact) {
    await sendTelegramTextMessage({
      chatId,
      text: "Telegram ще не прив’язаний до клієнта Turbo LEV. Попросіть менеджера надіслати персональне посилання для підключення.",
    });
    return { ok: true, linked: false };
  }

  await getPrisma().telegramContact.update({
    where: { id: contact.id },
    data: {
      username: message.from?.username || contact.username,
      firstName: message.from?.first_name || contact.firstName,
      lastName: message.from?.last_name || contact.lastName,
      lastInboundAt: new Date(),
    },
  });

  const inquiry = await ensureTelegramInquiry({
    clientId: contact.clientId,
    chatId,
    username: message.from?.username,
    text,
  });
  await recordInboundMessage(inquiry.id, update, text);

  if (/^\/status$/i.test(text) || text === "📍 Статус ремонту") {
    await sendTelegramTextMessage({ chatId, text: await latestClientStatus(contact.clientId), replyMarkup: mainMenuMarkup() });
    return { ok: true, action: "STATUS" };
  }
  if (/^\/cars$/i.test(text) || text === "🚗 Мої авто") {
    await sendTelegramTextMessage({ chatId, text: await clientVehicles(contact.clientId), replyMarkup: mainMenuMarkup() });
    return { ok: true, action: "CARS" };
  }
  if (/^\/menu$/i.test(text)) {
    await sendTelegramTextMessage({ chatId, text: "Оберіть потрібну дію:", replyMarkup: mainMenuMarkup() });
    return { ok: true, action: "MENU" };
  }
  if (text === "📞 Контакти СТО") {
    await sendTelegramTextMessage({ chatId, text: "Turbo LEV · автосервіс\nНапишіть тут — повідомлення одразу побачить менеджер CRM.", replyMarkup: mainMenuMarkup() });
    return { ok: true, action: "CONTACTS" };
  }
  if (text === "💬 Написати менеджеру") {
    await sendTelegramTextMessage({ chatId, text: "Напишіть ваше питання одним повідомленням. Воно одразу з’явиться у менеджера в CRM.", replyMarkup: mainMenuMarkup() });
    return { ok: true, action: "PROMPT_MANAGER" };
  }

  await sendTelegramTextMessage({
    chatId,
    text: "✅ Повідомлення передано менеджеру Turbo LEV. Відповідь прийде сюди в Telegram.",
    replyMarkup: mainMenuMarkup(),
  });
  return { ok: true, action: "MESSAGE" };
}
