"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { navigateCrm, readCrmRoute } from "./crm-route";

type Issue = {
  id: string;
  vehicleId: string;
  sourceDiagnosticId: string | null;
  workOrderId: string | null;
  title: string;
  description: string | null;
  action: string | null;
  urgency: string | null;
  suggestedWorkName: string | null;
  suggestedPartName: string | null;
  status: string;
  firstDetectedAt: string;
  lastDetectedAt: string;
  resolvedAt: string | null;
  deferredUntil: string | null;
  resolutionNote: string | null;
};

function text(value: Element | null | undefined) {
  return String(value?.textContent || "").replace(/\s+/g, " ").trim();
}

function date(value: string | null | undefined) {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "—" : new Intl.DateTimeFormat("uk-UA", { day: "2-digit", month: "2-digit", year: "numeric" }).format(parsed);
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    OPEN: "Відкрита",
    DECISION_REQUIRED: "Потрібне рішення",
    QUOTED: "Додано в КП",
    WAITING_CUSTOMER: "Очікує клієнта",
    APPROVED: "Погоджено",
    WAITING_PARTS: "Очікує запчастини",
    READY_FOR_REPAIR: "Готово до ремонту",
    IN_REPAIR: "У ремонті",
    RESOLVED: "Усунено",
    DEFERRED: "Відкладено",
    DISMISSED: "Відхилено",
  };
  return labels[status] || status;
}

function workOrderActionLabel(status: string) {
  if (["QUOTED", "WAITING_CUSTOMER", "APPROVED"].includes(status)) return "Відкрити КП";
  if (["WAITING_PARTS", "READY_FOR_REPAIR", "IN_REPAIR"].includes(status)) return "Відкрити ремонт";
  return "Відкрити наряд";
}

export function VehicleHealthEnhancer() {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [vehicleId, setVehicleId] = useState("");
  const [scope, setScope] = useState<"active" | "resolved">("active");
  const [issues, setIssues] = useState<Issue[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState("");

  const load = useCallback(async (id: string, nextScope: "active" | "resolved") => {
    if (!id) return;
    setLoading(true);
    setMessage("");
    try {
      const response = await fetch(`/api/vehicles/${encodeURIComponent(id)}/issues?scope=${nextScope}`, { cache: "no-store", credentials: "include" });
      const body = await response.json().catch(() => null) as { ok?: boolean; issues?: Issue[]; error?: string } | null;
      if (!response.ok || !body?.ok) throw new Error(body?.error || "Не вдалося завантажити стан авто");
      setIssues(Array.isArray(body.issues) ? body.issues : []);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не вдалося завантажити стан авто");
      setIssues([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const syncRoute = () => {
      const next = readCrmRoute().vehicleId || "";
      if (next !== vehicleId) {
        setVehicleId(next);
        setScope("active");
      }
    };
    syncRoute();
    window.addEventListener("popstate", syncRoute);
    return () => window.removeEventListener("popstate", syncRoute);
  }, [vehicleId]);

  useEffect(() => { if (vehicleId) void load(vehicleId, scope); }, [vehicleId, scope, load]);

  useEffect(() => {
    const reload = () => { if (vehicleId) void load(vehicleId, scope); };
    window.addEventListener("turbolev:data-changed", reload);
    return () => window.removeEventListener("turbolev:data-changed", reload);
  }, [vehicleId, scope, load]);

  useEffect(() => {
    let frame = 0;
    const resolve = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!readCrmRoute().vehicleId) return setHost(null);
        const heading = Array.from(document.querySelectorAll("h3")).find((item) => text(item) === "Технічні дані");
        const section = heading?.closest<HTMLElement>("section");
        const parent = section?.parentElement;
        if (!section || !parent) return setHost(null);
        let next = parent.querySelector<HTMLElement>(":scope > [data-vehicle-health-host]");
        if (!next) {
          next = document.createElement("div");
          next.dataset.vehicleHealthHost = "1";
          section.insertAdjacentElement("afterend", next);
        }
        setHost(next);
      });
    };
    resolve();
    const observer = new MutationObserver(resolve);
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("popstate", resolve);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("popstate", resolve);
    };
  }, []);

  const mutate = async (issue: Issue, action: "DEFER" | "DISMISS" | "REOPEN") => {
    let comment = "";
    if (action === "DEFER") comment = window.prompt("Коментар: чому проблему відкладаємо?", issue.resolutionNote || "")?.trim() || "";
    if (action === "DISMISS") {
      comment = window.prompt("Причина відхилення проблеми:")?.trim() || "";
      if (!comment) return;
    }
    setBusy(issue.id);
    try {
      const response = await fetch(`/api/vehicle-issues/${encodeURIComponent(issue.id)}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, comment }),
      });
      const body = await response.json().catch(() => null) as { ok?: boolean; error?: string; message?: string } | null;
      if (!response.ok || !body?.ok) throw new Error(body?.message || body?.error || "Не вдалося оновити проблему");
      await load(vehicleId, scope);
      window.dispatchEvent(new CustomEvent("turbolev:data-changed"));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не вдалося оновити проблему");
    } finally {
      setBusy("");
    }
  };

  if (!host || !vehicleId) return null;
  return createPortal(<section className="vehicleHealthPanel">
    <div className="vehicleHealthHead">
      <div><span>СТАН АВТО</span><h3>Виявлені проблеми</h3><p>Проблема проходить один ланцюжок: ДК → КП → запчастини → ремонт → контроль → усунено.</p></div>
      <div className="vehicleHealthTabs"><button type="button" className={scope === "active" ? "active" : ""} onClick={() => setScope("active")}>Активні</button><button type="button" className={scope === "resolved" ? "active" : ""} onClick={() => setScope("resolved")}>Історія</button></div>
    </div>
    {message ? <div className="vehicleHealthMessage">{message}</div> : null}
    {loading ? <div className="vehicleHealthEmpty">Завантажую стан автомобіля…</div> : issues.length ? <div className="vehicleHealthList">{issues.map((issue) => <article key={issue.id} className="vehicleHealthIssue" data-urgency={issue.urgency || "INFO"}>
      <div className="vehicleHealthIssueTop"><strong>{issue.title}</strong><span>{statusLabel(issue.status)}</span></div>
      {issue.description ? <p>{issue.description}</p> : null}
      <div className="vehicleHealthMeta"><span>Виявлено: {date(issue.firstDetectedAt)}</span>{issue.firstDetectedAt !== issue.lastDetectedAt ? <span>Повторно: {date(issue.lastDetectedAt)}</span> : null}{issue.resolvedAt ? <span>Усунено: {date(issue.resolvedAt)}</span> : null}{issue.urgency ? <span>{issue.urgency === "CRITICAL" ? "Критично" : issue.urgency === "SOON" ? "Найближчим часом" : "Рекомендація"}</span> : null}</div>
      {(issue.suggestedWorkName || issue.suggestedPartName) && <div className="vehicleHealthRecommendations">{issue.suggestedWorkName ? <span>🔧 {issue.suggestedWorkName}</span> : null}{issue.suggestedPartName ? <span>▣ {issue.suggestedPartName}</span> : null}</div>}
      {issue.resolutionNote ? <div className="vehicleHealthResolution">{issue.resolutionNote}</div> : null}
      <div className="vehicleHealthActions">
        {issue.sourceDiagnosticId ? <button type="button" onClick={() => navigateCrm("Діагностика", { diagnosticId: issue.sourceDiagnosticId! })}>Відкрити ДК</button> : null}
        {issue.workOrderId ? <button type="button" className="primary" onClick={() => navigateCrm("Комерційна пропозиція", { workOrderId: issue.workOrderId!, workOrderTab: ["QUOTED", "WAITING_CUSTOMER", "APPROVED"].includes(issue.status) ? "estimate" : undefined })}>{workOrderActionLabel(issue.status)}</button> : null}
        {issue.sourceDiagnosticId && !issue.workOrderId && !["RESOLVED", "DISMISSED"].includes(issue.status) ? <button type="button" onClick={() => navigateCrm("Підбір запчастин", { diagnosticId: issue.sourceDiagnosticId! })}>Підібрати запчастини</button> : null}
        {!(["RESOLVED", "DISMISSED", "DEFERRED"].includes(issue.status)) ? <button type="button" disabled={busy === issue.id} onClick={() => void mutate(issue, "DEFER")}>Відкласти</button> : null}
        {!(["RESOLVED", "DISMISSED"].includes(issue.status)) ? <button type="button" disabled={busy === issue.id} onClick={() => void mutate(issue, "DISMISS")}>Відхилити</button> : <button type="button" disabled={busy === issue.id} onClick={() => void mutate(issue, "REOPEN")}>Відкрити знову</button>}
      </div>
    </article>)}</div> : <div className="vehicleHealthEmpty">{scope === "active" ? "Активних проблем за підтвердженими діагностиками немає." : "Закритих проблем поки немає."}</div>}
    <style jsx global>{`
      .vehicleHealthPanel{border:1px solid var(--line);border-radius:14px;background:var(--panel);padding:14px;margin-top:12px;color:var(--text)}
      .vehicleHealthHead{display:flex;justify-content:space-between;gap:14px;align-items:flex-start}.vehicleHealthHead span{font-size:12px;font-weight:850;color:var(--orange);letter-spacing:.08em}.vehicleHealthHead h3{margin:4px 0 2px;font-size:18px}.vehicleHealthHead p{margin:0;color:var(--muted);font-size:12px;line-height:1.45}.vehicleHealthTabs{display:flex;gap:6px}.vehicleHealthTabs button{border:1px solid var(--line);background:var(--surface);color:var(--text);border-radius:999px;padding:7px 10px;font-size:12px;font-weight:750;cursor:pointer}.vehicleHealthTabs button.active{border-color:var(--orange);color:var(--orange)}
      .vehicleHealthList{display:grid;gap:9px;margin-top:12px}.vehicleHealthIssue{border:1px solid var(--line);border-left:4px solid #f59e0b;border-radius:11px;background:var(--surface);padding:11px}.vehicleHealthIssue[data-urgency="CRITICAL"]{border-left-color:#dc2626}.vehicleHealthIssueTop{display:flex;justify-content:space-between;gap:10px;align-items:flex-start}.vehicleHealthIssueTop strong{font-size:14px}.vehicleHealthIssueTop span{font-size:12px;color:var(--muted);white-space:nowrap}.vehicleHealthIssue p{margin:7px 0;font-size:13px;line-height:1.45}.vehicleHealthMeta,.vehicleHealthRecommendations{display:flex;gap:8px;flex-wrap:wrap}.vehicleHealthMeta span,.vehicleHealthRecommendations span{font-size:12px;color:var(--muted)}.vehicleHealthRecommendations{margin-top:7px}.vehicleHealthRecommendations span{color:var(--text)}.vehicleHealthResolution{margin-top:8px;border-radius:8px;background:var(--panel);padding:8px 9px;color:var(--muted);font-size:12px;line-height:1.45}.vehicleHealthActions{display:flex;gap:7px;flex-wrap:wrap;margin-top:10px}.vehicleHealthActions button{border:1px solid var(--line);background:var(--panel);color:var(--text);border-radius:9px;padding:7px 9px;font-size:12px;font-weight:700;cursor:pointer}.vehicleHealthActions button.primary{border-color:var(--orange);color:var(--orange)}.vehicleHealthActions button:disabled{opacity:.55;cursor:wait}.vehicleHealthEmpty,.vehicleHealthMessage{margin-top:12px;border:1px dashed var(--line);border-radius:10px;padding:12px;color:var(--muted);font-size:12px}.vehicleHealthMessage{border-style:solid;color:#dc2626}
      @media(max-width:620px){.vehicleHealthHead{display:grid}.vehicleHealthTabs{justify-content:flex-start}}
    `}</style>
  </section>, host);
}
