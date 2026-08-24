import { NextResponse } from "next/server";
import {
  dashboardAccessSnapshot,
  isSupportedDashboardId,
  listAllowedDashboardWidgetDefinitions,
  sanitizeDashboardConfig,
} from "@/src/dashboard-builder/config";
import { resolveDashboardPreset } from "@/src/dashboard-builder/presets";
import { MAIN_DASHBOARD_ID, type DashboardConfigDocument } from "@/src/dashboard-builder/types";
import { toPrismaJson } from "@/src/lib/prisma-json";
import { getPrisma } from "@/src/lib/prisma";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

class VersionConflictError extends Error {}

function traceId() {
  return crypto.randomUUID();
}

function errorResponse(status: number, error: string, id: string, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ ok: false, error, traceId: id, ...extra }, { status, headers: { "Cache-Control": "no-store" } });
}

function roleCodes(roles: Array<{ code: string }>) {
  return roles.map((role) => role.code);
}

function safeExpectedVersion(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

async function authorizeDashboard(request: Request) {
  return authorize(PERMISSIONS.OVERVIEW_READ, { strict: true, request, minimumScope: "SELF" });
}

function currentPreset(context: { roles: Array<{ code: string }>; permissions: Record<string, unknown> }) {
  const preset = resolveDashboardPreset(roleCodes(context.roles));
  const access = dashboardAccessSnapshot(context);
  const config = sanitizeDashboardConfig(preset.config, access, preset.presetId);
  const catalog = listAllowedDashboardWidgetDefinitions(access).map((definition) => ({
    id: definition.id,
    widgetType: definition.widgetType,
    title: definition.title,
    description: definition.description,
    sizes: definition.sizes,
    minW: definition.minW,
    minH: definition.minH,
    maxW: definition.maxW,
    maxH: definition.maxH,
    defaultW: definition.defaultW,
    defaultH: definition.defaultH,
  }));
  return { preset, access, catalog, config: { ...config, presetId: preset.presetId } };
}

export async function GET(request: Request) {
  const id = traceId();
  const access = await authorizeDashboard(request);
  if (!access.allowed) return access.response!;
  const userId = access.context.user?.id;
  if (!userId) return errorResponse(401, "UNAUTHENTICATED", id);

  const { preset, access: dashboardAccess, catalog, config: presetConfig } = currentPreset(access.context);
  const prisma = getPrisma();
  const stored = await prisma.dashboardConfiguration.findUnique({
    where: { userId_dashboardId: { userId, dashboardId: MAIN_DASHBOARD_ID } },
  });

  if (!stored) {
    return NextResponse.json({
      ok: true,
      traceId: id,
      dashboardId: MAIN_DASHBOARD_ID,
      version: 0,
      source: "preset",
      presetId: preset.presetId,
      catalog,
      config: presetConfig,
    }, { headers: { "Cache-Control": "no-store" } });
  }

  const config = sanitizeDashboardConfig(stored.config, dashboardAccess, preset.presetId);
  return NextResponse.json({
    ok: true,
    traceId: id,
    dashboardId: MAIN_DASHBOARD_ID,
    version: stored.version,
    source: "user",
    presetId: stored.presetId,
    catalog,
    config,
  }, { headers: { "Cache-Control": "no-store" } });
}

async function saveDashboard(request: Request, resetToPreset: boolean) {
  const id = traceId();
  const access = await authorizeDashboard(request);
  if (!access.allowed) return access.response!;
  const userId = access.context.user?.id;
  if (!userId) return errorResponse(401, "UNAUTHENTICATED", id);

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || !isSupportedDashboardId(body.dashboardId)) {
    return errorResponse(400, "INVALID_DASHBOARD_ID", id);
  }
  const expectedVersion = safeExpectedVersion(body.expectedVersion);
  if (expectedVersion === null) return errorResponse(400, "INVALID_EXPECTED_VERSION", id);

  const { preset, access: dashboardAccess, catalog, config: presetConfig } = currentPreset(access.context);
  const requestedConfig = resetToPreset ? presetConfig : body.config;
  const sanitized = sanitizeDashboardConfig(requestedConfig, dashboardAccess, preset.presetId);
  const config: DashboardConfigDocument = { ...sanitized, presetId: preset.presetId };
  const configJson = toPrismaJson(config);
  const prisma = getPrisma();

  try {
    const saved = await prisma.$transaction(async (tx) => {
      const existing = await tx.dashboardConfiguration.findUnique({
        where: { userId_dashboardId: { userId, dashboardId: MAIN_DASHBOARD_ID } },
      });

      if (!existing) {
        if (expectedVersion !== 0) throw new VersionConflictError();
        const created = await tx.dashboardConfiguration.create({
          data: {
            userId,
            dashboardId: MAIN_DASHBOARD_ID,
            version: 1,
            presetId: preset.presetId,
            config: configJson,
          },
        });
        await tx.dashboardConfigurationVersion.create({
          data: {
            dashboardConfigurationId: created.id,
            version: 1,
            presetId: preset.presetId,
            config: configJson,
            createdByUserId: userId,
          },
        });
        return created;
      }

      if (existing.version !== expectedVersion) throw new VersionConflictError();
      const nextVersion = existing.version + 1;
      const updated = await tx.dashboardConfiguration.updateMany({
        where: { id: existing.id, version: expectedVersion },
        data: { version: nextVersion, presetId: preset.presetId, config: configJson },
      });
      if (updated.count !== 1) throw new VersionConflictError();

      await tx.dashboardConfigurationVersion.create({
        data: {
          dashboardConfigurationId: existing.id,
          version: nextVersion,
          presetId: preset.presetId,
          config: configJson,
          createdByUserId: userId,
        },
      });
      return tx.dashboardConfiguration.findUniqueOrThrow({ where: { id: existing.id } });
    });

    return NextResponse.json({
      ok: true,
      traceId: id,
      dashboardId: MAIN_DASHBOARD_ID,
      version: saved.version,
      source: "user",
      presetId: saved.presetId,
      catalog,
      reset: resetToPreset,
      config,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (cause) {
    if (cause instanceof VersionConflictError) {
      const current = await prisma.dashboardConfiguration.findUnique({
        where: { userId_dashboardId: { userId, dashboardId: MAIN_DASHBOARD_ID } },
        select: { version: true },
      });
      return errorResponse(409, "DASHBOARD_VERSION_CONFLICT", id, { currentVersion: current?.version ?? 0 });
    }
    console.error("[dashboard-config] save failed", { traceId: id, userId, resetToPreset, cause });
    return errorResponse(500, "DASHBOARD_CONFIG_SAVE_FAILED", id);
  }
}

export async function PUT(request: Request) {
  return saveDashboard(request, false);
}

export async function POST(request: Request) {
  const body = await request.clone().json().catch(() => null) as Record<string, unknown> | null;
  if (body?.action !== "reset") return errorResponse(400, "UNSUPPORTED_ACTION", traceId());
  return saveDashboard(request, true);
}
