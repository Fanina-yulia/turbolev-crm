import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { getSqlPool } from "@/src/lib/sql";

export type IntegrationProvider =
  | "BINOTEL"
  | "TELEGRAM"
  | "META"
  | "TIKTOK"
  | "OLX"
  | "VEHICLE_IMAGES"
  | "BM_PARTS"
  | "UNIQUE_TRADE"
  | "AUTONOVA_D"
  | "ATL";

export type IntegrationCategory = "COMMUNICATIONS" | "SUPPLIERS" | "VEHICLES";

export type IntegrationStatus =
  | "NOT_CONFIGURED"
  | "CONFIGURED"
  | "AUTHORIZATION_REQUIRED"
  | "CONNECTED"
  | "DEGRADED"
  | "TOKEN_EXPIRED"
  | "ERROR";

type FieldSpec = {
  key: string;
  label: string;
  secret: boolean;
  required?: boolean;
  placeholder?: string;
};

type ProviderSpec = {
  provider: IntegrationProvider;
  category: IntegrationCategory;
  title: string;
  description: string;
  fields: FieldSpec[];
  envFallback: Record<string, string>;
};

export const integrationProviderSpecs: ProviderSpec[] = [
  {
    provider: "BINOTEL",
    category: "COMMUNICATIONS",
    title: "Binotel",
    description: "Телефонія: вхідні, вихідні, пропущені дзвінки та записи розмов.",
    fields: [
      { key: "companyId", label: "Company ID", secret: false, placeholder: "ID компанії Binotel" },
      { key: "apiKey", label: "API key", secret: true, required: true },
      { key: "apiSecret", label: "API secret", secret: true, required: true },
      { key: "webhookToken", label: "Webhook token", secret: true },
      { key: "wsKey", label: "WebSocket key", secret: true },
      { key: "wsSecret", label: "WebSocket secret", secret: true },
    ],
    envFallback: {
      companyId: "BINOTEL_COMPANY_ID",
      apiKey: "BINOTEL_API_KEY",
      apiSecret: "BINOTEL_API_SECRET",
      webhookToken: "BINOTEL_WEBHOOK_TOKEN",
      wsKey: "BINOTEL_WS_KEY",
      wsSecret: "BINOTEL_WS_SECRET",
    },
  },
  {
    provider: "TELEGRAM",
    category: "COMMUNICATIONS",
    title: "Telegram",
    description: "Безкоштовний Telegram Bot API: двосторонній чат, статус авто та персональна прив’язка клієнта.",
    fields: [
      { key: "botToken", label: "Bot token", secret: true, required: true, placeholder: "123456:ABC..." },
      { key: "botUsername", label: "Bot username", secret: false, placeholder: "TurboLevBot" },
      { key: "webhookSecret", label: "Webhook secret", secret: true },
    ],
    envFallback: {
      botToken: "TELEGRAM_BOT_TOKEN",
      botUsername: "TELEGRAM_BOT_USERNAME",
      webhookSecret: "TELEGRAM_WEBHOOK_SECRET",
    },
  },
  {
    provider: "META",
    category: "COMMUNICATIONS",
    title: "Facebook + Instagram",
    description: "Messenger, Instagram Direct та Meta Lead Ads.",
    fields: [
      { key: "appId", label: "Meta App ID", secret: false, required: true },
      { key: "appSecret", label: "App secret", secret: true, required: true },
      { key: "verifyToken", label: "Webhook verify token", secret: true },
      { key: "userAccessToken", label: "User access token", secret: true },
      { key: "pageAccessToken", label: "Page access token", secret: true },
      { key: "pageId", label: "Facebook Page ID", secret: false },
      { key: "pageName", label: "Facebook Page", secret: false },
      { key: "instagramAccountId", label: "Instagram account ID", secret: false },
      { key: "instagramAccountName", label: "Instagram account", secret: false },
      { key: "externalAccountId", label: "External account ID", secret: false },
      { key: "externalAccountName", label: "External account", secret: false },
      { key: "scopes", label: "Scopes", secret: false },
      { key: "tokenExpiresAt", label: "Token expires at", secret: false },
    ],
    envFallback: {
      appId: "META_APP_ID",
      appSecret: "META_APP_SECRET",
      verifyToken: "META_WEBHOOK_VERIFY_TOKEN",
      pageAccessToken: "META_PAGE_ACCESS_TOKEN",
      userAccessToken: "META_USER_ACCESS_TOKEN",
    },
  },
  {
    provider: "TIKTOK",
    category: "COMMUNICATIONS",
    title: "TikTok",
    description: "TikTok Business, lead forms та доступні події акаунта.",
    fields: [
      { key: "clientKey", label: "Client key", secret: false, required: true },
      { key: "clientSecret", label: "Client secret", secret: true, required: true },
      { key: "accessToken", label: "Access token", secret: true },
      { key: "refreshToken", label: "Refresh token", secret: true },
      { key: "openId", label: "Open ID", secret: false },
      { key: "externalAccountId", label: "External account ID", secret: false },
      { key: "externalAccountName", label: "External account", secret: false },
      { key: "scopes", label: "Scopes", secret: false },
      { key: "tokenExpiresAt", label: "Token expires at", secret: false },
      { key: "refreshTokenExpiresAt", label: "Refresh token expires at", secret: false },
    ],
    envFallback: {
      clientKey: "TIKTOK_CLIENT_KEY",
      clientSecret: "TIKTOK_CLIENT_SECRET",
      accessToken: "TIKTOK_ACCESS_TOKEN",
      refreshToken: "TIKTOK_REFRESH_TOKEN",
    },
  },
  {
    provider: "OLX",
    category: "COMMUNICATIONS",
    title: "OLX",
    description: "Повідомлення, оголошення та прив'язка звернень до джерела.",
    fields: [
      { key: "clientId", label: "Client ID", secret: false, required: true },
      { key: "clientSecret", label: "Client secret", secret: true, required: true },
      { key: "apiKey", label: "API key", secret: true },
      { key: "notificationSecret", label: "Notification secret", secret: true },
      { key: "accessToken", label: "Access token", secret: true },
      { key: "refreshToken", label: "Refresh token", secret: true },
      { key: "externalAccountId", label: "External account ID", secret: false },
      { key: "externalAccountName", label: "External account", secret: false },
      { key: "scopes", label: "Scopes", secret: false },
      { key: "tokenExpiresAt", label: "Token expires at", secret: false },
    ],
    envFallback: {
      clientId: "OLX_CLIENT_ID",
      clientSecret: "OLX_CLIENT_SECRET",
      apiKey: "OLX_API_KEY",
      notificationSecret: "OLX_NOTIFICATION_SECRET",
      accessToken: "OLX_ACCESS_TOKEN",
      refreshToken: "OLX_REFRESH_TOKEN",
    },
  },
  {
    provider: "VEHICLE_IMAGES",
    category: "VEHICLES",
    title: "OpenAI API · зображення авто",
    description: "Власна бібліотека PNG: CRM генерує зображення конкретної марки, моделі та року через OpenAI і повторно використовує його в картках.",
    fields: [
      { key: "apiKey", label: "OpenAI API key", secret: true, required: true, placeholder: "sk-…" },
      { key: "model", label: "Модель зображень", secret: false, placeholder: "gpt-image-2" },
      { key: "quality", label: "Якість", secret: false, placeholder: "medium" },
      { key: "imageSize", label: "Розмір", secret: false, placeholder: "1536x1024" },
      { key: "outputFormat", label: "Формат", secret: false, placeholder: "png" },
      { key: "transparent", label: "Прозорий фон", secret: false, placeholder: "ON" },
      { key: "autoGenerate", label: "Автогенерація", secret: false, placeholder: "ON" },
      { key: "requireApproval", label: "Підтвердження", secret: false, placeholder: "ON" },
      { key: "reuseLibrary", label: "Повторне використання бібліотеки", secret: false, placeholder: "ON" },
    ],
    envFallback: {
      apiKey: "OPENAI_API_KEY",
      model: "OPENAI_IMAGE_MODEL",
      quality: "OPENAI_IMAGE_QUALITY",
      imageSize: "OPENAI_IMAGE_SIZE",
      outputFormat: "OPENAI_IMAGE_OUTPUT_FORMAT",
      transparent: "OPENAI_IMAGE_TRANSPARENT",
      autoGenerate: "VEHICLE_IMAGE_AUTO_GENERATE",
      requireApproval: "VEHICLE_IMAGE_REQUIRE_APPROVAL",
      reuseLibrary: "VEHICLE_IMAGE_REUSE_LIBRARY",
    },
  },
  {
    provider: "BM_PARTS",
    category: "SUPPLIERS",
    title: "BM Parts",
    description: "Пошук запчастин, закупівельні ціни, склади та залишки.",
    fields: [
      { key: "apiKey", label: "API key", secret: true, required: true },
      { key: "baseUrl", label: "API URL", secret: false, placeholder: "https://api.bm.parts" },
    ],
    envFallback: { apiKey: "BM_PARTS_API_KEY", baseUrl: "BM_PARTS_API_BASE_URL" },
  },
  {
    provider: "UNIQUE_TRADE",
    category: "SUPPLIERS",
    title: "Юнік Трейд",
    description: "B2B авторизація, ціни, наявність та пошук запчастин.",
    fields: [
      { key: "email", label: "B2B логін / email", secret: false, required: true },
      { key: "password", label: "Пароль", secret: true, required: true },
      { key: "baseUrl", label: "API URL", secret: false, placeholder: "https://order24-api.utr.ua" },
      { key: "fingerprint", label: "Browser fingerprint", secret: false, placeholder: "turbolev-crm-unique-trade-v2" },
    ],
    envFallback: {
      email: "UNIQUE_TRADE_EMAIL", password: "UNIQUE_TRADE_PASSWORD",
      baseUrl: "UNIQUE_TRADE_API_BASE_URL", fingerprint: "UNIQUE_TRADE_BROWSER_FINGERPRINT",
    },
  },
  {
    provider: "AUTONOVA_D",
    category: "SUPPLIERS",
    title: "Автонова-Д",
    description: "Підключення офіційного API Автонова-Д після отримання доступу від менеджера.",
    fields: [
      { key: "baseUrl", label: "API URL", secret: false, required: true },
      { key: "login", label: "API login", secret: false, required: true },
      { key: "password", label: "API password", secret: true, required: true },
    ],
    envFallback: { baseUrl: "AUTONOVA_API_BASE_URL", login: "AUTONOVA_API_LOGIN", password: "AUTONOVA_API_PASSWORD" },
  },
  {
    provider: "ATL",
    category: "SUPPLIERS",
    title: "ATL",
    description: "Постачальник автозапчастин ATL. Доступи зберігаємо в CRM; live API активуємо після отримання офіційного B2B/API endpoint.",
    fields: [
      { key: "login", label: "B2B логін / email", secret: false, required: true },
      { key: "password", label: "Пароль", secret: true, required: true },
      { key: "baseUrl", label: "API / B2B URL", secret: false, placeholder: "https://atl.ua" },
      { key: "apiKey", label: "API key / token", secret: true, placeholder: "Якщо ATL надасть окремий токен" },
    ],
    envFallback: { login: "ATL_LOGIN", password: "ATL_PASSWORD", baseUrl: "ATL_API_BASE_URL", apiKey: "ATL_API_KEY" },
  },
];

function providerSpec(provider: string) {
  return integrationProviderSpecs.find((item) => item.provider === provider) ?? null;
}

function encryptionKey() {
  const source = process.env.INTEGRATIONS_MASTER_KEY?.trim() || process.env.DATABASE_URL?.trim();
  if (!source) throw new Error("Server encryption key is unavailable");
  return createHash("sha256").update(`turbolev-integrations-v1:${source}`, "utf8").digest();
}

function encryptPayload(payload: Record<string, string>) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64url")}.${tag.toString("base64url")}.${encrypted.toString("base64url")}`;
}

function decryptPayload(value: string): Record<string, string> {
  const [version, ivRaw, tagRaw, encryptedRaw] = value.split(".");
  if (version !== "v1" || !ivRaw || !tagRaw || !encryptedRaw) throw new Error("Unsupported credential payload");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivRaw, "base64url"));
  decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedRaw, "base64url")),
    decipher.final(),
  ]).toString("utf8");
  const parsed = JSON.parse(decrypted) as Record<string, unknown>;
  return Object.fromEntries(Object.entries(parsed).filter(([, val]) => typeof val === "string")) as Record<string, string>;
}

function cleanValues(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {} as Record<string, string>;
  const output: Record<string, string> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (typeof value === "string") output[key] = value.trim();
  }
  return output;
}

function envValues(spec: ProviderSpec) {
  const values: Record<string, string> = {};
  for (const field of spec.fields) {
    const envName = spec.envFallback[field.key];
    const value = envName ? process.env[envName]?.trim() : "";
    if (value) values[field.key] = value;
  }
  return values;
}

function maskSecret(value: string) {
  if (!value) return "";
  const tail = value.slice(-4);
  return `${"•".repeat(Math.max(6, Math.min(10, value.length - 4)))}${tail}`;
}

function publicValues(spec: ProviderSpec, values: Record<string, string>) {
  const masked: Record<string, string> = {};
  const visible: Record<string, string> = {};
  for (const field of spec.fields) {
    const value = values[field.key] || "";
    if (!value) continue;
    if (field.secret) masked[field.key] = maskSecret(value);
    else visible[field.key] = value;
  }
  return { masked, visible };
}

async function readStored(provider: IntegrationProvider) {
  try {
    const pool = getSqlPool();
    const result = await pool.query(
      `SELECT "encryptedPayload","status","lastTestAt","lastTestStatus","lastTestMessage" FROM public."IntegrationCredential" WHERE "provider"=$1 LIMIT 1`,
      [provider],
    );
    if (!result.rowCount) return null;
    const row = result.rows[0];
    return {
      values: decryptPayload(String(row.encryptedPayload)),
      status: String(row.status || "CONFIGURED"),
      lastTestAt: row.lastTestAt ? new Date(row.lastTestAt).toISOString() : null,
      lastTestStatus: row.lastTestStatus ? String(row.lastTestStatus) : null,
      lastTestMessage: row.lastTestMessage ? String(row.lastTestMessage) : null,
    };
  } catch (error) {
    if (error instanceof Error && /IntegrationCredential|does not exist/i.test(error.message)) return null;
    throw error;
  }
}

function tokenExpired(values: Record<string, string>) {
  if (!values.tokenExpiresAt) return false;
  const time = new Date(values.tokenExpiresAt).getTime();
  return Number.isFinite(time) && time <= Date.now();
}

function effectiveStatus(provider: IntegrationProvider, values: Record<string, string>, storedStatus?: string | null): IntegrationStatus {
  const spec = providerSpec(provider)!;
  const configured = spec.fields.filter((field) => field.required).every((field) => Boolean(values[field.key]));
  if (!configured) return "NOT_CONFIGURED";
  if (tokenExpired(values)) return "TOKEN_EXPIRED";
  if (["META", "TIKTOK", "OLX"].includes(provider) && !values.accessToken && !values.pageAccessToken) return "AUTHORIZATION_REQUIRED";
  if (storedStatus === "CONNECTED") return "CONNECTED";
  if (storedStatus === "DEGRADED") return "DEGRADED";
  if (storedStatus === "ERROR") return "ERROR";
  return "CONFIGURED";
}

export async function getIntegrationCredential(provider: IntegrationProvider) {
  const spec = providerSpec(provider);
  if (!spec) return null;
  const stored = await readStored(provider);
  if (stored) return { ...stored.values, __source: "CRM" } as Record<string, string>;
  const fallback = envValues(spec);
  return Object.keys(fallback).length ? { ...fallback, __source: "ENV" } : null;
}

export async function isIntegrationConfigured(provider: IntegrationProvider) {
  const spec = providerSpec(provider);
  if (!spec) return false;
  const values = await getIntegrationCredential(provider);
  if (!values) return false;
  return spec.fields.filter((field) => field.required).every((field) => Boolean(values[field.key]));
}

export async function listIntegrationPublicStatuses() {
  return Promise.all(integrationProviderSpecs.map(async (spec) => {
    const stored = await readStored(spec.provider);
    const fallback = stored ? {} : envValues(spec);
    const values = stored?.values ?? fallback;
    const configured = spec.fields.filter((field) => field.required).every((field) => Boolean(values[field.key]));
    const { masked, visible } = publicValues(spec, values);
    return {
      provider: spec.provider,
      category: spec.category,
      title: spec.title,
      description: spec.description,
      fields: spec.fields,
      configured,
      configuredVia: stored ? "CRM" : Object.keys(fallback).length ? "ENV" : null,
      status: effectiveStatus(spec.provider, values, stored?.status),
      masked,
      visible,
      lastTestAt: stored?.lastTestAt ?? null,
      lastTestStatus: stored?.lastTestStatus ?? null,
      lastTestMessage: stored?.lastTestMessage ?? null,
    };
  }));
}

export async function saveIntegrationCredential(provider: IntegrationProvider, input: unknown) {
  const spec = providerSpec(provider);
  if (!spec) throw new Error("Unknown integration provider");
  const incoming = cleanValues(input);
  const stored = await readStored(provider);
  const fallback = envValues(spec);
  const merged: Record<string, string> = { ...fallback, ...(stored?.values ?? {}) };

  for (const field of spec.fields) {
    if (!(field.key in incoming)) continue;
    const value = incoming[field.key];
    if (value) merged[field.key] = value;
    else if (!field.secret) delete merged[field.key];
  }

  const generated: Record<string, string> = {};
  if (provider === "BINOTEL" && !merged.webhookToken) {
    merged.webhookToken = randomBytes(24).toString("hex");
    generated.webhookToken = merged.webhookToken;
  }
  if (provider === "TELEGRAM" && !merged.webhookSecret) {
    merged.webhookSecret = randomBytes(32).toString("base64url");
    generated.webhookSecret = merged.webhookSecret;
  }
  if (provider === "META" && !merged.verifyToken) {
    merged.verifyToken = randomBytes(24).toString("hex");
    generated.verifyToken = merged.verifyToken;
  }
  if (provider === "OLX" && !merged.notificationSecret) {
    merged.notificationSecret = randomBytes(32).toString("hex");
    generated.notificationSecret = merged.notificationSecret;
  }
  if (provider === "VEHICLE_IMAGES") {
    merged.model ||= "gpt-image-2";
    merged.quality ||= "medium";
    merged.imageSize ||= "1536x1024";
    merged.outputFormat = "png";
    merged.transparent = "ON";
    merged.autoGenerate ||= "ON";
    merged.requireApproval ||= "ON";
    merged.reuseLibrary ||= "ON";
  }

  const missing = spec.fields.filter((field) => field.required && !merged[field.key]).map((field) => field.label);
  if (missing.length) throw new Error(`Заповніть обов'язкові поля: ${missing.join(", ")}`);

  const { masked } = publicValues(spec, merged);
  const pool = getSqlPool();
  await pool.query(
    `INSERT INTO public."IntegrationCredential" ("id","provider","category","encryptedPayload","maskedSummary","status","createdAt","updatedAt")
     VALUES ($1,$2,$3,$4,$5::jsonb,'CONFIGURED',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
     ON CONFLICT ("provider") DO UPDATE SET
       "category"=EXCLUDED."category",
       "encryptedPayload"=EXCLUDED."encryptedPayload",
       "maskedSummary"=EXCLUDED."maskedSummary",
       "status"='CONFIGURED',
       "lastTestAt"=NULL,
       "lastTestStatus"=NULL,
       "lastTestMessage"=NULL,
       "updatedAt"=CURRENT_TIMESTAMP`,
    [`cred_${randomUUID().replace(/-/g, "")}`, provider, spec.category, encryptPayload(merged), JSON.stringify(masked)],
  );

  return { provider, configured: true, generated };
}

export async function deleteIntegrationCredential(provider: IntegrationProvider) {
  const pool = getSqlPool();
  await pool.query(`DELETE FROM public."IntegrationCredential" WHERE "provider"=$1`, [provider]);
  return { provider, deleted: true };
}

export async function recordIntegrationTest(provider: IntegrationProvider, result: { ok: boolean; message: string }) {
  const pool = getSqlPool();
  await pool.query(
    `UPDATE public."IntegrationCredential" SET "status"=$2,"lastTestAt"=CURRENT_TIMESTAMP,"lastTestStatus"=$2,"lastTestMessage"=$3,"updatedAt"=CURRENT_TIMESTAMP WHERE "provider"=$1`,
    [provider, result.ok ? "CONNECTED" : "ERROR", result.message],
  );
}

export async function recordIntegrationStatus(provider: IntegrationProvider, status: IntegrationStatus, message?: string) {
  const pool = getSqlPool();
  await pool.query(
    `UPDATE public."IntegrationCredential" SET "status"=$2,"lastTestMessage"=COALESCE($3,"lastTestMessage"),"updatedAt"=CURRENT_TIMESTAMP WHERE "provider"=$1`,
    [provider, status, message || null],
  );
}

export function isKnownIntegrationProvider(value: string): value is IntegrationProvider {
  return Boolean(providerSpec(value));
}
