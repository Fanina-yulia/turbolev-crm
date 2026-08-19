import { NextRequest, NextResponse } from "next/server";
import {
  deleteIntegrationCredential,
  isKnownIntegrationProvider,
  saveIntegrationCredential,
} from "@/src/services/integration-credentials.service";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function sameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!origin || !host) return true;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export async function PUT(request: NextRequest, context: { params: Promise<{ provider: string }> }) {
  const access = await authorize(PERMISSIONS.SETTINGS_INTEGRATIONS, { strict: true, request });
  if (!access.allowed) return access.response!;
  if (!sameOrigin(request)) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  try {
    const { provider: rawProvider } = await context.params;
    const provider = rawProvider.toUpperCase();
    if (!isKnownIntegrationProvider(provider)) {
      return NextResponse.json({ ok: false, error: "Невідома інтеграція" }, { status: 404 });
    }

    const body = await request.json();
    const result = await saveIntegrationCredential(provider, body?.values ?? body);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("PUT /api/settings/integrations/[provider] failed", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Не вдалося зберегти інтеграцію" },
      { status: 400 },
    );
  }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ provider: string }> }) {
  const access = await authorize(PERMISSIONS.SETTINGS_INTEGRATIONS, { strict: true, request });
  if (!access.allowed) return access.response!;
  if (!sameOrigin(request)) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  try {
    const { provider: rawProvider } = await context.params;
    const provider = rawProvider.toUpperCase();
    if (!isKnownIntegrationProvider(provider)) {
      return NextResponse.json({ ok: false, error: "Невідома інтеграція" }, { status: 404 });
    }
    const result = await deleteIntegrationCredential(provider);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("DELETE /api/settings/integrations/[provider] failed", error);
    return NextResponse.json({ ok: false, error: "Не вдалося видалити інтеграцію" }, { status: 500 });
  }
}
