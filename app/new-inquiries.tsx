"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { InquiryItemContract as Inquiry, InquiryStatsContract } from "@/src/lib/contracts/inquiries";
import {
  inquiryPayloadMessage,
  parseInquiriesPayload,
  parseInquiryMutationPayload,
} from "@/src/lib/contracts/inquiries-payload.parsers";
import { ClientCommunicationActions } from "./client-communication-actions";
import { navigateCrm } from "./crm-route";
import { VehicleRender } from "./vehicle-render";
import styles from "./new-inquiries.module.css";

const channelLabel: Record<string, string> = {
  BINOTEL: "Телефон",
  WEBSITE: "Сайт",
  TELEGRAM: "Telegram",
  INSTAGRAM: "Instagram",
  FACEBOOK: "Facebook",
  TIKTOK: "TikTok",
  OLX: "OLX",
};
const channelIcon: Record<string, string> = {
  BINOTEL: "☎",
  WEBSITE: "◉",
  TELEGRAM: "✈",
  INSTAGRAM: "◎",
  FACEBOOK: "f",
  TIKTOK: "♪",
  OLX: "OLX",
};
const priorityWeight: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

const CHANNEL_FILTERS = [
  ["ALL", "Усі"], ["BINOTEL", "Дзвінки"], ["TELEGRAM", "Telegram"], ["WEBSITE", "Сайт"],
  ["INSTAGRAM", "Instagram"], ["FACEBOOK", "Facebook"], ["OLX", "OLX"], ["TIKTOK", "TikTok"],
] as const;
const PRIORITY_FILTERS = [["ALL", "Усі"], ["CRITICAL", "Критичні"], ["HIGH", "Високі"], ["MEDIUM", "Середні"], ["LOW", "Низькі"]] as const;

function timeLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const now = new Date();
  if (date.toDateString() === now.toDateString()) return new Intl.DateTimeFormat("uk-UA", { hour: "2-digit", minute: "2-digit" }).format(date);
  return new Intl.DateTimeFormat("uk-UA", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(date);
}
function waitingMinutes(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 0;
  return Math.max(0, Math.floor((Date.now() - date.getTime()) / 60000));
}
function waitingLabel(value: string) {
  const minutes = waitingMinutes(value);
  if (minutes < 1) return "щойно";
  if (minutes < 60) return `очікує ${minutes} хв`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `очікує ${hours} год ${rest} хв` : `очікує ${hours} год`;
}
function vehicleLabel(item: Inquiry) {
  const matched = item.vehicles[0];
  if (matched) return [matched.brand, matched.model, matched.year].filter(Boolean).join(" ") || "Автомобіль";
  return item.vehicle || "Авто не визначено";
}
function plateLabel(item: Inquiry) { return item.vehicles[0]?.plateNumber || item.plate || "Номер не вказано"; }
function contactLabel(item: Inquiry) { return item.phone || item.handle || "Контакт уточнюється"; }
function sourceLabel(item: Inquiry) { return item.sourceDetail || (item.channel === "BINOTEL" ? "Binotel" : "Пряме звернення"); }
function requestSource(item: Inquiry) {
  if (item.channel === "BINOTEL") return "Binotel";
  if (item.channel === "WEBSITE") return "Сайт";
  if (item.channel === "INSTAGRAM") return "Instagram";
  if (item.channel === "FACEBOOK") return "Facebook";
  if (item.channel === "TIKTOK") return "TikTok";
  if (item.channel === "OLX") return "OLX";
  return "Інше";
}
function todayKey() {
  const date = new Date();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export function NewInquiries() {
  const [items, setItems] = useState<Inquiry[]>([]);
  const [stats, setStats] = useState<InquiryStatsContract | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [channel, setChannel] = useState("ALL");
  const [priority, setPriority] = useState("ALL");
  const [selectedId, setSelectedId] = useState<string | null>(null);

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
      return `${item.name} ${item.phone || ""} ${item.handle || ""} ${item.subject} ${item.preview} ${vehicleLabel(item)} ${plateLabel(item)} ${sourceLabel(item)}`.toLocaleLowerCase("uk-UA").includes(needle);
    }).sort((a, b) => {
      const byPriority = (priorityWeight[a.priority] ?? 9) - (priorityWeight[b.priority] ?? 9);
      if (byPriority !== 0) return byPriority;
      return new Date(a.receivedAt).getTime() - new Date(b.receivedAt).getTime();
    });
  }, [items, channel, priority, search]);

  useEffect(() => {
    if (filtered.length === 0) { if (selectedId) setSelectedId(null); return; }
    if (!selectedId || !filtered.some((item) => item.id === selectedId)) setSelectedId(filtered[0].id);
  }, [filtered, selectedId]);

  const selected = useMemo(() => filtered.find((item) => item.id === selectedId) || filtered[0] || null, [filtered, selectedId]);
  const waitingOver15 = useMemo(() => items.filter((item) => waitingMinutes(item.receivedAt) >= 15).length, [items]);

  function openRequest(item: Inquiry, booking = false) {
    const vehicle = item.vehicles[0];
    window.dispatchEvent(new CustomEvent("turbolev:open-new-request", {
      detail: {
        name: item.existingClient?.name || item.name || "",
        phone: item.phone || "",
        source: requestSource(item),
        plate: vehicle?.plateNumber || item.plate || "",
        vin: vehicle?.vin || "",
        inquiryId: item.id,
        ...(booking ? { appointmentDate: todayKey() } : {}),
      },
    }));
  }

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
      navigateCrm("Ліди");
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
    <header className={styles.header}>
      <div><p className={styles.eyebrow}>ЗВЕРНЕННЯ · РОБОЧЕ МІСЦЕ ДИСПЕТЧЕРА</p><h1>Нові звернення</h1><p>Оберіть звернення в черзі, швидко зрозумійте контекст і виконайте наступну дію.</p></div>
      <button type="button" className={styles.refresh} onClick={() => void load()} disabled={loading}>{loading ? "Оновлюю…" : "Оновити"}</button>
    </header>
    {error && <div className={styles.error}>{error}</div>}

    <section className={styles.summary} aria-label="Показники черги">
      <div><strong>{stats?.total ?? items.length}</strong><span>у черзі</span></div>
      <div className={styles.summaryCritical}><strong>{stats?.critical ?? 0}</strong><span>критичних</span></div>
      <div><strong>{waitingOver15}</strong><span>очікують &gt;15 хв</span></div>
      <div><strong>{stats?.existingClients ?? 0}</strong><span>відомих клієнтів</span></div>
      <div><strong>{stats?.withActiveLead ?? 0}</strong><span>вже мають активний лід</span></div>
    </section>

    <section className={styles.toolbar}>
      <div className={styles.searchWrap}><span aria-hidden="true">⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Клієнт, телефон, авто, проблема…" /></div>
      <div className={styles.filterBlock}><span className={styles.filterLabel}>Канал</span><div className={styles.filterChips}>{CHANNEL_FILTERS.map(([value, label]) => <button type="button" key={value} className={channel === value ? styles.filterActive : ""} onClick={() => setChannel(value)}>{label}</button>)}</div></div>
      <div className={styles.filterBlock}><span className={styles.filterLabel}>Пріоритет</span><div className={styles.filterChips}>{PRIORITY_FILTERS.map(([value, label]) => <button type="button" key={value} className={priority === value ? styles.filterActive : ""} onClick={() => setPriority(value)}>{label}</button>)}</div></div>
    </section>

    <section className={styles.workspace}>
      <aside className={styles.queuePane} aria-label="Черга нових звернень">
        <div className={styles.queueHeader}><div><strong>Черга</strong><span>{filtered.length} звернень за фільтром</span></div><span className={styles.queueHint}>спочатку критичні й найстаріші</span></div>
        <div className={styles.queueList}>
          {loading && items.length === 0 ? <div className={styles.empty}>Завантажуємо нові звернення…</div> : filtered.length === 0 ? <div className={styles.empty}>За цими фільтрами звернень немає.</div> : filtered.map((item) => {
            const isSelected = selected?.id === item.id;
            const wait = waitingMinutes(item.receivedAt);
            return <button type="button" key={item.id} className={`${styles.queueCard} ${isSelected ? styles.queueCardActive : ""}`} onClick={() => setSelectedId(item.id)}>
              <span className={styles.queueTop}><span className={`${styles.priorityDot} ${styles[`priorityDot${item.priority}`] || ""}`}/><strong>{timeLabel(item.receivedAt)}</strong><span className={`${styles.wait} ${wait >= 15 ? styles.waitLate : ""}`}>{waitingLabel(item.receivedAt)}</span></span>
              <span className={styles.queueIdentity}><strong>{item.name || "Без імені"}</strong><small>{contactLabel(item)}</small></span>
              <span className={styles.queueProblem}>{item.subject || "Нове звернення"}</span>
              <span className={styles.queuePreview}>{item.preview || "Без опису"}</span>
              <span className={styles.queueMeta}><span className={`${styles.channelBadge} ${styles[`channel${item.channel}`] || ""}`}>{channelIcon[item.channel] || "•"} {channelLabel[item.channel] || item.channel}</span>{item.existingClient && <span className={styles.clientBadge}>Постійний клієнт</span>}{item.existingLead && <span className={styles.leadBadge}>Є активний лід</span>}<span className={styles.processHint}>Опрацювати →</span></span>
            </button>;
          })}
        </div>
      </aside>

      <main className={styles.detailPane}>
        {!selected ? <div className={styles.detailEmpty}><strong>Оберіть звернення</strong><span>Праворуч з’явиться клієнт і швидкі дії.</span></div> : <>
          <div className={styles.detailHeader}>
            <div className={styles.personBlock}>
              <span className={styles.avatar}>{(selected.name || "?").trim().charAt(0).toLocaleUpperCase("uk-UA") || "?"}</span>
              <div><p className={styles.detailOverline}>ЗВЕРНЕННЯ · {timeLabel(selected.receivedAt)}</p><h2>{selected.name || "Без імені"}</h2><span>{contactLabel(selected)}</span></div>
            </div>
            <details className={styles.moreMenu}><summary aria-label="Додаткові дії">•••</summary><div><button type="button" className={styles.spamAction} disabled={busyId === selected.id} onClick={() => void spam(selected)}>Позначити як спам</button></div></details>
          </div>

          {selected.existingClient ? <>
            <div className={styles.knownClientTools}>
              <div><span className={styles.toolLabel}>Швидкий зв’язок</span><ClientCommunicationActions clientId={selected.existingClient.id} vehicleId={selected.vehicles[0]?.id} phone={selected.phone} /></div>
              <button type="button" className={styles.communicationButton} onClick={() => navigateCrm("Комунікації", { clientId: selected.existingClient!.id })}>Комунікації →</button>
            </div>

            <section className={styles.reasonCompact}>
              <div><span>{selected.subject || "Нове звернення"}</span><small>{timeLabel(selected.receivedAt)} · {channelLabel[selected.channel] || selected.channel}</small></div>
              <p>{selected.preview || "Опис звернення відсутній."}</p>
            </section>

            <section className={styles.vehicleFocus}>
              {selected.vehicles[0] ? <>
                <div className={styles.vehicleVisual}><VehicleRender id={selected.vehicles[0].id} brand={selected.vehicles[0].brand} model={selected.vehicles[0].model} year={selected.vehicles[0].year} size="card" eager /></div>
                <div className={styles.vehicleCopy}>
                  <span className={styles.toolLabel}>Автомобіль клієнта</span>
                  <h3>{vehicleLabel(selected)}</h3>
                  <strong>{plateLabel(selected)}</strong>
                  {selected.vehicles[0].vin && <small>VIN {selected.vehicles[0].vin}</small>}
                </div>
                <button type="button" className={styles.vehicleCardButton} onClick={() => navigateCrm("Авто", { vehicleId: selected.vehicles[0]!.id })}>Карта авто →</button>
              </> : <div className={styles.vehicleMissing}><strong>Автомобіль не визначено</strong><span>Відкрийте картку клієнта, щоб вибрати або додати авто.</span></div>}
            </section>

            <section className={styles.actionHub}>
              <button type="button" className={styles.newOrderAction} onClick={() => openRequest(selected)}>+ Нове замовлення</button>
              <button type="button" className={styles.bookingAction} onClick={() => openRequest(selected, true)}>Записати на СТО</button>
            </section>

            <div className={styles.utilityActions}>
              <button type="button" onClick={() => navigateCrm("Клієнти", { clientId: selected.existingClient!.id })}>Картка клієнта</button>
              {selected.vehicles[0] && <button type="button" onClick={() => navigateCrm("Авто", { vehicleId: selected.vehicles[0]!.id })}>Картка авто</button>}
              {selected.existingLead && <button type="button" onClick={() => navigateCrm("Ліди")}>Активна заявка</button>}
            </div>
          </> : <>
            <section className={styles.reasonCard}>
              <p>Що сталося</p><h3>{selected.subject || "Нове звернення"}</h3><span>{selected.preview || "Опис звернення відсутній."}</span>
            </section>
            <section className={styles.newContactPanel}>
              <div><strong>Новий контакт</strong><span>Створіть клієнта або прийміть звернення в роботу.</span></div>
              <div className={styles.primaryActions}>
                {selected.channel === "BINOTEL" && selected.phone ? <a className={styles.mainAction} href={`tel:${selected.phone}`}>☎ Передзвонити</a> : <button type="button" className={styles.mainAction} onClick={() => navigateCrm("Комунікації")}>Відкрити діалог</button>}
                <button type="button" className={styles.acceptAction} disabled={busyId === selected.id} onClick={() => void accept(selected)}>{busyId === selected.id ? "Обробляю…" : "✓ Прийняти"}</button>
                <button type="button" className={styles.createLeadAction} disabled={busyId === selected.id} onClick={() => void convert(selected)}>Створити клієнта / заявку</button>
              </div>
            </section>
          </>}
        </>}
      </main>
    </section>
  </div>;
}