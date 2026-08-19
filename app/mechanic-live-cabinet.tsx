"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { MechanicStandaloneCabinet } from "./mechanic-standalone-cabinet";

type AssignedVehicle = {
  id: string;
  vehicleId: string | null;
  workOrderId: string | null;
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

function time(value?: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("uk-UA", { timeZone: "Europe/Kyiv", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

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

export function MechanicLiveCabinet({ userName }: { userName?: string | null }) {
  const [items, setItems] = useState<AssignedVehicle[]>([]);
  const [revision, setRevision] = useState(0);
  const [lastKey, setLastKey] = useState("");
  const [expanded, setExpanded] = useState(true);

  const load = useCallback(async () => {
    const response = await fetch("/api/cabinet/mechanic/assigned-vehicles", { cache: "no-store", credentials: "include" });
    const payload = await response.json().catch(() => null) as AssignedVehiclesPayload | null;
    if (!response.ok || !payload?.ok) return;
    const nextItems = payload.items ?? [];
    const nextKey = nextItems.map((item) => `${item.id}:${item.workOrderStatus || item.appointmentStatus}:${item.updatedAt}`).join("|");
    setItems(nextItems);
    setLastKey((current) => {
      if (current && current !== nextKey) setRevision((value) => value + 1);
      return nextKey;
    });
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 15000);
    const onFocus = () => void load();
    const onVisibility = () => { if (document.visibilityState === "visible") void load(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
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

  return <div style={{ minHeight: "100dvh", background: "#0f141a" }}>
    <section style={{ position: "sticky", top: 0, zIndex: 2200, width: "100%", maxWidth: 560, margin: "0 auto", padding: "10px 12px 0", boxSizing: "border-box" }}>
      <div style={{ borderRadius: 18, background: "rgba(21,27,35,.98)", color: "#fff", border: "1px solid rgba(255,255,255,.10)", boxShadow: "0 12px 32px rgba(0,0,0,.28)", overflow: "hidden", backdropFilter: "blur(14px)" }}>
        <button type="button" onClick={() => setExpanded((value) => !value)} style={{ width: "100%", border: 0, background: "transparent", color: "inherit", padding: "12px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, cursor: "pointer", textAlign: "left" }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: ".08em", color: "#ff9d58" }}>ЗАКРІПЛЕНІ ЗА МНОЮ АВТО</div>
            <strong style={{ display: "block", marginTop: 3, fontSize: 16 }}>{sortedItems.length} {sortedItems.length === 1 ? "авто" : "авто"}</strong>
          </div>
          <span style={{ fontSize: 18, opacity: .8 }}>{expanded ? "⌃" : "⌄"}</span>
        </button>

        {expanded && <div style={{ maxHeight: "38dvh", overflowY: "auto", borderTop: "1px solid rgba(255,255,255,.08)" }}>
          {sortedItems.map((item) => {
            const status = effectiveStatus(item);
            return <article key={item.id} style={{ padding: "11px 14px", borderBottom: "1px solid rgba(255,255,255,.07)", display: "grid", gridTemplateColumns: "1fr auto", gap: 10 }}>
              <div style={{ minWidth: 0 }}>
                <strong style={{ display: "block", fontSize: 15, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{item.vehicle}</strong>
                <span style={{ display: "block", marginTop: 2, fontSize: 12, opacity: .78 }}>{item.plate}{item.post ? ` · ${item.post}` : ""}</span>
                {item.problem ? <span style={{ display: "block", marginTop: 5, fontSize: 12, opacity: .9, lineHeight: 1.3 }}>{item.problem}</span> : null}
              </div>
              <div style={{ textAlign: "right", minWidth: 112 }}>
                <span style={{ display: "inline-block", borderRadius: 999, padding: "4px 8px", background: status === "READY_FOR_PICKUP" ? "rgba(40,180,110,.18)" : status === "IN_REPAIR" ? "rgba(70,140,255,.20)" : "rgba(255,157,88,.16)", fontSize: 10, fontWeight: 800 }}>{statusLabels[status] || status}</span>
                <b style={{ display: "block", marginTop: 5, fontSize: 12 }}>{dateTime(item.plannedStartAt)}</b>
              </div>
            </article>;
          })}
          {!sortedItems.length && <div style={{ padding: "14px", fontSize: 13, opacity: .72 }}>Закріплених авто немає.</div>}
        </div>}
        <div style={{ padding: "8px 14px", fontSize: 10, opacity: .58 }}>Авто залишається тут до фактичної видачі клієнту. Оновлення — автоматично.</div>
      </div>
    </section>
    <MechanicStandaloneCabinet key={revision} userName={userName} />
  </div>;
}
