"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

type StepState = "OK" | "WAITING" | "ERROR";
type DiagnosticStep = {
  key: "credentials" | "api" | "transport" | "inbound" | "outbound" | "delivery";
  label: string;
  state: StepState;
  detail: string;
  at: string | null;
};
type DiagnosticChannel = {
  key: "FACEBOOK" | "INSTAGRAM" | "OLX";
  label: string;
  provider: "META" | "OLX";
  ready: boolean;
  nextAction: string | null;
  steps: DiagnosticStep[];
};
type StatusResponse = {
  ok?: boolean;
  diagnostics?: DiagnosticChannel[];
  meta?: { configured?: boolean };
  olx?: { configured?: boolean };
  error?: string;
};

const CHANNEL_ICON: Record<DiagnosticChannel["key"], string> = {
  FACEBOOK: "f",
  INSTAGRAM: "◎",
  OLX: "O",
};

function fmt(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("uk-UA", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date);
}

function stateIcon(state: StepState) {
  if (state === "OK") return "✓";
  if (state === "ERROR") return "!";
  return "○";
}

function findTarget() {
  const heading = Array.from(document.querySelectorAll<HTMLHeadingElement>("h2"))
    .find((node) => (node.textContent || "").trim() === "Інтеграції комунікацій");
  return heading?.closest<HTMLElement>("section") || null;
}

export function CommunicationActivationDiagnosticsBridge() {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [action, setAction] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const response = await fetch("/api/integrations/communications/status", { cache: "no-store" });
      const data = await response.json().catch(() => ({})) as StatusResponse;
      if (!response.ok || data.ok === false) throw new Error(data.error || "Не вдалося отримати діагностику каналів");
      setStatus(data);
      if (!silent) setMessage("");
    } catch (error) {
      if (!silent) setMessage(error instanceof Error ? error.message : "Не вдалося отримати діагностику каналів");
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const wire = () => setTarget(findTarget());
    const observer = new MutationObserver(wire);
    observer.observe(document.body, { childList: true, subtree: true });
    wire();
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!target) return;
    void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load(true);
    }, 15000);
    return () => window.clearInterval(timer);
  }, [target, load]);

  const diagnostics = status?.diagnostics || [];
  const readyCount = useMemo(() => diagnostics.filter((item) => item.ready).length, [diagnostics]);

  function openSettings() {
    const url = new URL(window.location.href);
    url.searchParams.set("section", "settings");
    url.searchParams.set("settingsTab", "integrations");
    url.searchParams.delete("filter");
    url.searchParams.delete("filterLabel");
    window.history.pushState({}, "", `${url.pathname}${url.search}${url.hash}`);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }

  async function testProvider(provider: "META" | "OLX") {
    const key = `test-${provider}`;
    if (action) return;
    setAction(key); setMessage("");
    try {
      const response = await fetch(`/api/settings/integrations/${provider.toLowerCase()}/test`, { method: "POST" });
      const data = await response.json().catch(() => ({})) as { ok?: boolean; message?: string; error?: string };
      if (!response.ok || !data.ok) throw new Error(data.message || data.error || "Перевірка API не пройшла");
      setMessage(data.message || "API-з'єднання підтверджено.");
      await load(true);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Перевірка API не пройшла");
      await load(true);
    } finally { setAction(""); }
  }

  async function syncOlx() {
    if (action) return;
    setAction("sync-OLX"); setMessage("");
    try {
      const response = await fetch("/api/integrations/olx/sync", { method: "POST" });
      const data = await response.json().catch(() => ({})) as { ok?: boolean; error?: string; threads?: number; messages?: number };
      if (!response.ok || !data.ok) throw new Error(data.error || "Синхронізація OLX не пройшла");
      setMessage(`OLX: ${data.threads || 0} діалогів, ${data.messages || 0} повідомлень.`);
      await load(true);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Синхронізація OLX не пройшла");
      await load(true);
    } finally { setAction(""); }
  }

  async function copyMetaWebhook() {
    const value = `${window.location.origin}/api/webhooks/meta`;
    try {
      await navigator.clipboard.writeText(value);
      setMessage("Meta webhook URL скопійовано.");
    } catch {
      setMessage(value);
    }
  }

  function primaryAction(channel: DiagnosticChannel) {
    const blocker = channel.steps.find((step) => step.state !== "OK");
    if (!blocker) return null;
    if (blocker.key === "credentials") return <button type="button" onClick={openSettings}>Внести доступи</button>;
    if (blocker.key === "api") return <button type="button" disabled={Boolean(action)} onClick={() => void testProvider(channel.provider)}>{action === `test-${channel.provider}` ? "Перевіряю…" : "Перевірити API"}</button>;
    if (blocker.key === "transport" && channel.key === "OLX") return <button type="button" onClick={() => { window.location.href = "/api/integrations/olx/connect"; }}>Підключити OLX</button>;
    if (blocker.key === "transport") return <button type="button" onClick={() => void copyMetaWebhook()}>Копіювати webhook</button>;
    return <button type="button" disabled={loading} onClick={() => void load()}>{loading ? "Оновлюю…" : "Оновити перевірку"}</button>;
  }

  if (!target) return null;

  return createPortal(
    <section className="communicationActivationDiagnostics" aria-label="Діагностика активації каналів">
      <div className="communicationActivationDiagnosticsHead">
        <div>
          <span>КОНТРОЛЬ ПІДКЛЮЧЕННЯ</span>
          <h3>Діагностика активації</h3>
          <p>CRM показує, на якому саме кроці знаходиться Facebook, Instagram та OLX.</p>
        </div>
        <div className="communicationActivationDiagnosticsSummary">
          <strong>{readyCount}/{diagnostics.length || 3}</strong>
          <span>каналів повністю перевірено</span>
          <button type="button" disabled={loading} onClick={() => void load()}>{loading ? "Оновлюю…" : "↻ Оновити"}</button>
        </div>
      </div>

      {message && <div className="communicationActivationDiagnosticsMessage">{message}</div>}

      {!diagnostics.length ? <div className="communicationActivationDiagnosticsEmpty">{loading ? "Завантажую діагностику…" : "Діагностика поки недоступна."}</div> :
        <div className="communicationActivationDiagnosticsGrid">{diagnostics.map((channel) => <article className="communicationActivationChannel" data-ready={channel.ready} key={channel.key}>
          <header>
            <span className="communicationActivationChannelIcon">{CHANNEL_ICON[channel.key]}</span>
            <div><strong>{channel.label}</strong><small>{channel.provider === "META" ? "Meta" : "OLX Partner API"}</small></div>
            <em>{channel.ready ? "Готово" : channel.steps.some((step) => step.state === "ERROR") ? "Є помилка" : "Потрібна дія"}</em>
          </header>

          <div className="communicationActivationSteps">{channel.steps.map((step, index) => <div className="communicationActivationStep" data-state={step.state} key={step.key}>
            <div className="communicationActivationStepLine">
              <i>{stateIcon(step.state)}</i>
              {index < channel.steps.length - 1 && <span />}
            </div>
            <div className="communicationActivationStepBody">
              <strong>{step.label}</strong>
              <p>{step.detail}</p>
              {step.at && <time>{fmt(step.at)}</time>}
            </div>
          </div>)}</div>

          <footer>
            <div><span>Наступна дія</span><strong>{channel.ready ? "Канал повністю перевірений." : channel.nextAction || "Оновіть стан інтеграції."}</strong></div>
            <div className="communicationActivationChannelActions">
              {primaryAction(channel)}
              {channel.key === "OLX" && status?.olx?.configured && <button type="button" className="secondary" disabled={Boolean(action)} onClick={() => void syncOlx()}>{action === "sync-OLX" ? "Синхронізую…" : "Синхронізувати"}</button>}
            </div>
          </footer>
        </article>)}</div>}
    </section>,
    target,
  );
}
