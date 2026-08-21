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
};

type SnapshotKey = "home" | "tasks" | "diagnostics" | "notifications" | "findings" | "assignedVehicles";
type SnapshotEnvelope = { ok?: boolean } & Partial<Record<SnapshotKey, unknown>>;

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
  [/^\/api\/cabinet\/mechanic\/tasks(?:\?|$)/, 25_000],
  [/^\/api\/cabinet\/mechanic\/notifications(?:\?|$)/, 55_000],
  [/^\/api\/cabinet\/mechanic\/findings(?:\?|$)/, 55_000],
];

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

function isMechanicMutation(path: string, method: string) {
  if (method === "GET" || method === "HEAD") return false;
  return path.startsWith("/api/cabinet/") || path.startsWith("/api/diagnostics/");
}

/**
 * Compatibility performance layer for the mechanic cabinet.
 *
 * The legacy widgets keep their existing fetch contracts, but their core read models
 * are served from one consolidated snapshot. This removes duplicate authorization and
 * database work without forcing a risky one-shot rewrite of the mechanic UI.
 */
export function MechanicRequestCoordinator({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const originalFetch = window.fetch.bind(window);
    const cache = new Map<string, CachedResponse>();
    const inflight = new Map<string, Promise<CachedResponse>>();
    const compactQueues = new Map<string, CompactCheckRequest[]>();
    const compactTimers = new Map<string, number>();
    let snapshotInflight: Promise<void> | null = null;
    let cacheEpoch = 0;
    let disposed = false;

    const clearReadCache = () => {
      cacheEpoch += 1;
      cache.clear();
      inflight.clear();
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

    async function flushCompact(diagnosticId: string) {
      const queued = compactQueues.get(diagnosticId) || [];
      if (!queued.length) return;
      compactQueues.delete(diagnosticId);
      const timer = compactTimers.get(diagnosticId);
      if (timer != null) window.clearTimeout(timer);
      compactTimers.delete(diagnosticId);

      const unique = Array.from(new Map(queued.map((item) => [item.checkId, item])).values());
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
        for (const item of queued) {
          item.resolve(new Response(JSON.stringify({ ok: false, error: "BATCH_NETWORK_ERROR", message: "Не вдалося зберегти відмітки." }), {
            status: 503,
            headers: { "Content-Type": "application/json" },
          }));
        }
        return;
      }

      const bodyText = await response.clone().text();
      if (!response.ok) {
        for (const item of queued) {
          item.resolve(new Response(bodyText, {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
          }));
        }
        return;
      }

      clearReadCache();
      for (const item of queued) {
        item.resolve(new Response(JSON.stringify({
          ok: true,
          saved: true,
          check: { id: item.checkId, state: "OK" },
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }));
      }
    }

    function enqueueCompact(request: Omit<CompactCheckRequest, "resolve">) {
      return new Promise<Response>((resolve) => {
        const next = [...(compactQueues.get(request.diagnosticId) || []), { ...request, resolve }];
        compactQueues.set(request.diagnosticId, next);
        const existing = compactTimers.get(request.diagnosticId);
        if (existing != null) window.clearTimeout(existing);
        compactTimers.set(request.diagnosticId, window.setTimeout(() => {
          void flushCompact(request.diagnosticId);
        }, 18));
      });
    }

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = relativeUrl(input);
      const method = requestMethod(input, init);
      const compact = parseCompactCheck(path, init);
      if (compact) return enqueueCompact(compact);

      if (isMechanicMutation(path, method)) clearReadCache();

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

      const request = originalFetch(input, init).then(async (response) => {
        const snapshot = await snapshotResponse(response);
        if (response.ok && !disposed) cache.set(path, snapshot);
        return snapshot;
      }).finally(() => {
        inflight.delete(path);
      });
      inflight.set(path, request);
      return makeResponse(await request);
    };

    const onRefresh = () => clearReadCache();
    const onVisible = () => {
      if (document.visibilityState === "visible") clearReadCache();
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
    };
  }, []);

  if (!ready) {
    return <div style={{ minHeight: "100dvh", display: "grid", placeItems: "center", background: "#0f141a", color: "#aab4bf", fontSize: 14 }}>Відкриваю кабінет механіка…</div>;
  }

  return <>{children}</>;
}
