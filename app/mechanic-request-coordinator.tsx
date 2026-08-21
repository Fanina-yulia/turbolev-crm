"use client";

import { type ReactNode, useEffect } from "react";

type CachedResponse = {
  status: number;
  statusText: string;
  headers: Array<[string, string]>;
  body: string;
  savedAt: number;
};

type CompactCheckRequest = {
  diagnosticId: string;
  checkId: string;
  body: Record<string, unknown>;
  resolve: (response: Response) => void;
};

const GET_TTLS: Array<[RegExp, number]> = [
  [/^\/api\/cabinet\/home(?:\?|$)/, 55_000],
  [/^\/api\/diagnostics\/me(?:\?|$)/, 55_000],
  [/^\/api\/cabinet\/mechanic\/assigned-vehicles(?:\?|$)/, 55_000],
  [/^\/api\/cabinet\/mechanic\/tasks(?:\?|$)/, 25_000],
  [/^\/api\/cabinet\/mechanic\/notifications(?:\?|$)/, 30_000],
  [/^\/api\/cabinet\/mechanic\/findings(?:\?|$)/, 30_000],
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

function requestMethod(input: RequestInfo | URL, init?: RequestInit) {
  return String(init?.method || (input instanceof Request ? input.method : "GET") || "GET").toUpperCase();
}

function ttlFor(path: string) {
  return GET_TTLS.find(([pattern]) => pattern.test(path))?.[1] ?? 0;
}

function makeResponse(snapshot: CachedResponse) {
  return new Response(snapshot.body, {
    status: snapshot.status,
    statusText: snapshot.statusText,
    headers: snapshot.headers,
  });
}

async function snapshotResponse(response: Response): Promise<CachedResponse> {
  const clone = response.clone();
  return {
    status: clone.status,
    statusText: clone.statusText,
    headers: Array.from(clone.headers.entries()),
    body: await clone.text(),
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
 * Several legacy mechanic widgets still refresh the same resources independently.
 * This coordinator deduplicates concurrent GETs, applies short per-resource TTLs,
 * and coalesces the tap-first matrix's compact OK writes into one batch request.
 * It is intentionally mounted only for the MECHANIC role.
 */
export function MechanicRequestCoordinator({ children }: { children: ReactNode }) {
  useEffect(() => {
    const originalFetch = window.fetch.bind(window);
    const cache = new Map<string, CachedResponse>();
    const inflight = new Map<string, Promise<CachedResponse>>();
    const compactQueues = new Map<string, CompactCheckRequest[]>();
    const compactTimers = new Map<string, number>();
    let disposed = false;

    const clearReadCache = () => {
      cache.clear();
      inflight.clear();
    };

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

  return <>{children}</>;
}
