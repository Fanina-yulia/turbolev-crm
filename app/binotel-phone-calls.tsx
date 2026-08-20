"use client";

import { useCallback, useEffect, useState } from "react";
import { BinotelPlayButton, type BinotelCallItem } from "./binotel-recordings";
import styles from "./binotel-phone-calls.module.css";

type Payload = { ok?: boolean; items?: BinotelCallItem[]; total?: number; error?: string };

function normalizePhone(value: string) {
  return value.replace(/\D/g, "").replace(/^0/, "380");
}

function fmt(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("uk-UA", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date);
}

function durationText(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds || 0));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
}

export function BinotelPhoneCalls({ phone, onClose }: { phone: string; onClose?: () => void }) {
  const [items, setItems] = useState<BinotelCallItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const normalized = normalizePhone(phone);
    if (!normalized) return;
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ q: normalized, take: "8", page: "1" });
      const response = await fetch(`/api/telephony/calls?${params}`, { cache: "no-store" });
      const data = await response.json().catch(() => ({})) as Payload;
      if (!response.ok || !data.ok) throw new Error(data.error || "Не вдалося завантажити дзвінки.");
      setItems((data.items || []).filter((call) => normalizePhone(call.externalNumber) === normalized || normalizePhone(call.client?.phone || "") === normalized));
    } catch (cause) {
      setItems([]);
      setError(cause instanceof Error ? cause.message : "Не вдалося завантажити дзвінки.");
    } finally { setLoading(false); }
  }, [phone]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const refresh = () => void load();
    window.addEventListener("turbolev:data-changed", refresh);
    return () => window.removeEventListener("turbolev:data-changed", refresh);
  }, [load]);

  return <aside className={styles.panel} aria-label="Записи дзвінків Binotel">
    <header className={styles.head}>
      <div><p>BINOTEL</p><h3>Розмови з клієнтом</h3><span>{phone}</span></div>
      <div><button type="button" onClick={() => void load()} disabled={loading} title="Оновити">↻</button>{onClose && <button type="button" onClick={onClose} title="Закрити">×</button>}</div>
    </header>
    <div className={styles.body}>
      {loading ? <div className={styles.empty}>Завантажую дзвінки…</div> : error ? <div className={styles.error}>{error}</div> : !items.length ? <div className={styles.empty}>Записів дзвінків за цим номером ще немає.</div> : items.map((call) => <div className={styles.row} key={call.id}>
        <span className={styles.direction} data-direction={call.direction}>{call.direction === "INCOMING" ? "↙" : "↗"}</span>
        <div className={styles.info}><strong>{call.direction === "INCOMING" ? "Вхідний" : "Вихідний"} · {durationText(call.duration)}</strong><small>{fmt(call.startedAt)}{call.manager?.name ? ` · ${call.manager.name}` : ""}</small></div>
        <BinotelPlayButton call={call} compact />
      </div>)}
    </div>
  </aside>;
}
