"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import styles from "./binotel-callbacks-settings.module.css";

type CallbackPayload = {
  ok?: boolean;
  callbacks?: {
    apiPush?: string;
    apiCallCompleted?: string;
    apiCallSettings?: string;
  };
  note?: string;
  error?: string;
};

type SyncPayload = {
  ok?: boolean;
  skipped?: boolean;
  reason?: string;
  providerCalls?: number;
  alreadyComplete?: number;
  restored?: number;
  refreshed?: number;
  failed?: Array<{ callId: string; error: string }>;
  error?: string;
};

const ITEMS = [
  { key: "apiPush" as const, title: "API PUSH", detail: "incomingCall / receivedTheCall · answeredTheCall · hangupTheCall" },
  { key: "apiCallCompleted" as const, title: "API CALL COMPLETED", detail: "Повна інформація після завершення дзвінка" },
  { key: "apiCallSettings" as const, title: "API CALL SETTINGS", detail: "Клієнт і відповідальний співробітник під час дзвінка" },
];

export function BinotelCallbacksSettings() {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [data, setData] = useState<CallbackPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [copied, setCopied] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncPayload | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/settings/integrations/binotel/callbacks", { cache: "no-store" });
      const payload = (await response.json()) as CallbackPayload;
      if (!response.ok || !payload.ok) throw new Error(payload.error || "Не вдалося отримати callback URL");
      setData(payload);
    } catch (error) {
      setData({ ok: false, error: error instanceof Error ? error.message : "Не вдалося отримати callback URL" });
    } finally {
      setLoading(false);
    }
  }, []);

  const syncCalls = useCallback(async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const response = await fetch("/api/communications/binotel-history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lookbackMinutes: 90, manual: true }),
        cache: "no-store",
      });
      const payload = (await response.json()) as SyncPayload;
      if (!response.ok || !payload.ok) throw new Error(payload.error || "Не вдалося синхронізувати дзвінки");
      setSyncResult(payload);
    } catch (error) {
      setSyncResult({ ok: false, error: error instanceof Error ? error.message : "Не вдалося синхронізувати дзвінки" });
    } finally {
      setSyncing(false);
    }
  }, []);

  useEffect(() => {
    let observer: MutationObserver | null = null;
    let timer = 0;

    const locate = () => {
      const heading = Array.from(document.querySelectorAll<HTMLHeadingElement>("h2")).find(
        (node) => (node.textContent || "").trim() === "Налаштування",
      );
      const modal = heading?.closest<HTMLElement>("section") || null;
      const main = modal?.querySelector<HTMLElement>('div[class*="layout"] > main') || null;
      if (!main) return setTarget(null);
      const text = (main.textContent || "").replace(/\s+/g, " ");
      if (!text.includes("Binotel")) return setTarget(null);
      setTarget(main);
      if (!data && !loading) void refresh();
    };

    locate();
    observer = new MutationObserver(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(locate, 30);
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });

    return () => {
      observer?.disconnect();
      window.clearTimeout(timer);
    };
  }, [data, loading, refresh]);

  const rows = useMemo(() => {
    const callbacks = data?.callbacks;
    return ITEMS.map((item) => ({ ...item, value: callbacks?.[item.key] || "" }));
  }, [data]);

  async function copy(key: string, value: string) {
    if (!value) return;
    await navigator.clipboard.writeText(value);
    setCopied(key);
    window.setTimeout(() => setCopied(null), 1800);
  }

  const syncMessage = useMemo(() => {
    if (!syncResult) return null;
    if (syncResult.error) return { kind: "error" as const, text: syncResult.error };
    if (syncResult.skipped) return { kind: "info" as const, text: "Синхронізація вже виконувалась нещодавно. Повторити можна за кілька хвилин." };
    const provider = syncResult.providerCalls ?? 0;
    const restored = syncResult.restored ?? 0;
    const refreshed = syncResult.refreshed ?? 0;
    const failed = syncResult.failed?.length ?? 0;
    return {
      kind: failed ? "warning" as const : "success" as const,
      text: `Binotel повернув дзвінків: ${provider}. Додано в CRM: ${restored}. Оновлено: ${refreshed}.${failed ? ` Помилок: ${failed}.` : ""}`,
    };
  }, [syncResult]);

  if (!target) return null;

  return createPortal(
    <section className={styles.panel} aria-label="Binotel — синхронізація та webhook">
      <div className={styles.syncBox}>
        <div>
          <strong>Синхронізація дзвінків Binotel</strong>
          <p>Перевіряє останні 90 хвилин через REST API та додає дзвінки, які не прийшли webhook-ом.</p>
        </div>
        <button type="button" className={styles.syncButton} disabled={syncing} onClick={() => void syncCalls()}>
          {syncing ? "Синхронізація…" : "Синхронізувати дзвінки зараз"}
        </button>
      </div>
      {syncMessage ? <div className={`${styles.syncMessage} ${styles[syncMessage.kind]}`}>{syncMessage.text}</div> : null}

      <div className={styles.head}>
        <div>
          <strong>Webhook URL для Binotel</strong>
          <p>Готові production-адреси для передачі техпідтримці Binotel.</p>
        </div>
        <button type="button" className={styles.refresh} onClick={() => void refresh()} disabled={loading}>
          {loading ? "Оновлення…" : "Оновити"}
        </button>
      </div>

      {data?.error ? (
        <div className={styles.error}>Захищені callback URL недоступні в поточній сесії. Синхронізація дзвінків вище продовжує працювати.</div>
      ) : (
        <div className={styles.list}>
          {rows.map((row) => (
            <div className={styles.row} key={row.key}>
              <div className={styles.meta}>
                <strong>{row.title}</strong>
                <span>{row.detail}</span>
              </div>
              <div className={styles.urlRow}>
                <code className={styles.url}>{revealed[row.key] ? row.value : row.value ? "••••••••••••••••••••••••••••••••••••" : "—"}</code>
                <button type="button" className={styles.secondary} disabled={!row.value} onClick={() => setRevealed((current) => ({ ...current, [row.key]: !current[row.key] }))}>
                  {revealed[row.key] ? "Сховати" : "Показати"}
                </button>
                <button type="button" className={styles.copy} disabled={!row.value} onClick={() => void copy(row.key, row.value)}>
                  {copied === row.key ? "Скопійовано" : "Копіювати URL"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className={styles.warning}>URL містять секретний webhook token. Передавайте їх тільки Binotel. Сам token окремо в інтерфейсі не показується.</div>
    </section>,
    target,
  );
}
