import { NextRequest, NextResponse } from "next/server";
import {
  getIntegrationCredential,
  isKnownIntegrationProvider,
  recordIntegrationTest,
  type IntegrationProvider,
} from "@/src/services/integration-credentials.service";
import { testTikTokConnection } from "@/src/services/integration-oauth.service";
import { testMetaConnection } from "@/src/services/meta-communications.service";
import { testOlxConnection } from "@/src/services/olx-communications.service";
import { bmPartsAdapter } from "@/src/services/suppliers/bm-parts.adapter";
import { uniqueTradeAdapter } from "@/src/services/suppliers/unique-trade.adapter";
import { testVehicleImageConnection } from "@/src/services/vehicle-images/vehicle-image.service";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type TestResult = { ok: boolean; message: string; state?: string; checkedAt?: string; latencyMs?: number };

function sameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!origin || !host) return true;
  try { return new URL(origin).host === host; } catch { return false; }
}

async function fetchWithTimeout(url: string, init?: RequestInit) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try { return await fetch(url, { ...init, cache: "no-store", signal: controller.signal }); }
  finally { clearTimeout(timeout); }
}

async function testProvider(provider: IntegrationProvider, config?: Record<string, string> | null): Promise<TestResult> {
  if (provider === "BM_PARTS") return bmPartsAdapter.testConnection();
  if (provider === "UNIQUE_TRADE") return uniqueTradeAdapter.testConnection();
  if (provider === "VEHICLE_IMAGES") return testVehicleImageConnection();
  if (provider === "TIKTOK") return testTikTokConnection();

  if (provider === "AUTONOVA_D") return { ok: false, state: "MANUAL_SETUP", message: "Live API Автонова-Д не запускається без офіційного endpoint, способу авторизації та технічної документації постачальника." };
  if (provider === "ATL") return { ok: false, state: "MANUAL_SETUP", message: "Live API ATL не запускається без офіційного B2B/API endpoint та технічної документації постачальника." };
  if (!config) return { ok: false, message: "Спочатку збережіть доступи." };

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
  return { ok: true, message: "Доступи збережені." };
}

export async function POST(request: NextRequest, context: { params: Promise<{ provider: string }> }) {
  const access = await authorize(PERMISSIONS.SETTINGS_INTEGRATIONS, { strict: true, request });
  if (!access.allowed) return access.response!;
  if (!sameOrigin(request)) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });

  try {
    const { provider: rawProvider } = await context.params;
    const provider = rawProvider.toUpperCase();
    if (!isKnownIntegrationProvider(provider)) return NextResponse.json({ ok: false, error: "Невідома інтеграція" }, { status: 404 });

    if (provider === "AUTONOVA_D" || provider === "ATL") {
      const result = await testProvider(provider);
      return NextResponse.json({ ...result, checkedAt: new Date().toISOString() }, { status: 200, headers: { "Cache-Control": "no-store" } });
    }

    const adapterManaged = provider === "BM_PARTS" || provider === "UNIQUE_TRADE" || provider === "VEHICLE_IMAGES" || provider === "TIKTOK";
    const config = adapterManaged ? null : await getIntegrationCredential(provider);
    if (!adapterManaged && !config) return NextResponse.json({ ok: false, message: "Спочатку збережіть доступи." }, { status: 400 });

    const started = Date.now();
    let result: TestResult;
    try { result = await testProvider(provider, config); }
    catch (error) { result = { ok: false, message: error instanceof Error ? error.message : "Не вдалося перевірити з'єднання." }; }

    await recordIntegrationTest(provider, result).catch(() => undefined);
    return NextResponse.json({ ...result, latencyMs: result.latencyMs ?? Date.now() - started, checkedAt: result.checkedAt ?? new Date().toISOString() }, { status: result.ok ? 200 : 422, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("POST integration test failed", error);
    return NextResponse.json({ ok: false, error: "Не вдалося перевірити інтеграцію" }, { status: 500 });
  }
}
