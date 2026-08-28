"use client";

import dynamic from "next/dynamic";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { MechanicStandaloneCabinet } from "./mechanic-standalone-cabinet";

const MechanicVehicleScanner = dynamic(
  () => import("./mechanic-vehicle-scanner").then((module) => module.MechanicVehicleScanner),
  { ssr: false },
);
const MechanicDiagnosticsArrivalBridge = dynamic(
  () => import("./mechanic-diagnostics-arrival-bridge").then((module) => module.MechanicDiagnosticsArrivalBridge),
  { ssr: false },
);

type AssignedVehicle = {
  id: string;
  vehicleId: string | null;
  workOrderId: string | null;
  diagnosticId: string | null;
  appointmentStatus: string;
  workOrderStatus: string | null;
  vehicle: string;
  plate: string;
  problem: string | null;
  plannedStartAt: string;
  plannedEndAt: string;
  post: string | null;
  updatedAt: string;
};

type AssignedVehiclesPayload = {
  ok?: boolean;
  linked?: boolean;
  items?: AssignedVehicle[];
};

type RowSwipe = {
  startX: number;
  offset: number;
};

const DISMISSED_ITEMS_KEY = "turbolev:mechanic-dismissed-assigned-items:v2";
const LEGACY_DISMISSED_FEED_KEY = "turbolev:mechanic-dismissed-assigned-feed";
const MAX_DISMISSED_ITEMS = 500;
const SWIPE_DISMISS_THRESHOLD = -64;
const SWIPE_MAX_OFFSET = -96;
const BACKGROUND_REFRESH_MS = 60_000;

const statusLabels: Record<string, string> = {
  BOOKED: "Заплановано",
  ARRIVED: "Авто на СТО",
  DIAGNOSTICS: "Діагностика",
  WAITING_PARTS_SELECTION: "Підбір деталей",
  WAITING_CALCULATION: "Розрахунок",
  PARTS_REVIEW: "Роботи і деталі",
  WAITING_APPROVAL: "Очікує погодження",
  WAITING_PARTS: "Очікує запчастини",
  READY_FOR_REPAIR: "Готово до ремонту",
  IN_REPAIR: "У ремонті",
  PAUSED: "Пауза",
  REWORK: "Доопрацювання",
  WAITING_QC: "Контроль якості",
  READY_FOR_PICKUP: "Готово до видачі",
  WAITING_PAYMENT: "Очікує оплату",
  WARRANTY: "Гарантійне звернення",
};

function dateTime(value?: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("uk-UA", {
    timeZone: "Europe/Kyiv",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function effectiveStatus(item: AssignedVehicle) {
  return item.workOrderStatus || item.appointmentStatus;
}

function readDismissedIds() {
  try {
    const stored = window.localStorage.getItem(DISMISSED_ITEMS_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) return parsed.filter((value): value is string => typeof value === "string");
    }

    const legacy = window.localStorage.getItem(LEGACY_DISMISSED_FEED_KEY) || "";
    if (!legacy) return [];
    return legacy
      .split("|")
      .map((part) => part.split(":")[0]?.trim())
      .filter((value): value is string => Boolean(value));
  } catch {
    return [];
  }
}

const AssignedVehicleRow = memo(function AssignedVehicleRow({
  item,
  onDismiss,
  onOpenDiagnostic,
}: {
  item: AssignedVehicle;
  onDismiss: (id: string) => void;
  onOpenDiagnostic: (diagnosticId: string) => void;
}) {
  const [swipe, setSwipe] = useState<RowSwipe | null>(null);
  const status = effectiveStatus(item);
  const swipeOffset = swipe?.offset ?? 0;
  const deleteVisible = swipeOffset < -12;
  const paymentPending = status === "WAITING_PAYMENT" && Boolean(item.diagnosticId);

  function startSwipe(clientX: number) {
    setSwipe({ startX: clientX, offset: 0 });
  }

  function moveSwipe(clientX: number) {
    setSwipe((current) => {
      if (!current) return current;
      const offset = Math.max(SWIPE_MAX_OFFSET, Math.min(0, clientX - current.startX));
      if (offset === current.offset) return current;
      return { ...current, offset };
    });
  }

  function finishSwipe() {
    if (swipe && swipe.offset <= SWIPE_DISMISS_THRESHOLD && !paymentPending) {
      onDismiss(item.id);
      return;
    }
    setSwipe(null);
  }

  return <div style={{ position: "relative", overflow: "hidden", background: "rgba(205,57,72,.20)" }}>
    <div aria-hidden="true" style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "flex-end", paddingRight: 18, color: "#ff8d98", fontSize: 12, fontWeight: 800, opacity: deleteVisible && !paymentPending ? 1 : 0, transition: "opacity .12s ease" }}>Видалити</div>
    <article
      onPointerDown={(event) => startSwipe(event.clientX)}
      onPointerMove={(event) => moveSwipe(event.clientX)}
      onPointerUp={finishSwipe}
      onPointerCancel={() => setSwipe(null)}
      style={{
        padding: "11px 14px",
        borderBottom: "1px solid rgba(255,255,255,.07)",
        display: "grid",
        gridTemplateColumns: "1fr auto",
        gap: 10,
        background: paymentPending ? "linear-gradient(90deg,rgba(255,101,0,.17),rgba(21,27,35,.99) 58%)" : "rgba(21,27,35,.99)",
        transform: `translateX(${swipeOffset}px)`,
        transition: swipe ? "none" : "transform .18s ease",
        touchAction: "pan-y",
        userSelect: "none",
      }}
    >
      <div style={{ minWidth: 0 }}>
        <strong style={{ display: "block", fontSize: 15, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{item.vehicle}</strong>
        <span style={{ display: "block", marginTop: 2, fontSize: 12, opacity: .78 }}>{item.plate}{item.post ? ` · ${item.post}` : ""}</span>
        {item.problem ? <span style={{ display: "block", marginTop: 5, fontSize: 12, opacity: .9, lineHeight: 1.3 }}>{item.problem}</span> : null}
      </div>
      <div style={{ textAlign: "right", minWidth: 112 }}>
        <span style={{ display: "inline-block", borderRadius: 999, padding: "4px 8px", background: status === "READY_FOR_PICKUP" ? "rgba(40,180,110,.18)" : status === "IN_REPAIR" ? "rgba(70,140,255,.20)" : "rgba(255,157,88,.16)", fontSize: 12, fontWeight: 800 }}>{statusLabels[status] || status}</span>
        <b style={{ display: "block", marginTop: 5, fontSize: 12 }}>{dateTime(item.plannedStartAt)}</b>
        {paymentPending ? <button
          type="button"
          onPointerDown={(event) => event.stopPropagation()}
          onPointerUp={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            if (item.diagnosticId) onOpenDiagnostic(item.diagnosticId);
          }}
          style={{ marginTop: 8, minHeight: 38, border: 0, borderRadius: 11, padding: "8px 12px", background: "#ff6500", color: "#fff", fontSize: 12, fontWeight: 900, cursor: "pointer", touchAction: "manipulation" }}
        >Оплатити</button> : null}
      </div>
    </article>
  </div>;
});

export function MechanicLiveCabinet({ userName }: { userName?: string | null }) {
  const [items, setItems] = useState<AssignedVehicle[]>([]);
  const [lastKey, setLastKey] = useState("");
  const [expanded, setExpanded] = useState(true);
  const [dismissedIds, setDismissedIds] = useState<string[]>([]);
  const [storageReady, setStorageReady] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch("/api/cabinet/mechanic/assigned-vehicles", { cache: "no-store", credentials: "include" });
    const payload = await response.json().catch(() => null) as AssignedVehiclesPayload | null;
    if (!response.ok || !payload?.ok) return;
    const nextItems = payload.items ?? [];
    const nextKey = nextItems
      .map((item) => `${item.id}:${effectiveStatus(item)}:${item.diagnosticId || ""}`)
      .sort()
      .join("|");
    setItems((current) => current === nextItems ? current : nextItems);
    setLastKey((current) => current === nextKey ? current : nextKey);
  }, []);

  useEffect(() => {
    const restored = readDismissedIds();
    setDismissedIds(restored);
    setStorageReady(true);
    if (restored.length) {
      try {
        window.localStorage.setItem(DISMISSED_ITEMS_KEY, JSON.stringify(restored.slice(-MAX_DISMISSED_ITEMS)));
      } catch {
        // Dismissal still works for the current session if storage is unavailable.
      }
    }

    void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, BACKGROUND_REFRESH_MS);
    const onFocus = () => { if (document.visibilityState === "visible") void load(); };
    const onVisibility = () => { if (document.visibilityState === "visible") void load(); };
    const onMechanicRefresh = () => void load();
    window.addEventListener("focus", onFocus);
    window.addEventListener("turbolev:mechanic-refresh", onMechanicRefresh);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("turbolev:mechanic-refresh", onMechanicRefresh);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [load]);

  const sortedItems = useMemo(() => [...items].sort((a, b) => {
    const rank = (item: AssignedVehicle) => {
      const status = effectiveStatus(item);
      if (status === "IN_REPAIR") return 10;
      if (status === "REWORK") return 20;
      if (["WAITING_PARTS", "WAITING_APPROVAL", "WAITING_QC", "WAITING_PAYMENT"].includes(status)) return 30;
      if (status === "ARRIVED") return 40;
      if (status === "READY_FOR_PICKUP") return 80;
      return 60;
    };
    return rank(a) - rank(b) || new Date(a.plannedStartAt).getTime() - new Date(b.plannedStartAt).getTime();
  }), [items]);

  const dismissedSet = useMemo(() => new Set(dismissedIds), [dismissedIds]);
  const visibleItems = useMemo(
    () => sortedItems.filter((item) => effectiveStatus(item) === "WAITING_PAYMENT" || !dismissedSet.has(item.id)),
    [sortedItems, dismissedSet],
  );

  const persistDismissed = useCallback((ids: string[]) => {
    const unique = Array.from(new Set(ids)).slice(-MAX_DISMISSED_ITEMS);
    setDismissedIds(unique);
    try {
      window.localStorage.setItem(DISMISSED_ITEMS_KEY, JSON.stringify(unique));
    } catch {
      // Keep the in-memory dismissal when persistent storage is unavailable.
    }
  }, []);

  const dismissItem = useCallback((id: string) => {
    setDismissedIds((current) => {
      const unique = Array.from(new Set([...current, id])).slice(-MAX_DISMISSED_ITEMS);
      try {
        window.localStorage.setItem(DISMISSED_ITEMS_KEY, JSON.stringify(unique));
      } catch {
        // Keep the in-memory dismissal when persistent storage is unavailable.
      }
      return unique;
    });
  }, []);

  const openPendingDiagnostic = useCallback((diagnosticId: string) => {
    setExpanded(false);
    window.dispatchEvent(new CustomEvent("turbolev:mechanic-open-diagnostic", { detail: { diagnosticId } }));
  }, []);

  function dismissFeed() {
    if (!visibleItems.length) return;
    const dismissible = visibleItems.filter((item) => effectiveStatus(item) !== "WAITING_PAYMENT");
    if (!dismissible.length) return;
    persistDismissed([...dismissedIds, ...dismissible.map((item) => item.id)]);
  }

  const showFeed = Boolean(storageReady && lastKey && visibleItems.length);

  return <div style={{ minHeight: "100dvh", background: "#0f141a" }}>
    {showFeed && <section style={{ position: "sticky", top: 0, zIndex: 2200, width: "100%", maxWidth: 560, margin: "0 auto", padding: "10px 12px 0", boxSizing: "border-box" }}>
      <div style={{ borderRadius: 18, background: "rgba(21,27,35,.99)", color: "#fff", border: "1px solid rgba(255,255,255,.10)", boxShadow: "0 12px 32px rgba(0,0,0,.28)", overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "stretch" }}>
          <button type="button" onClick={() => setExpanded((value) => !value)} style={{ flex: 1, minWidth: 0, border: 0, background: "transparent", color: "inherit", padding: "12px 8px 12px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, cursor: "pointer", textAlign: "left" }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 900, letterSpacing: ".08em", color: "#ff9d58" }}>ЗАКРІПЛЕНІ ЗА МНОЮ АВТО</div>
              <strong style={{ display: "block", marginTop: 3, fontSize: 16 }}>{visibleItems.length} авто</strong>
            </div>
            <span style={{ fontSize: 18, opacity: .8 }}>{expanded ? "⌃" : "⌄"}</span>
          </button>
          <button type="button" aria-label="Закрити всі сповіщення" onClick={dismissFeed} style={{ width: 46, border: 0, borderLeft: "1px solid rgba(255,255,255,.08)", background: "transparent", color: "#fff", fontSize: 24, lineHeight: 1, cursor: "pointer", touchAction: "manipulation" }}>×</button>
        </div>

        {expanded && <div style={{ maxHeight: "38dvh", overflowY: "auto", borderTop: "1px solid rgba(255,255,255,.08)", overscrollBehavior: "contain" }}>
          {visibleItems.map((item) => <AssignedVehicleRow key={item.id} item={item} onDismiss={dismissItem} onOpenDiagnostic={openPendingDiagnostic} />)}
        </div>}
        <div style={{ padding: "8px 14px", fontSize: 12, opacity: .62, lineHeight: 1.35 }}>Очікувана оплата залишається видимою до завершення. Інші сповіщення можна прибрати свайпом вліво.</div>
      </div>
    </section>}
    <MechanicStandaloneCabinet userName={userName} />
    <MechanicVehicleScanner />
    <MechanicDiagnosticsArrivalBridge />
  </div>;
}
