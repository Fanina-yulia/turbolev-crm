"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { InquiryItemContract as Inquiry, InquiryStatsContract } from "@/src/lib/contracts/inquiries";
import {
  inquiryPayloadMessage,
  parseInquiriesPayload,
  parseInquiryMutationPayload,
} from "@/src/lib/contracts/inquiries-payload.parsers";
import styles from "./new-inquiries.module.css";

const channelLabel: Record<string, string> = { BINOTEL: "Телефон", WEBSITE: "Сайт", INSTAGRAM: "Instagram", FACEBOOK: "Facebook", TIKTOK: "TikTok", OLX: "OLX" };
const priorityLabel: Record<string, string> = { CRITICAL: "Критичний", HIGH: "Високий", MEDIUM: "Середній", LOW: "Низький" };

function timeLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const now = new Date();
  if (date.toDateString() === now.toDateString()) return new Intl.DateTimeFormat("uk-UA", { hour: "2-digit", minute: "2-digit" }).format(date);
  return new Intl.DateTimeFormat("uk-UA", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(date);
}
function vehicleLabel(item: Inquiry) {
  const matched = item.vehicles[0];
  if (matched) return [matched.brand, matched.model, matched.year].filter(Boolean).join(" ");
  return item.vehicle || "Авто уточнюється";
}
function plateLabel(item: Inquiry) { return item.vehicles[0]?.plateNumber || item.plate || "Номер не вказано"; }
function navigate(section: string) { window.dispatchEvent(new CustomEvent("turbolev:navigate", { detail: section })); }

export function NewInquiries() {
  const [items, setItems] = useState<Inquiry[]>([]);
  const [stats, setStats] = useState<InquiryStatsContract | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [channel, setChannel] = useState("ALL");
  const [priority, setPriority] = useState("ALL");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/inquiries", { cache: "no-store" });
      const raw: unknown = await response.json().catch(() => null);
      const body = parseInquiriesPayload(raw);
      if (!response.ok || !body) throw new Error(inquiryPayloadMessage(raw, "Не вдалося завантажити звернення"));
      setItems(body.items); setStats(body.stats);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не вдалося завантажити звернення"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase("uk-UA");
    return items.filter((item) => {
      if (channel !== "ALL" && item.channel !== channel) return false;
      if (priority !== "ALL" && item.priority !== priority) return false;
      if (!needle) return true;
      return `${item.name} ${item.phone || ""} ${item.subject} ${item.preview} ${vehicleLabel(item)} ${plateLabel(item)}`.toLocaleLowerCase("uk-UA").includes(needle);
    });
  }, [items, channel, priority, search]);

  async function accept(item: Inquiry) {
    setBusyId(item.id); setError("");
    try {
      const response = await fetch(`/api/inquiries/${encodeURIComponent(item.id)}/accept`, { method: "POST" });
      const raw: unknown = await response.json().catch(() => null);
      const body = parseInquiryMutationPayload(raw);
      if (!response.ok || !body) throw new Error(inquiryPayloadMessage(raw, "Не вдалося прийняти звернення"));
      setItems((current) => current.filter((entry) => entry.id !== item.id));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не вдалося прийняти звернення"); }
    finally { setBusyId(null); }
  }

  async function convert(item: Inquiry) {
    setBusyId(item.id); setError("");
    try {
      if (!item.assignedUser) {
        const acceptResponse = await fetch(`/api/inquiries/${encodeURIComponent(item.id)}/accept`, { method: "POST" });
        const rawAccepted: unknown = await acceptResponse.json().catch(() => null);
        const accepted = parseInquiryMutationPayload(rawAccepted);
        if (!acceptResponse.ok || !accepted) throw new Error(inquiryPayloadMessage(rawAccepted, "Спочатку прийміть звернення"));
      }
      const response = await fetch(`/api/communications/${encodeURIComponent(item.id)}/convert`, { method: "POST" });
      const raw: unknown = await response.json().catch(() => null);
      const body = parseInquiryMutationPayload(raw);
      if (!response.ok || !body) throw new Error(inquiryPayloadMessage(raw, "Не вдалося створити лід"));
      setItems((current) => current.filter((entry) => entry.id !== item.id));
      navigate("Ліди");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не вдалося створити лід"); }
    finally { setBusyId(null); }
  }

  async function spam(item: Inquiry) {
    setBusyId(item.id); setError("");
    try {
      const response = await fetch(`/api/communications/${encodeURIComponent(item.id)}`, {
        method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ state: "SPAM", unread: false }),
      });
      const raw: unknown = await response.json().catch(() => null);
      const body = parseInquiryMutationPayload(raw);
      if (!response.ok || !body) throw new Error(inquiryPayloadMessage(raw, "Не вдалося закрити звернення"));
      setItems((current) => current.filter((entry) => entry.id !== item.id));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не вдалося закрити звернення"); }
    finally { setBusyId(null); }
  }

  return <div className={styles.page}>
    <header className={styles.header}><div><p className={styles.eyebrow}>ЗВЕРНЕННЯ</p><h1>Нові звернення</h1><p>Єдина черга нових дзвінків і повідомлень, які ще потрібно опрацювати.</p></div><button type="button" className={styles.refresh} onClick={() => void load()}>Оновити</button></header>
    {error && <div className={styles.error}>{error}</div>}

    <section className={styles.kpis}>
      <div><span>Нових звернень</span><strong>{stats?.total ?? items.length}</strong><small>у черзі</small></div>
      <div><span>Критичних</span><strong className={styles.danger}>{stats?.critical ?? 0}</strong><small>реакція негайно</small></div>
      <div><span>Високий пріоритет</span><strong>{stats?.high ?? 0}</strong><small>потрібна швидка відповідь</small></div>
      <div><span>Відомі клієнти</span><strong>{stats?.existingClients ?? 0}</strong><small>CRM вже впізнала</small></div>
      <div><span>Є активний лід</span><strong>{stats?.withActiveLead ?? 0}</strong><small>не створювати дублі</small></div>
    </section>

    <section className={styles.filters}>
      <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Пошук за клієнтом, телефоном, авто або проблемою…" />
      <select value={channel} onChange={(event) => setChannel(event.target.value)}><option value="ALL">Усі канали</option><option value="BINOTEL">Телефон / Binotel</option><option value="WEBSITE">Сайт</option><option value="INSTAGRAM">Instagram</option><option value="FACEBOOK">Facebook</option><option value="OLX">OLX</option><option value="TIKTOK">TikTok</option></select>
      <select value={priority} onChange={(event) => setPriority(event.target.value)}><option value="ALL">Усі пріоритети</option><option value="CRITICAL">Критичний</option><option value="HIGH">Високий</option><option value="MEDIUM">Середній</option><option value="LOW">Низький</option></select>
    </section>

    <section className={styles.table}>
      <div className={styles.tableHead}><span>Звернення</span><span>Контакт</span><span>Автомобіль</span><span>Проблема</span><span>Пріоритет</span><span>Джерело</span><span>Дії</span></div>
      {loading ? <div className={styles.empty}>Завантажуємо нові звернення…</div> : filtered.length === 0 ? <div className={styles.empty}>Нових звернень за цими фільтрами немає.</div> : filtered.map((item) => <article className={styles.row} key={item.id}>
        <div className={styles.time}><strong>{timeLabel(item.receivedAt)}</strong><span className={`${styles.channel} ${styles[`channel${item.channel}`] || ""}`}>{channelLabel[item.channel] || item.channel}</span></div>
        <div className={styles.contact}><strong>{item.name}</strong><span>{item.phone || item.handle || "Контакт уточнюється"}</span>{item.existingClient && <em>Постійний клієнт</em>}{item.existingLead && <button type="button" onClick={() => navigate("Ліди")}>Є активний лід · {item.existingLead.status}</button>}</div>
        <div className={styles.vehicle}><strong>{vehicleLabel(item)}</strong><span>{plateLabel(item)}</span>{item.vehicles[0]?.vin && <small>VIN {item.vehicles[0].vin}</small>}</div>
        <div className={styles.problem}><strong>{item.subject}</strong><span>{item.preview}</span>{item.campaign && <small>Кампанія: {item.campaign}</small>}</div>
        <div><span className={`${styles.priority} ${styles[`priority${item.priority}`] || ""}`}>{priorityLabel[item.priority] || item.priority}</span></div>
        <div className={styles.source}><strong>{channelLabel[item.channel] || item.channel}</strong><span>{item.sourceDetail || "Пряме звернення"}</span></div>
        <div className={styles.actions}>
          <button type="button" className={styles.accept} disabled={busyId === item.id} onClick={() => void accept(item)}>✓ Прийняти</button>
          {item.phone && <a href={`tel:${item.phone}`}>☎ Подзвонити</a>}
          <button type="button" disabled={busyId === item.id} onClick={() => item.existingLead ? navigate("Ліди") : void convert(item)}>{item.existingLead ? "Відкрити лід" : "Створити лід"}</button>
          <button type="button" onClick={() => navigate("Комунікації")}>Діалог</button>
          <button type="button" className={styles.spam} disabled={busyId === item.id} onClick={() => void spam(item)}>Спам</button>
        </div>
      </article>)}
    </section>
  </div>;
}
