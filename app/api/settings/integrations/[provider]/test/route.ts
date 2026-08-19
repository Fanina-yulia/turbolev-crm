import { NextRequest, NextResponse } from "next/server";
import {
  getIntegrationCredential,
  isKnownIntegrationProvider,
  recordIntegrationTest,
  type IntegrationProvider,
} from "@/src/services/integration-credentials.service";
import { testMetaConnection } from "@/src/services/meta-communications.service";
import { testOlxConnection } from "@/src/services/olx-communications.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function sameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!origin || !host) return true;
  try { return new URL(origin).host === host; } catch { return false; }
}

async function fetchWithTimeout(url: string, init?: RequestInit) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    return await fetch(url, { ...init, cache: "no-store", signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function testProvider(provider: IntegrationProvider, config: Record<string, string>) {
  if (provider === "BM_PARTS") {
    const baseUrl = (config.baseUrl || "https://api.bm.parts").replace(/\/$/, "");
    const response = await fetchWithTimeout(`${baseUrl}/profile/me`, {
      headers: { Accept: "application/json", Authorization: config.apiKey || "", "User-Agent": "TurboLEV-CRM/0.4.0" },
    });
    return response.ok
      ? { ok: true, message: "З'єднання з BM Parts працює." }
      : { ok: false, message: `BM Parts відповів HTTP ${response.status}.` };
  }

  if (provider === "UNIQUE_TRADE") {
    const baseUrl = (config.baseUrl || "https://order24-api.utr.ua").replace(/\/$/, "");
    const fingerprint = (config.fingerprint || "turbolev-crm-unique-trade-v2").slice(0, 128);
    const response = await fetchWithTimeout(`${baseUrl}/api/login_check?browser_fingerprint=${encodeURIComponent(fingerprint)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ email: config.email, password: config.password }),
    });
    return response.ok
      ? { ok: true, message: "Авторизація Юнік Трейд працює." }
      : { ok: false, message: `Юнік Трейд відповів HTTP ${response.status}.` };
  }

  if (provider === "BINOTEL") {
    const response = await fetchWithTimeout("https://api.binotel.com/api/4.0/settings/list-of-employees.json", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ key: config.apiKey || "", secret: config.apiSecret || "" }),
    });
    if (!response.ok) return { ok: false, message: `Binotel відповів HTTP ${response.status}.` };
    const data = await response.json().catch(() => null) as { status?: string; message?: string } | null;
    return data?.status === "error"
      ? { ok: false, message: data.message || "Binotel відхилив API credentials." }
      : { ok: true, message: "З'єднання з Binotel працює." };
  }

  if (provider === "META") return testMetaConnection();
  if (provider === "OLX") return testOlxConnection();

  if (provider === "AUTONOVA_D") {
    return { ok: false, message: "Доступ збережено. Автоматична перевірка буде доступна після офіційної API-документації Автонова-Д." };
  }

  if (provider === "ATL") {
    return { ok: false, message: "Доступ ATL збережено. Live-перевірку не запускаємо без офіційного B2B/API endpoint та документації ATL." };
  }

  return { ok: true, message: "Доступи збережені. З'єднання буде остаточно підтверджене першою live-подією провайдера." };
}

export async function POST(request: NextRequest, context: { params: Promise<{ provider: string }> }) {
  if (!sameOrigin(request)) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });

  try {
    const { provider: rawProvider } = await context.params;
    const provider = rawProvider.toUpperCase();
    if (!isKnownIntegrationProvider(provider)) {
      return NextResponse.json({ ok: false, error: "Невідома інтеграція" }, { status: 404 });
    }

    const config = await getIntegrationCredential(provider);
    if (!config) return NextResponse.json({ ok: false, message: "Спочатку збережіть доступи." }, { status: 400 });

    const started = Date.now();
    let result: { ok: boolean; message: string };
    try {
      result = await testProvider(provider, config);
    } catch (error) {
      result = { ok: false, message: error instanceof Error ? error.message : "Не вдалося перевірити з'єднання." };
    }

    await recordIntegrationTest(provider, result).catch(() => undefined);
    return NextResponse.json({ ...result, latencyMs: Date.now() - started, checkedAt: new Date().toISOString() }, { status: result.ok ? 200 : 422 });
  } catch (error) {
    console.error("POST integration test failed", error);
    return NextResponse.json({ ok: false, error: "Не вдалося перевірити інтеграцію" }, { status: 500 });
  }
}
