import { getIntegrationCredential, saveIntegrationCredential } from "@/src/services/integration-credentials.service";

const META_GRAPH_VERSION = process.env.META_GRAPH_VERSION?.trim() || "v26.0";

type JsonObject = Record<string, unknown>;
export type MetaManagedAccount = {
  pageId: string;
  pageName: string;
  instagramAccountId: string | null;
  instagramAccountName: string | null;
};

function record(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null;
}
function text(value: unknown) { return typeof value === "string" && value.trim() ? value.trim() : null; }

async function jsonFetch(url: string, init?: RequestInit) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(url, { ...init, cache: "no-store", signal: controller.signal });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const body = record(payload); const error = record(body?.error);
      throw new Error(text(error?.message) || text(body?.message) || `Meta HTTP ${response.status}`);
    }
    return payload;
  } finally { clearTimeout(timer); }
}

async function managedPages() {
  const config = await getIntegrationCredential("META");
  if (!config?.userAccessToken) throw new Error("Meta акаунт ще не авторизований. Натисніть «Підключити Facebook + Instagram».");
  const url = new URL(`https://graph.facebook.com/${META_GRAPH_VERSION}/me/accounts`);
  url.searchParams.set("fields", "id,name,access_token,tasks,instagram_business_account");
  url.searchParams.set("access_token", config.userAccessToken);
  const payload = record(await jsonFetch(url.toString())) || {};
  const pages = Array.isArray(payload.data) ? payload.data.map(record).filter(Boolean) as JsonObject[] : [];
  return { config, pages };
}

async function instagramName(instagramId: string, pageAccessToken: string) {
  const url = new URL(`https://graph.facebook.com/${META_GRAPH_VERSION}/${encodeURIComponent(instagramId)}`);
  url.searchParams.set("fields", "id,username,name");
  url.searchParams.set("access_token", pageAccessToken);
  const payload = record(await jsonFetch(url.toString()).catch(() => ({})));
  return text(payload?.username) || text(payload?.name) || null;
}

export async function listMetaManagedAccounts(): Promise<MetaManagedAccount[]> {
  const { pages } = await managedPages();
  return Promise.all(pages.map(async (page) => {
    const pageId = text(page.id) || "";
    const pageName = text(page.name) || pageId;
    const pageAccessToken = text(page.access_token) || "";
    const instagram = record(page.instagram_business_account);
    const instagramAccountId = text(instagram?.id);
    const instagramAccountName = instagramAccountId && pageAccessToken ? await instagramName(instagramAccountId, pageAccessToken) : null;
    return { pageId, pageName, instagramAccountId, instagramAccountName };
  })).then((items) => items.filter((item) => item.pageId));
}

export async function selectMetaManagedAccount(pageId: string) {
  const normalizedPageId = pageId.trim();
  if (!normalizedPageId) throw new Error("Оберіть Facebook Page.");
  const { pages } = await managedPages();
  const page = pages.find((item) => text(item.id) === normalizedPageId);
  if (!page) throw new Error("Обрана Facebook Page недоступна для авторизованого Meta акаунта.");

  const pageName = text(page.name) || normalizedPageId;
  const pageAccessToken = text(page.access_token);
  if (!pageAccessToken) throw new Error("Meta не повернула Page access token для обраної сторінки.");
  const instagram = record(page.instagram_business_account);
  const instagramAccountId = text(instagram?.id) || "";
  const instagramAccountName = instagramAccountId ? (await instagramName(instagramAccountId, pageAccessToken) || "") : "";

  let subscriptionWarning = "";
  const subscribeUrl = new URL(`https://graph.facebook.com/${META_GRAPH_VERSION}/${encodeURIComponent(normalizedPageId)}/subscribed_apps`);
  subscribeUrl.searchParams.set("subscribed_fields", "messages,messaging_postbacks,message_deliveries,message_reads,leadgen");
  subscribeUrl.searchParams.set("access_token", pageAccessToken);
  try { await jsonFetch(subscribeUrl.toString(), { method: "POST" }); }
  catch (error) { subscriptionWarning = error instanceof Error ? error.message : "Не вдалося автоматично підписати Page на webhook."; }

  await saveIntegrationCredential("META", {
    pageAccessToken,
    pageId: normalizedPageId,
    pageName,
    instagramAccountId,
    instagramAccountName,
    externalAccountId: normalizedPageId,
    externalAccountName: pageName,
  });

  return { pageId: normalizedPageId, pageName, instagramAccountId: instagramAccountId || null, instagramAccountName: instagramAccountName || null, subscriptionWarning };
}
