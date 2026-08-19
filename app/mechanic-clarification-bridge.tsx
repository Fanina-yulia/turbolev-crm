"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./mechanic-clarification-bridge.module.css";

type Clarification = {
  id: string;
  workOrderId: string;
  workOrderLineId: string;
  findingText: string;
  recommendation: string | null;
  urgency: string;
  managerComment: string | null;
  reviewedAt: string | null;
  workDescription: string;
  plate: string;
  vehicle: string;
};

type Payload = { ok: boolean; linked?: boolean; items?: Clarification[]; message?: string; error?: string };

export function MechanicClarificationBridge() {
  const [items, setItems] = useState<Clarification[]>([]);
  const [open, setOpen] = useState(false);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const current = useMemo(() => items[0] ?? null, [items]);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/cabinet/mechanic/findings", { cache: "no-store", credentials: "include" });
      const body = await response.json().catch(() => null) as Payload | null;
      if (!response.ok || !body?.ok) return;
      setItems(body.items ?? []);
      if (!(body.items ?? []).length) { setOpen(false); setReply(""); }
    } catch {
      // The main mechanic cabinet remains usable even if the clarification inbox cannot refresh.
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 20000);
    const handler = () => void load();
    window.addEventListener("turbolev:data-changed", handler);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("turbolev:data-changed", handler);
    };
  }, [load]);

  useEffect(() => {
    setReply("");
    setError("");
  }, [current?.id]);

  async function submit() {
    if (!current || reply.trim().length < 3) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/cabinet/mechanic/findings", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ findingId: current.id, reply: reply.trim() }),
      });
      const body = await response.json().catch(() => null) as Payload | null;
      if (!response.ok || !body?.ok) throw new Error(body?.message || body?.error || "Не вдалося передати уточнення");
      setReply("");
      setOpen(false);
      await load();
      window.dispatchEvent(new CustomEvent("turbolev:data-changed"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не вдалося передати уточнення");
    } finally {
      setBusy(false);
    }
  }

  if (!current) return null;

  return <>
    <button type="button" className={styles.alert} onClick={() => setOpen(true)}>
      <span>?</span><div><b>Сервіс-менеджер просить уточнення</b><small>{current.plate} · {items.length > 1 ? `ще ${items.length - 1}` : current.workDescription}</small></div><em>Відповісти</em>
    </button>

    {open && <div className={styles.backdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
      <section className={styles.dialog} role="dialog" aria-modal="true" aria-label="Уточнення сервіс-менеджеру">
        <header><div><span>УТОЧНЕННЯ ПО РОБОТІ</span><h2>{current.plate} · {current.vehicle}</h2></div><button type="button" onClick={() => setOpen(false)} aria-label="Закрити">×</button></header>
        <div className={styles.work}><b>{current.workDescription}</b><span>{current.findingText}</span></div>
        <div className={styles.question}><span>Питання сервіс-менеджера</span><strong>{current.managerComment || "Потрібне додаткове уточнення по несправності."}</strong></div>
        <label className={styles.field}>Ваша відповідь<textarea rows={4} maxLength={2000} value={reply} onChange={(event) => setReply(event.target.value)} placeholder="Коротко уточніть стан, причину, обсяг робіт або потрібні запчастини…" /></label>
        {error && <div className={styles.error}>{error}</div>}
        <div className={styles.actions}><button type="button" className={styles.secondary} onClick={() => setOpen(false)}>Пізніше</button><button type="button" className={styles.primary} disabled={busy || reply.trim().length < 3} onClick={() => void submit()}>{busy ? "Передаю…" : "Передати уточнення →"}</button></div>
      </section>
    </div>}
  </>;
}
