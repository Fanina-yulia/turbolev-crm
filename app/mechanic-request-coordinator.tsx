"use client";

import { type ReactNode, useEffect, useState } from "react";

type CachedResponse = {
  status: number;
  statusText: string;
  headers: Array<[string, string]>;
  body: string;
  jsonValue?: unknown;
  savedAt: number;
};

type CompactCheckRequest = {
  diagnosticId: string;
  checkId: string;
  body: Record<string, unknown>;
  resolve: (response: Response) => void;
  settled: boolean;
};

type CompactFlushResult = {
  ok: boolean;
  message?: string;
};

type SnapshotKey = "home" | "tasks" | "diagnostics" | "notifications" | "findings" | "assignedVehicles";
type SnapshotEnvelope = { ok?: boolean } & Partial<Record<SnapshotKey, unknown>>;
type DiagnosticBootstrapEnvelope = {
  ok?: boolean;
  mode?: "MATRIX" | "LEGACY";
  detail?: unknown;
};
type DiagnosticBootstrapCache = {
  mode: CachedResponse;
  detail: CachedResponse;
  savedAt: number;
};

const SNAPSHOT_PATHS: Record<string, SnapshotKey> = {
  "/api/cabinet/home": "home",
  "/api/cabinet/mechanic/tasks": "tasks",
  "/api/diagnostics/me": "diagnostics",
  "/api/cabinet/mechanic/notifications": "notifications",
  "/api/cabinet/mechanic/findings": "findings",
  "/api/cabinet/mechanic/assigned-vehicles": "assignedVehicles",
};

const GET_TTLS: Array<[RegExp, number]> = [
  [/^\/api\/cabinet\/home(?:\?|$)/, 55_000],
  [/^\/api\/diagnostics\/me(?:\?|$)/, 55_000],
  [/^\/api\/cabinet\/mechanic\/assigned-vehicles(?:\?|$)/, 55_000],
  [/^\/api\/cabinet\/mechanic\/tasks(?:\?|$)/, 35_000],
  [/^\/api\/cabinet\/mechanic\/notifications(?:\?|$)/, 55_000],
  [/^\/api\/cabinet\/mechanic\/findings(?:\?|$)/, 55_000],
];
const DIAGNOSTIC_BOOTSTRAP_TTL = 15_000;
const COMPACT_BATCH_IDLE_MS = 24;
const LEGACY_CHASSIS_CHUNK_SIZE = 6;

function relativeUrl(input: RequestInfo | URL) {
  try {
    if (input instanceof Request) {
      const url = new URL(input.url, window.location.origin);
      return `${url.pathname}${url.search}`;
    }
    const url = new URL(String(input), window.location.origin);
    return `${url.pathname}${url.search}`;
  } catch {
    return String(input);
  }
}

function pathname(path: string) {
  return path.split("?", 1)[0] || path;
}

function requestMethod(input: RequestInfo | URL, init?: RequestInit) {
  return String(init?.method || (input instanceof Request ? input.method : "GET") || "GET").toUpperCase();
}

function ttlFor(path: string) {
  return GET_TTLS.find(([pattern]) => pattern.test(path))?.[1] ?? 0;
}

function makeResponse(snapshot: CachedResponse) {
  const response = new Response(snapshot.body, {
    status: snapshot.status,
    statusText: snapshot.statusText,
    headers: snapshot.headers,
  });
  if (snapshot.jsonValue !== undefined) {
    Object.defineProperty(response, "json", {
      configurable: true,
      value: async () => snapshot.jsonValue,
    });
  }
  return response;
}

function responseFromJson(value: unknown, savedAt = Date.now()): CachedResponse {
  return {
    status: 200,
    statusText: "OK",
    headers: [["content-type", "application/json"]],
    body: JSON.stringify(value),
    jsonValue: value,
    savedAt,
  };
}

function compactSuccessResponse(checkId: string) {
  return new Response(JSON.stringify({
    ok: true,
    saved: true,
    check: { id: checkId, state: "OK" },
  }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function compactErrorResponse(message: string, status = 503) {
  return new Response(JSON.stringify({
    ok: false,
    error: "BATCH_SAVE_FAILED",
    message,
  }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function snapshotResponse(response: Response): Promise<CachedResponse> {
  const clone = response.clone();
  const headers = Array.from(clone.headers.entries());
  const body = await clone.text();
  let jsonValue: unknown = undefined;
  if ((clone.headers.get("content-type") || "").toLowerCase().includes("json") && body) {
    try {
      jsonValue = JSON.parse(body) as unknown;
    } catch {
      jsonValue = undefined;
    }
  }
  return {
    status: clone.status,
    statusText: clone.statusText,
    headers,
    body,
    jsonValue,
    savedAt: Date.now(),
  };
}

function parseCompactCheck(path: string, init?: RequestInit) {
  const match = path.match(/^\/api\/diagnostics\/([^/]+)\/checks\/([^/?]+)\?[^#]*\bcompact=1\b/);
  if (!match || !init || requestMethod("", init) !== "PATCH" || typeof init.body !== "string") return null;
  try {
    const body = JSON.parse(init.body) as Record<string, unknown>;
    if (String(body.state || "").toUpperCase() !== "OK") return null;
    return {
      diagnosticId: decodeURIComponent(match[1]),
      checkId: decodeURIComponent(match[2]),
      body,
    };
  } catch {
    return null;
  }
}

function parseStructuredDiagnostic(path: string) {
  const match = pathname(path).match(/^\/api\/diagnostics\/([^/]+)\/structured$/);
  if (!match) return null;
  const query = path.includes("?") ? new URLSearchParams(path.slice(path.indexOf("?") + 1)) : new URLSearchParams();
  return {
    diagnosticId: decodeURIComponent(match[1]),
    modeOnly: query.get("mode") === "1",
  };
}

function diagnosticIdFromPath(path: string) {
  const match = pathname(path).match(/^\/api\/diagnostics\/([^/]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

function cachedDiagnosticWorkflow(entry: DiagnosticBootstrapCache | undefined) {
  const root = entry?.detail.jsonValue;
  if (!root || typeof root !== "object" || Array.isArray(root)) return null;
  const diagnostic = (root as { diagnostic?: unknown }).diagnostic;
  if (!diagnostic || typeof diagnostic !== "object" || Array.isArray(diagnostic)) return null;
  const row = diagnostic as { workflowState?: unknown; status?: unknown };
  const state = String(row.workflowState || row.status || "").trim().toUpperCase();
  return state || null;
}

function isMechanicMutation(path: string, method: string) {
  if (method === "GET" || method === "HEAD") return false;
  return path.startsWith("/api/cabinet/") || path.startsWith("/api/diagnostics/");
}

/**
 * Compatibility performance layer for the mechanic cabinet.
 *
 * Legacy widgets keep their existing fetch contracts, while the coordinator serves
 * their read models from one snapshot, deduplicates requests, coalesces mass OK checks
 * into one transaction, and uses a single diagnostic bootstrap for mode + detail.
 */
export function MechanicRequestCoordinator({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const originalFetch = window.fetch.bind(window);
    const cache = new Map<string, CachedResponse>();
    const inflight = new Map<string, Promise<CachedResponse>>();
    const compactQueues = new Map<string, CompactCheckRequest[]>();
    const compactTimers = new Map<string, number>();
    const compactMassMode = new Set<string>();
    const compactFlushes = new Map<string, Promise<CompactFlushResult>>();
    const diagnosticCache = new Map<string, DiagnosticBootstrapCache>();
    const diagnosticInflight = new Map<string, Promise<void>>();
    let snapshotInflight: Promise<void> | null = null;
    let cacheEpoch = 0;
    let disposed = false;

    const invalidateAll = () => {
      cacheEpoch += 1;
      cache.clear();
      inflight.clear();
      diagnosticCache.clear();
      diagnosticInflight.clear();
    };

    const invalidateSnapshotResources = (paths: string[]) => {
      cacheEpoch += 1;
      for (const path of paths) cache.delete(path);
      inflight.clear();
    };

    const invalidateForMutation = (path: string) => {
      const cleanPath = pathname(path);
      const diagnosticId = diagnosticIdFromPath(path);
      if (diagnosticId) diagnosticCache.delete(diagnosticId);

      if (cleanPath === "/api/cabinet/mechanic/notifications") {
        invalidateSnapshotResources(["/api/cabinet/mechanic/notifications"]);
        return;
      }
      if (cleanPath === "/api/cabinet/mechanic/findings") {
        invalidateSnapshotResources([
          "/api/cabinet/mechanic/findings",
          "/api/cabinet/mechanic/notifications",
          "/api/cabinet/mechanic/tasks",
        ]);
        return;
      }
      if (/^\/api\/cabinet\/mechanic\/tasks\/[^/]+$/.test(cleanPath)) {
        invalidateSnapshotResources([
          "/api/cabinet/home",
          "/api/cabinet/mechanic/tasks",
          "/api/cabinet/mechanic/assigned-vehicles",
        ]);
        return;
      }
      if (cleanPath.includes("/vehicle-scan") || cleanPath.includes("/walk-in")) {
        invalidateSnapshotResources([
          "/api/cabinet/home",
          "/api/cabinet/mechanic/tasks",
          "/api/diagnostics/me",
          "/api/cabinet/mechanic/assigned-vehicles",
        ]);
        return;
      }
      if (cleanPath.startsWith("/api/diagnostics/")) {
        invalidateSnapshotResources([
          "/api/diagnostics/me",
          "/api/cabinet/home",
        ]);
        return;
      }
      invalidateAll();
    };

    async function loadSnapshot() {
      if (snapshotInflight) return snapshotInflight;
      const epoch = cacheEpoch;
      const task = (async () => {
        const response = await originalFetch("/api/cabinet/mechanic/snapshot", {
          cache: "no-store",
          credentials: "include",
        });
        const body = await response.json().catch(() => null) as SnapshotEnvelope | null;
        if (!response.ok || !body?.ok) throw new Error("MECHANIC_SNAPSHOT_LOAD_FAILED");
        if (disposed || epoch !== cacheEpoch) return;

        const savedAt = Date.now();
        for (const [resourcePath, key] of Object.entries(SNAPSHOT_PATHS)) {
          const value = body[key];
          if (value !== undefined) cache.set(resourcePath, responseFromJson(value, savedAt));
        }
      })();
      snapshotInflight = task.finally(() => {
        snapshotInflight = null;
      });
      return snapshotInflight;
    }

    async function loadDiagnosticBootstrap(diagnosticId: string) {
      const cached = diagnosticCache.get(diagnosticId);
      if (cached && Date.now() - cached.savedAt < DIAGNOSTIC_BOOTSTRAP_TTL) return;
      const active = diagnosticInflight.get(diagnosticId);
      if (active) return active;

      const epoch = cacheEpoch;
      const task = (async () => {
        const response = await originalFetch(`/api/cabinet/mechanic/diagnostics/${encodeURIComponent(diagnosticId)}/bootstrap`, {
          cache: "no-store",
          credentials: "include",
        });
        const body = await response.json().catch(() => null) as DiagnosticBootstrapEnvelope | null;
        if (!response.ok || !body?.ok || !body.mode || body.detail === undefined) {
          throw new Error("MECHANIC_DIAGNOSTIC_BOOTSTRAP_FAILED");
        }
        if (disposed || epoch !== cacheEpoch) return;
        const savedAt = Date.now();
        diagnosticCache.set(diagnosticId, {
          savedAt,
          mode: responseFromJson({ ok: true, mode: body.mode }, savedAt),
          detail: responseFromJson(body.detail, savedAt),
        });
      })().finally(() => {
        diagnosticInflight.delete(diagnosticId);
      });
      diagnosticInflight.set(diagnosticId, task);
      return task;
    }

    async function flushCompact(diagnosticId: string): Promise<CompactFlushResult> {
      const active = compactFlushes.get(diagnosticId);
      if (active) return active;

      const queued = compactQueues.get(diagnosticId) || [];
      if (!queued.length) return { ok: true };
      compactQueues.delete(diagnosticId);
      compactMassMode.delete(diagnosticId);
      const timer = compactTimers.get(diagnosticId);
      if (timer != null) window.clearTimeout(timer);
      compactTimers.delete(diagnosticId);

      const task = (async (): Promise<CompactFlushResult> => {
        const unique = Array.from(new Map(queued.map((item) => [item.checkId, item])).values());
        const hadOptimisticResponses = queued.some((item) => item.settled);
        let response: Response;
        try {
          response = await originalFetch(`/api/diagnostics/${encodeURIComponent(diagnosticId)}/checks/batch`, {
            method: "PATCH",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              updates: unique.map((item) => ({ checkId: item.checkId, state: "OK" })),
            }),
          });
        } catch {
          const message = "Не вдалося зберегти відмітки діагностики.";
          for (const item of queued) {
            if (!item.settled) {
              item.settled = true;
              item.resolve(compactErrorResponse(message));
            }
          }
          if (hadOptimisticResponses) window.alert(message);
          return { ok: false, message };
        }

        const bodyText = await response.clone().text();
        if (!response.ok) {
          let message = "Не вдалося зберегти відмітки діагностики.";
          try {
            const parsed = JSON.parse(bodyText) as { message?: string };
            if (parsed.message) message = parsed.message;
          } catch {
            // Keep the safe fallback message.
          }
          for (const item of queued) {
            if (!item.settled) {
              item.settled = true;
              item.resolve(compactErrorResponse(message, response.status));
            }
          }
          if (hadOptimisticResponses) window.alert(message);
          return { ok: false, message };
        }

        invalidateForMutation(`/api/diagnostics/${diagnosticId}/checks/batch`);
        for (const item of queued) {
          if (!item.settled) {
            item.settled = true;
            item.resolve(compactSuccessResponse(item.checkId));
          }
        }
        return { ok: true };
      })().finally(() => {
        compactFlushes.delete(diagnosticId);
      });

      compactFlushes.set(diagnosticId, task);
      return task;
    }

    function enqueueCompact(request: Omit<CompactCheckRequest, "resolve" | "settled">) {
      return new Promise<Response>((resolve) => {
        const item: CompactCheckRequest = { ...request, resolve, settled: false };
        const next = [...(compactQueues.get(request.diagnosticId) || []), item];
        compactQueues.set(request.diagnosticId, next);

        // Legacy completeChassis sends chunks of six. Once a full legacy chunk appears,
        // settle compatibility promises so the remaining chunks can join the same
        // debounced server batch. Smaller section actions still wait for the real write.
        if (next.length >= LEGACY_CHASSIS_CHUNK_SIZE) compactMassMode.add(request.diagnosticId);
        if (compactMassMode.has(request.diagnosticId)) {
          for (const queued of next) {
            if (!queued.settled) {
              queued.settled = true;
              queued.resolve(compactSuccessResponse(queued.checkId));
            }
          }
        }

        const existing = compactTimers.get(request.diagnosticId);
        if (existing != null) window.clearTimeout(existing);
        compactTimers.set(request.diagnosticId, window.setTimeout(() => {
          void flushCompact(request.diagnosticId);
        }, COMPACT_BATCH_IDLE_MS));
      });
    }

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = relativeUrl(input);
      const method = requestMethod(input, init);
      const compact = parseCompactCheck(path, init);
      if (compact) return enqueueCompact(compact);

      const cleanPath = pathname(path);
      const matrixStartMatch = method === "POST" ? cleanPath.match(/^\/api\/diagnostics\/([^/]+)\/matrix-start$/) : null;
      if (matrixStartMatch) {
        const diagnosticId = decodeURIComponent(matrixStartMatch[1]);
        const cached = diagnosticCache.get(diagnosticId);
        const workflow = cachedDiagnosticWorkflow(cached);
        if (cached && Date.now() - cached.savedAt < DIAGNOSTIC_BOOTSTRAP_TTL && workflow && workflow !== "PENDING") {
          return makeResponse(cached.detail);
        }
      }

      if (isMechanicMutation(path, method)) invalidateForMutation(path);

      const structured = method === "GET" ? parseStructuredDiagnostic(path) : null;
      if (structured) {
        const pendingBatch = await flushCompact(structured.diagnosticId);
        if (!pendingBatch.ok) return compactErrorResponse(pendingBatch.message || "Не вдалося зберегти діагностику.");

        const cached = diagnosticCache.get(structured.diagnosticId);
        if (cached && Date.now() - cached.savedAt < DIAGNOSTIC_BOOTSTRAP_TTL) {
          return makeResponse(structured.modeOnly ? cached.mode : cached.detail);
        }
        try {
          await loadDiagnosticBootstrap(structured.diagnosticId);
          const fresh = diagnosticCache.get(structured.diagnosticId);
          if (fresh) return makeResponse(structured.modeOnly ? fresh.mode : fresh.detail);
        } catch {
          // Fall through to the original structured endpoint as a safe compatibility fallback.
        }
        return originalFetch(input, init);
      }

      const resourcePath = pathname(path);
      const snapshotKey = SNAPSHOT_PATHS[resourcePath];
      if (method === "GET" && snapshotKey) {
        const ttl = ttlFor(path) || 55_000;
        const cached = cache.get(resourcePath);
        if (cached && (document.visibilityState !== "visible" || Date.now() - cached.savedAt < ttl)) {
          return makeResponse(cached);
        }
        try {
          await loadSnapshot();
          const fresh = cache.get(resourcePath);
          if (fresh) return makeResponse(fresh);
        } catch {
          // Fall through to the original endpoint as a safe compatibility fallback.
        }
        return originalFetch(input, init);
      }

      const ttl = method === "GET" ? ttlFor(path) : 0;
      if (!ttl) return originalFetch(input, init);

      const cached = cache.get(path);
      if (cached && (document.visibilityState !== "visible" || Date.now() - cached.savedAt < ttl)) {
        return makeResponse(cached);
      }

      const active = inflight.get(path);
      if (active) return makeResponse(await active);

      const epoch = cacheEpoch;
      const request = originalFetch(input, init).then(async (response) => {
        const snapshot = await snapshotResponse(response);
        if (response.ok && !disposed && epoch === cacheEpoch) cache.set(path, snapshot);
        return snapshot;
      }).finally(() => {
        inflight.delete(path);
      });
      inflight.set(path, request);
      return makeResponse(await request);
    };

    const onRefresh = () => invalidateAll();
    const onVisible = () => {
      if (document.visibilityState === "visible") invalidateAll();
    };
    window.addEventListener("turbolev:mechanic-refresh", onRefresh);
    window.addEventListener("online", onRefresh);
    document.addEventListener("visibilitychange", onVisible);
    setReady(true);

    return () => {
      disposed = true;
      window.fetch = originalFetch;
      window.removeEventListener("turbolev:mechanic-refresh", onRefresh);
      window.removeEventListener("online", onRefresh);
      document.removeEventListener("visibilitychange", onVisible);
      for (const timer of compactTimers.values()) window.clearTimeout(timer);
      compactTimers.clear();
      for (const diagnosticId of compactQueues.keys()) void flushCompact(diagnosticId);
      cache.clear();
      inflight.clear();
      diagnosticCache.clear();
      diagnosticInflight.clear();
    };
  }, []);

  if (!ready) {
    return <div style={{ minHeight: "100dvh", display: "grid", placeItems: "center", background: "#0f141a", color: "#aab4bf", fontSize: 14 }}>Відкриваю кабінет механіка…</div>;
  }

  return <>{children}</>;
}
