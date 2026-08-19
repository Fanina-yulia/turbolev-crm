"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type LiveCall = {
  id: string;
  callId: string;
  phone: string;
  internalNumber?: string | null;
  phase: "RINGING" | "ANSWERED" | "MISSED" | "BUSY" | "COMPLETED";
  status?: string | null;
  startedAt?: string | null;
  answeredAt?: string | null;
  endedAt?: string | null;
  duration: number;
  recordingAvailable: boolean;
  client?: { id: string; name?: string | null } | null;
  lead?: { id: string; name?: string | null } | null;
  vehicle?: { id?: string | null; brand?: string | null; model?: string | null; plateNumber?: string | null; vin?: string | null } | null;
  workOrder?: { id: string; status: string } | null;
  manager?: { id: string; name: string } | null;
};

type LivePayload = {
  ok: boolean;
  currentUser?: { id: string; name: string; internalNumber?: string | null; clickToCallReady: boolean };
  calls?: LiveCall[];
};

type Employee = {
  providerId?: string | null;
  internalNumber: string;
  name?: string | null;
  email?: string | null;
  crmUser?: { id: string; name: string; email?: string | null; internalNumber?: string | null; match: string } | null;
};

type TransferTarget = {
  internalNumber: string;
  name?: string | null;
  email?: string | null;
};

function phoneLabel(value: string) {
  const digits = value.replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("380")) {
    return `+${digits.slice(0, 3)} ${digits.slice(3, 5)} ${digits.slice(5, 8)} ${digits.slice(8, 10)} ${digits.slice(10)}`;
  }
  return value;
}

function phaseLabel(phase: LiveCall["phase"]) {
  if (phase === "RINGING") return "Вхідний дзвінок";
  if (phase === "ANSWERED") return "Розмова триває";
  if (phase === "MISSED") return "Пропущений дзвінок";
  if (phase === "BUSY") return "Лінія зайнята";
  return "Дзвінок завершено";
}

function isMechanicCabinet() {
  return Boolean(document.querySelector('[data-mechanic-cabinet="true"]'));
}

export function TelephonyRealtimeBridge() {
  const [enabled, setEnabled] = useState(false);
  const [payload, setPayload] = useState<LivePayload | null>(null);
  const [active, setActive] = useState<LiveCall | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [dockOpen, setDockOpen] = useState(false);
  const [phone, setPhone] = useState("");
  const [calling, setCalling] = useState(false);
  const [controlling, setControlling] = useState(false);
  const [message, setMessage] = useState("");
  const [employees, setEmployees] = useState<Employee[] | null>(null);
  const [employeesLoading, setEmployeesLoading] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferTargets, setTransferTargets] = useState<TransferTarget[] | null>(null);
  const [transferLoading, setTransferLoading] = useState(false);
  const seenRef = useRef(new Set<string>());

  const loadLive = useCallback(async () => {
    if (isMechanicCabinet()) {
      setEnabled(false);
      setPayload(null);
      setActive(null);
      return;
    }
    if (document.visibilityState !== "visible") return;
    try {
      const response = await fetch("/api/telephony/live", { cache: "no-store" });
      if (response.status === 401 || response.status === 403) {
        setEnabled(false);
        return;
      }
      if (!response.ok) return;
      const data = await response.json() as LivePayload;
      if (!data.ok) return;
      setEnabled(true);
      setPayload(data);
      const incoming = (data.calls || []).find((call) => !dismissed.has(call.callId));
      if (incoming) {
        setActive(incoming);
        seenRef.current.add(incoming.callId);
      }
    } catch {
      // Telephony polling must never disturb the rest of CRM.
    }
  }, [dismissed]);

  useEffect(() => {
    if (isMechanicCabinet()) return;
    void loadLive();
    const timer = window.setInterval(() => void loadLive(), 2_500);
    const onVisibility = () => { if (document.visibilityState === "visible") void loadLive(); };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [loadLive]);

  useEffect(() => {
    if (isMechanicCabinet()) return;
    const reconcile = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        await fetch("/api/communications/binotel-history", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lookbackMinutes: 90 }),
          cache: "no-store",
        });
      } catch {
        // Webhooks remain primary; REST reconciliation is best-effort recovery.
      }
    };
    void reconcile();
    const timer = window.setInterval(() => void reconcile(), 30 * 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const startCall = useCallback(async (target: string) => {
    const normalized = target.trim();
    if (!normalized) return;
    setCalling(true);
    setMessage("");
    try {
      const response = await fetch("/api/telephony/call", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: normalized }),
      });
      const data = await response.json() as { ok?: boolean; message?: string; error?: string };
      if (!response.ok || !data.ok) {
        if (data.error === "INTERNAL_NUMBER_REQUIRED") setDockOpen(true);
        throw new Error(data.message || data.error || "Не вдалося розпочати дзвінок");
      }
      setMessage("Binotel прийняв команду. З'єднання починається.");
      setDockOpen(false);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Помилка телефонії");
    } finally {
      setCalling(false);
    }
  }, []);

  const controlCall = useCallback(async (action: "hangup" | "transfer", callId: string, targetInternalNumber?: string) => {
    setControlling(true);
    setMessage("");
    try {
      const response = await fetch("/api/telephony/call", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, callId, targetInternalNumber }),
      });
      const data = await response.json() as { ok?: boolean; error?: string; targetName?: string | null };
      if (!response.ok || !data.ok) throw new Error(data.error || "Не вдалося виконати команду");
      setMessage(action === "hangup" ? "Команду завершення дзвінка передано Binotel" : `Дзвінок переводиться${data.targetName ? ` → ${data.targetName}` : ""}`);
      setTransferOpen(false);
      window.setTimeout(() => void loadLive(), 600);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Помилка керування дзвінком");
    } finally {
      setControlling(false);
    }
  }, [loadLive]);

  const loadTransferTargets = useCallback(async () => {
    if (transferTargets !== null || transferLoading) return;
    setTransferLoading(true);
    try {
      const response = await fetch("/api/communications/binotel-transfer-targets", { cache: "no-store" });
      const data = response.ok ? await response.json() as { targets?: TransferTarget[] } : null;
      setTransferTargets(Array.isArray(data?.targets) ? data.targets : []);
    } catch {
      setTransferTargets([]);
    } finally {
      setTransferLoading(false);
    }
  }, [transferTargets, transferLoading]);

  useEffect(() => {
    if (transferOpen) void loadTransferTargets();
  }, [transferOpen, loadTransferTargets]);

  useEffect(() => {
    if (isMechanicCabinet()) return;
    const onCall = (event: Event) => {
      const detail = (event as CustomEvent<string | { phone?: string }>).detail;
      const value = typeof detail === "string" ? detail : detail?.phone || "";
      if (value) void startCall(value);
    };
    const onDocumentClick = (event: MouseEvent) => {
      const element = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href^="tel:"]') : null;
      if (!element) return;
      const value = element.getAttribute("href")?.replace(/^tel:/i, "") || "";
      if (!value) return;
      event.preventDefault();
      void startCall(value);
    };
    window.addEventListener("turbolev:call", onCall as EventListener);
    document.addEventListener("click", onDocumentClick, true);
    return () => {
      window.removeEventListener("turbolev:call", onCall as EventListener);
      document.removeEventListener("click", onDocumentClick, true);
    };
  }, [startCall]);

  useEffect(() => {
    if (!dockOpen || payload?.currentUser?.internalNumber || employees !== null || employeesLoading) return;
    setEmployeesLoading(true);
    fetch("/api/telephony/binotel-employees", { cache: "no-store" })
      .then(async (response) => response.ok ? response.json() : null)
      .then((data) => setEmployees(Array.isArray(data?.employees) ? data.employees : []))
      .catch(() => setEmployees([]))
      .finally(() => setEmployeesLoading(false));
  }, [dockOpen, payload?.currentUser?.internalNumber, employees, employeesLoading]);

  async function linkSelf(internalNumber: string) {
    setMessage("");
    try {
      const response = await fetch("/api/telephony/binotel-employees/link-self", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ internalNumber }),
      });
      const data = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || !data.ok) throw new Error(data.error || "Не вдалося прив'язати номер");
      setEmployees(null);
      setMessage(`Внутрішній номер ${internalNumber} прив'язано`);
      await loadLive();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Помилка прив'язки");
    }
  }

  function dismiss(callId: string) {
    setDismissed((current) => new Set([...current, callId]));
    setActive(null);
    setTransferOpen(false);
  }

  const vehicleText = useMemo(() => {
    if (!active?.vehicle) return "";
    return [active.vehicle.brand, active.vehicle.model, active.vehicle.plateNumber].filter(Boolean).join(" · ");
  }, [active]);

  const filteredTransferTargets = useMemo(() => {
    const own = payload?.currentUser?.internalNumber;
    return (transferTargets || []).filter((target) => target.internalNumber !== own);
  }, [transferTargets, payload?.currentUser?.internalNumber]);

  if (!enabled && !payload) return null;

  return <>
    {active ? <aside className={`tlCallPopup tl-${active.phase.toLowerCase()}`} aria-live="assertive">
      <div className="tlCallTop"><span className="tlPulse">☎</span><div><small>BINOTEL · {phaseLabel(active.phase)}</small><strong>{active.client?.name || active.lead?.name || "Невідомий номер"}</strong></div><button onClick={() => dismiss(active.callId)} aria-label="Закрити">×</button></div>
      <div className="tlPhone">{phoneLabel(active.phone)}</div>
      {vehicleText ? <div className="tlContext">🚗 {vehicleText}</div> : null}
      {active.workOrder ? <div className="tlContext">Наряд: {active.workOrder.id} · {active.workOrder.status}</div> : null}
      <div className="tlCallActions">
        {active.phase === "ANSWERED" ? <button className="primary" disabled={controlling} onClick={() => setTransferOpen((value) => !value)}>⇄ Перевести</button> : null}
        {active.phase === "RINGING" || active.phase === "ANSWERED" ? <button className="danger" disabled={controlling} onClick={() => void controlCall("hangup", active.callId)}>■ Завершити</button> : null}
        {active.phase !== "RINGING" && active.phase !== "ANSWERED" ? <button className="primary" disabled={calling} onClick={() => void startCall(active.phone)}>↗ Передзвонити</button> : null}
        <button onClick={() => { setPhone(active.phone); setDockOpen(true); }}>Телефонія</button>
      </div>
      {transferOpen ? <div className="tlTransferBox">
        <small>Перевести дзвінок на співробітника</small>
        {transferLoading ? <span>Отримую внутрішні номери…</span> : filteredTransferTargets.length ? <div className="tlTransferList">{filteredTransferTargets.map((target) => <button key={target.internalNumber} disabled={controlling} onClick={() => void controlCall("transfer", active.callId, target.internalNumber)}><b>{target.internalNumber}</b><span>{target.name || target.email || "Співробітник"}</span></button>)}</div> : <span>Немає доступних внутрішніх номерів для переведення.</span>}
      </div> : null}
      {message ? <div className="tlMessage">{message}</div> : null}
    </aside> : null}

    <div className="tlDock">
      {dockOpen ? <div className="tlDockPanel">
        <div className="tlDockHead"><div><strong>Телефонія</strong><small>{payload?.currentUser?.internalNumber ? `Внутрішній ${payload.currentUser.internalNumber}` : "Потрібна прив'язка внутрішнього номера"}</small></div><button onClick={() => setDockOpen(false)}>×</button></div>
        {payload?.currentUser?.internalNumber ? <div className="tlDial"><input value={phone} onChange={(event) => setPhone(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void startCall(phone); }} placeholder="+380…"/><button disabled={calling || !phone.trim()} onClick={() => void startCall(phone)}>{calling ? "…" : "Подзвонити"}</button></div> : <div className="tlLinkBox">
          <p>Оберіть ваш внутрішній номер із Binotel. CRM перевіряє його через API перед прив'язкою.</p>
          {employeesLoading ? <span>Отримую список Binotel…</span> : employees?.length ? <div className="tlEmployeeList">{employees.map((employee) => <button key={employee.internalNumber} onClick={() => void linkSelf(employee.internalNumber)}><b>{employee.internalNumber}</b><span>{employee.name || employee.email || "Співробітник Binotel"}</span>{employee.crmUser?.match === "EMAIL" ? <em>збіг e-mail</em> : null}</button>)}</div> : <span>Список внутрішніх номерів недоступний для цього користувача або Binotel не повернув їх.</span>}
        </div>}
        {message ? <div className="tlMessage">{message}</div> : null}
      </div> : <button className="tlDockButton" onClick={() => setDockOpen(true)} title="Телефонія Binotel">☎</button>}
    </div>

    <style jsx global>{`
      .tlCallPopup{position:fixed;z-index:2147482000;right:22px;top:22px;width:min(410px,calc(100vw - 32px));padding:16px;border:1px solid color-mix(in srgb,var(--orange) 55%,var(--line));border-radius:18px;background:color-mix(in srgb,var(--surface) 94%,transparent);box-shadow:0 22px 70px rgba(0,0,0,.36);backdrop-filter:blur(18px);color:var(--text)}
      .tlCallTop{display:flex;align-items:center;gap:11px}.tlCallTop>div{min-width:0;display:flex;flex-direction:column;flex:1}.tlCallTop small{font-size:11px;font-weight:800;letter-spacing:.07em;color:var(--orange)}.tlCallTop strong{font-size:18px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.tlCallTop>button,.tlDockHead>button{border:0;background:transparent;color:var(--muted);font-size:25px;line-height:1;cursor:pointer}.tlPulse{width:42px;height:42px;border-radius:14px;display:grid;place-items:center;background:var(--orange);color:#111;font-size:21px;animation:tlPulse 1.35s ease-in-out infinite}.tl-missed .tlPulse,.tl-busy .tlPulse,.tl-completed .tlPulse{animation:none;background:var(--panel);color:var(--orange)}
      @keyframes tlPulse{0%,100%{transform:scale(1);box-shadow:0 0 0 0 color-mix(in srgb,var(--orange) 40%,transparent)}50%{transform:scale(1.05);box-shadow:0 0 0 9px transparent}}
      .tlPhone{font-size:22px;font-weight:850;margin:14px 0 8px}.tlContext{font-size:13px;color:var(--muted);margin-top:4px}.tlCallActions{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}.tlCallActions button{border:1px solid var(--line);background:var(--panel);color:var(--text);border-radius:11px;padding:10px 13px;font-weight:750;cursor:pointer}.tlCallActions .primary{background:var(--orange);border-color:var(--orange);color:#111}.tlCallActions .danger{border-color:#d74b4b;color:#ff7777}.tlCallActions button:disabled,.tlTransferList button:disabled{opacity:.55;cursor:not-allowed}
      .tlTransferBox{margin-top:12px;border:1px solid var(--line);border-radius:12px;background:var(--panel);padding:10px}.tlTransferBox>small{display:block;font-weight:800;margin-bottom:8px}.tlTransferBox>span{font-size:12px;color:var(--muted)}.tlTransferList{display:flex;flex-direction:column;gap:6px;max-height:190px;overflow:auto}.tlTransferList button{display:grid;grid-template-columns:52px 1fr;gap:8px;align-items:center;text-align:left;border:1px solid var(--line);border-radius:9px;background:var(--surface);color:var(--text);padding:8px 9px;cursor:pointer}.tlTransferList b{color:var(--orange)}.tlTransferList span{font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .tlDock{position:fixed;z-index:2147481900;right:22px;bottom:22px}.tlDockButton{width:54px;height:54px;border:0;border-radius:17px;background:var(--orange);color:#111;font-size:24px;box-shadow:0 14px 40px rgba(0,0,0,.3);cursor:pointer}.tlDockPanel{width:min(390px,calc(100vw - 32px));padding:15px;border:1px solid var(--line);border-radius:18px;background:var(--surface);box-shadow:0 18px 55px rgba(0,0,0,.34);color:var(--text)}.tlDockHead{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}.tlDockHead>div{display:flex;flex-direction:column}.tlDockHead strong{font-size:17px}.tlDockHead small{color:var(--muted);font-size:11px;margin-top:3px}.tlDial{display:flex;gap:8px;margin-top:14px}.tlDial input{min-width:0;flex:1;border:1px solid var(--line);border-radius:11px;background:var(--panel);color:var(--text);padding:11px 12px;font-size:14px}.tlDial button{border:0;border-radius:11px;background:var(--orange);color:#111;padding:0 14px;font-weight:800}.tlLinkBox{margin-top:12px}.tlLinkBox p,.tlLinkBox>span{font-size:12px;line-height:1.45;color:var(--muted)}.tlEmployeeList{display:flex;flex-direction:column;gap:6px;max-height:250px;overflow:auto}.tlEmployeeList button{display:grid;grid-template-columns:52px 1fr auto;gap:8px;align-items:center;text-align:left;border:1px solid var(--line);border-radius:11px;background:var(--panel);color:var(--text);padding:9px 10px}.tlEmployeeList b{font-size:15px;color:var(--orange)}.tlEmployeeList span{font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.tlEmployeeList em{font-size:9px;font-style:normal;color:#21c887}.tlMessage{margin-top:10px;border-radius:10px;padding:9px 10px;background:var(--panel);font-size:12px;color:var(--muted)}
      @media(max-width:760px){.tlCallPopup{top:12px;right:12px}.tlDock{right:12px;bottom:12px}}
    `}</style>
  </>;
}
