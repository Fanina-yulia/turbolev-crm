import "server-only";

import { NextResponse } from "next/server";
import {
  canUseDashboardWidget,
  dashboardAccessSnapshot,
  isDashboardWidgetType,
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

class VersionConflictError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function traceId() {
  return crypto.randomUUID();
}

function errorResponse(status: number, error: string, id: string, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ ok: false, error, traceId: id, ...extra }, { status, headers: { "Cache-Control": "no-store" } });
}

function safeExpectedVersion(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

async function authorizeDashboard(request: Request) {
  return authorize(PERMISSIONS.OVERVIEW_READ, { strict: true, request, minimumScope: "LOCATION" });
}

function currentPreset(context: { roles: Array<{ code: string }>; permissions: Record<string, unknown> }) {
  const preset = resolveDashboardPreset(context.roles.map((role) => role.code));
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

export async function handleDashboardConfigGet(request: Request) {
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

export async function handleDashboardConfigPut(request: Request) {
  return saveDashboard(request, false);
}

export async function handleDashboardConfigPost(request: Request) {
  const body = await request.clone().json().catch(() => null) as Record<string, unknown> | null;
  if (body?.action !== "reset") return errorResponse(400, "UNSUPPORTED_ACTION", traceId());
  return saveDashboard(request, true);
}

export async function handleDashboardBatchPost(request: Request) {
  const id = traceId();
  const access = await authorizeDashboard(request);
  if (!access.allowed) return access.response!;

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || !isSupportedDashboardId(body.dashboardId) || !Array.isArray(body.widgets)) {
    return errorResponse(400, "INVALID_BATCH_REQUEST", id);
  }

  const dashboardAccess = dashboardAccessSnapshot(access.context);
  const now = new Date().toISOString();
  const results = body.widgets.slice(0, 40).map((item) => {
    if (!isRecord(item)) {
      return { instanceId: null, widgetType: null, state: "error", error: "INVALID_WIDGET_REQUEST", traceId: id };
    }
    const instanceId = typeof item.instanceId === "string" ? item.instanceId.slice(0, 80) : null;
    if (!instanceId || !isDashboardWidgetType(item.widgetType)) {
      return { instanceId, widgetType: null, state: "error", error: "INVALID_WIDGET_REQUEST", traceId: id };
    }
    if (!canUseDashboardWidget(item.widgetType, dashboardAccess)) {
      return { instanceId, widgetType: item.widgetType, state: "forbidden", data: null, lastUpdatedAt: null, traceId: id };
    }
    return {
      instanceId,
      widgetType: item.widgetType,
      state: "empty",
      data: null,
      lastUpdatedAt: now,
      traceId: id,
    };
  });

  return NextResponse.json({ ok: true, traceId: id, results }, { headers: { "Cache-Control": "no-store" } });
}
