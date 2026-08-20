"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

type Appointment = {
  id: string;
  workOrderId: string | null;
  status: string;
  workOrderStatus: string | null;
  plannedStartAt: string;
  plannedEndAt: string;
  plate: string;
  vehicle: string;
  problem: string | null;
  post: string | null;
};

type DiagnosticItem = {
  id: string;
  workflowState: string;
  plannedStartAt: string;
  vehicle: { plateNumber: string | null };
};

type HomePayload = {
  ok?: boolean;
  appointments?: Appointment[];
};

type DiagnosticsPayload = {
  ok?: boolean;
  items?: DiagnosticItem[];
};

const TERMINAL_APPOINTMENTS = new Set(["COMPLETED", "DONE", "CANCELLED", "NO_SHOW", "READY_FOR_PICKUP", "CLOSED", "DELIVERED"]);
const REPAIR_FLOW = new Set(["WAITING_PARTS_SELECTION", "WAITING_CALCULATION", "PARTS_REVIEW", "WAITING_APPROVAL", "WAITING_PARTS", "READY_FOR_REPAIR", "IN_REPAIR", "REWORK", "WAITING_QC", "READY_FOR_PICKUP", "WAITING_PAYMENT"]);

function normalizedPlate(value?: string | null) {
  const chars: Record<string, string> = { А: "A", В: "B", Е: "E", І: "I", К: "K", М: "M", Н: "H", О: "O", Р: "P", С: "C", Т: "T", Х: "X", У: "Y" };
  const source = (value || "").normalize("NFKC").toUpperCase().replace(/[^A-ZА-ЯІЇЄ0-9]/g, "");
  return [...source].map((char) => chars[char] || char).join("");
}

function appointmentKey(item: Appointment) {
  return `${normalizedPlate(item.plate)}:${new Date(item.plannedStartAt).getTime()}`;
}

function diagnosticKey(item: DiagnosticItem) {
  return `${normalizedPlate(item.vehicle.plateNumber)}:${new Date(item.plannedStartAt).getTime()}`;
}

function dateTime(value: string) {
  return new Intl.DateTimeFormat("uk-UA", {
    timeZone: "Europe/Kyiv",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function findDiagnosticsMain() {
  const title = Array.from(document.querySelectorAll("h1")).find((node) => node.textContent?.trim() === "Мої діагностики");
  return title?.closest("main") as HTMLElement | null;
}

function ensureHost(main: HTMLElement) {
  let host = main.querySelector<HTMLElement>("[data-mechanic-diagnostic-arrival-host]");
  if (host) return host;
  const title = Array.from(main.querySelectorAll("h1")).find((node) => node.textContent?.trim() === "Мої діагностики");
  const titleBlock = title?.parentElement;
  host = document.createElement("div");
  host.dataset.mechanicDiagnosticArrivalHost = "true";
  if (titleBlock?.parentElement === main) titleBlock.insertAdjacentElement("afterend", host);
  else main.prepend(host);
  return host;
}

function openScanner() {
  const scan = document.querySelector<HTMLButtonElement>('button[aria-label="Сканувати номер автомобіля"]');
  if (scan) scan.click();
  else window.dispatchEvent(new CustomEvent("turbolev:mechanic-open-scanner"));
}

export function MechanicDiagnosticsArrivalBridge() {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [diagnostics, setDiagnostics] = useState<DiagnosticItem[]>([]);
  const [target, setTarget] = useState<HTMLElement | null>(null);

  const load = useCallback(async () => {
    const [homeResponse, diagnosticsResponse] = await Promise.all([
      fetch("/api/cabinet/home", { cache: "no-store", credentials: "include" }),
      fetch("/api/diagnostics/me", { cache: "no-store", credentials: "include" }),
    ]);
    const [home, diagnosticFeed] = await Promise.all([
      homeResponse.json().catch(() => null) as Promise<HomePayload | null>,
      diagnosticsResponse.json().catch(() => null) as Promise<DiagnosticsPayload | null>,
    ]);
    if (homeResponse.ok && home?.ok) setAppointments(home.appointments ?? []);
    if (diagnosticsResponse.ok && diagnosticFeed?.ok) setDiagnostics(diagnosticFeed.items ?? []);
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 15000);
    const refresh = () => void load();
    window.addEventListener("focus", refresh);
    window.addEventListener("turbolev:mechanic-refresh", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("turbolev:mechanic-refresh", refresh);
    };
  }, [load]);

  useEffect(() => {
    const sync = () => {
      const main = findDiagnosticsMain();
      setTarget((current) => {
        const next = main ? ensureHost(main) : null;
        return current === next ? current : next;
      });
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  const pending = useMemo(() => {
    const diagnosticKeys = new Set(diagnostics.map(diagnosticKey));
    return appointments
      .filter((item) => {
        const status = item.workOrderStatus || item.status;
        if (TERMINAL_APPOINTMENTS.has(status) || REPAIR_FLOW.has(status)) return false;
        return !diagnosticKeys.has(appointmentKey(item));
      })
      .sort((a, b) => new Date(a.plannedStartAt).getTime() - new Date(b.plannedStartAt).getTime());
  }, [appointments, diagnostics]);

  useEffect(() => {
    if (!target) return;
    const main = target.closest("main");
    if (!main) return;
    const nativeEmpty = Array.from(main.querySelectorAll<HTMLElement>("div")).find((node) => {
      const text = node.textContent?.trim() || "";
      return text === "Діагностика з’явиться після відмітки «Приїхав»." || text === "Призначених діагностик немає.";
    });
    if (nativeEmpty && pending.length) nativeEmpty.style.display = "none";
    return () => { if (nativeEmpty) nativeEmpty.style.display = ""; };
  }, [pending.length, target]);

  if (!target || !pending.length) return null;

  return createPortal(
    <section style={{ margin: "18px 0 20px", display: "grid", gap: 12 }} aria-label="Автомобілі, що очікують підтвердження">
      <div style={{ display: "flex", alignItems: "end", justifyContent: "space-between", gap: 12 }}>
        <div>
          <h2 style={{ margin: 0, color: "var(--m-text,#f4f7fb)", fontSize: 20 }}>Очікують підтвердження</h2>
          <p style={{ margin: "5px 0 0", color: "var(--m-muted,#93a0ae)", fontSize: 13, lineHeight: 1.4 }}>Сканування номера підтвердить прибуття авто та автоматично створить діагностику.</p>
        </div>
        <span style={{ minWidth: 34, height: 34, borderRadius: 999, display: "grid", placeItems: "center", background: "rgba(255,101,0,.16)", color: "#ff6500", fontWeight: 900 }}>{pending.length}</span>
      </div>

      {pending.map((item) => <article key={item.id} style={{ border: "1px solid var(--m-border,#2b3540)", borderRadius: 20, padding: 16, background: "var(--m-card,#151b23)", boxShadow: "0 8px 28px rgba(0,0,0,.12)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", gap: 12 }}>
          <div style={{ minWidth: 0 }}>
            <strong style={{ display: "block", color: "var(--m-text,#f4f7fb)", fontSize: 18, lineHeight: 1.25 }}>{item.vehicle}</strong>
            <b style={{ display: "block", marginTop: 3, color: "#ff8a3d", fontSize: 14 }}>{item.plate || "Без номера"}</b>
          </div>
          <span style={{ borderRadius: 999, padding: "5px 9px", background: item.status === "ARRIVED" ? "rgba(45,190,115,.14)" : "rgba(255,157,88,.14)", color: item.status === "ARRIVED" ? "#53d38d" : "#ff9d58", fontSize: 11, fontWeight: 800, whiteSpace: "nowrap" }}>{item.status === "ARRIVED" ? "На СТО" : "Очікує авто"}</span>
        </div>
        <p style={{ margin: "10px 0 0", color: "var(--m-text,#f4f7fb)", opacity: .9, fontSize: 14, lineHeight: 1.4 }}>{item.problem || "Діагностика автомобіля"}</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 10, color: "var(--m-muted,#93a0ae)", fontSize: 12 }}>
          <span>Час <b style={{ color: "var(--m-text,#f4f7fb)" }}>{dateTime(item.plannedStartAt)}</b></span>
          <span>Пост <b style={{ color: "var(--m-text,#f4f7fb)" }}>{item.post || "—"}</b></span>
        </div>
        <button type="button" onClick={openScanner} style={{ width: "100%", minHeight: 52, marginTop: 14, border: 0, borderRadius: 15, background: "#ff6500", color: "#fff", fontSize: 15, fontWeight: 900, cursor: "pointer", touchAction: "manipulation" }}>▣ Сканувати та підтвердити авто</button>
      </article>)}
    </section>,
    target,
  );
}
