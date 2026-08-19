"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { MechanicStandaloneCabinet } from "./mechanic-standalone-cabinet";

type Appointment = {
  id: string;
  status: string;
  plannedStartAt: string;
  plannedEndAt: string;
  plate: string;
  vehicle: string;
  problem: string | null;
  post: string | null;
};

type HomePayload = {
  ok?: boolean;
  linked?: boolean;
  mechanic?: { name: string };
  appointments?: Appointment[];
};

function time(value?: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("uk-UA", { timeZone: "Europe/Kyiv", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

export function MechanicLiveCabinet({ userName }: { userName?: string | null }) {
  const [home, setHome] = useState<HomePayload | null>(null);
  const [revision, setRevision] = useState(0);
  const [lastAppointmentKey, setLastAppointmentKey] = useState("");

  const load = useCallback(async () => {
    const response = await fetch("/api/cabinet/home", { cache: "no-store", credentials: "include" });
    const payload = await response.json().catch(() => null) as HomePayload | null;
    if (!response.ok || !payload?.ok) return;
    const appointmentKey = (payload.appointments ?? []).map((item) => `${item.id}:${item.status}:${item.plannedStartAt}`).join("|");
    setHome(payload);
    setLastAppointmentKey((current) => {
      if (current && current !== appointmentKey) setRevision((value) => value + 1);
      return appointmentKey;
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

  const nextAppointment = useMemo(() => {
    const now = Date.now();
    return [...(home?.appointments ?? [])]
      .filter((item) => !["CANCELLED", "RESERVE"].includes(item.status))
      .sort((a, b) => new Date(a.plannedStartAt).getTime() - new Date(b.plannedStartAt).getTime())
      .find((item) => new Date(item.plannedEndAt).getTime() >= now) ?? null;
  }, [home?.appointments]);

  return <>
    {nextAppointment ? <aside style={{ position: "fixed", zIndex: 2200, left: "max(12px, env(safe-area-inset-left))", right: "max(12px, env(safe-area-inset-right))", top: "max(10px, env(safe-area-inset-top))", maxWidth: 520, margin: "0 auto", borderRadius: 16, padding: "12px 14px", background: "rgba(19,24,31,.96)", color: "#fff", boxShadow: "0 12px 34px rgba(0,0,0,.28)", border: "1px solid rgba(255,255,255,.12)", backdropFilter: "blur(12px)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: ".08em", color: "#ff9d58" }}>НОВЕ ПРИЗНАЧЕННЯ</div>
          <strong style={{ display: "block", marginTop: 3, fontSize: 15, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{nextAppointment.vehicle}</strong>
          <span style={{ display: "block", marginTop: 2, fontSize: 12, opacity: .8 }}>{nextAppointment.plate || "Без номера"}{nextAppointment.post ? ` · ${nextAppointment.post}` : ""}</span>
          {nextAppointment.problem ? <span style={{ display: "block", marginTop: 5, fontSize: 12, opacity: .92 }}>{nextAppointment.problem}</span> : null}
        </div>
        <div style={{ textAlign: "right", flex: "0 0 auto" }}>
          <b style={{ display: "block", fontSize: 16 }}>{time(nextAppointment.plannedStartAt)}</b>
          <span style={{ display: "block", fontSize: 10, opacity: .7, marginTop: 2 }}>Заплановано</span>
        </div>
      </div>
    </aside> : null}
    <MechanicStandaloneCabinet key={revision} userName={userName} />
  </>;
}
