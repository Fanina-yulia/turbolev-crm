"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { WorkOrderListItemContract } from "@/src/lib/contracts/crm-core";
import type { InquiryItemContract as Inquiry, InquiryStatsContract } from "@/src/lib/contracts/inquiries";
import {
  inquiryPayloadMessage,
  parseInquiriesPayload,
  parseInquiryMutationPayload,
} from "@/src/lib/contracts/inquiries-payload.parsers";
import { parseWorkOrderListPayload } from "@/src/lib/contracts/work-order-payload.parsers";
import { ClientCommunicationActions } from "./client-communication-actions";
import { navigateCrm } from "./crm-route";
import { VehicleRender } from "./vehicle-render";
import styles from "./new-inquiries.module.css";
import flowStyles from "./new-inquiries-client-flow.module.css";

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
const WORK_ORDER_JOURNEY = ["Приймання", "Діагностика", "Підготовка", "Погодження", "Ремонт", "QC", "Видача"] as const;
const TERMINAL_WORK_ORDER_STATUSES = new Set(["CLOSED", "CANCELLED"]);

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
function normalizePlate(value?: string | null) { return String(value || "").toUpperCase().replace(/[^A-ZА-ЯІЇЄ0-9]/g, ""); }
function activeWorkOrderFor(item: Inquiry, workOrders: WorkOrderListItemContract[]) {
  if (!item.existingClient || item.vehicles.length === 0) return null;
  const vehicleIds = new Set(item.vehicles.map((vehicle) => vehicle.id));
  const candidates = workOrders
    .filter((workOrder) => vehicleIds.has(workOrder.vehicle.id) && !TERMINAL_WORK_ORDER_STATUSES.has(workOrder.status))
    .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime());
  if (!candidates.length) return null;
  const plate = normalizePlate(item.plate);
  if (plate) {
    const matched = candidates.find((workOrder) => normalizePlate(workOrder.vehicle.plateNumber) === plate);
    if (matched) return matched;
  }
  return candidates[0];
}
function primaryVehicle(item: Inquiry, activeWorkOrder?: WorkOrderListItemContract | null) {
  if (activeWorkOrder) {
    const active = item.vehicles.find((vehicle) => vehicle.id === activeWorkOrder.vehicle.id);
    if (active) return active;
  }
  const plate = normalizePlate(item.plate);
  if (plate) {
    const matched = item.vehicles.find((vehicle) => normalizePlate(vehicle.plateNumber) === plate);
    if (matched) return matched;
  }
  return item.vehicles[0] || null;
}
function vehicleLabel(item: Inquiry) {
  const matched = primaryVehicle(item);
  if (matched) return [matched.brand, matched.model, matched.year].filter(Boolean).join(" ") || "Автомобіль";
  return item.vehicle || "Авто не визначено";
}
function plateLabel(item: Inquiry, activeWorkOrder?: WorkOrderListItemContract | null) { return primaryVehicle(item, activeWorkOrder)?.plateNumber || item.plate || "Номер не вказано"; }
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
function workOrderJourneyIndex(status: string) {
  if (status === "PARTS_REVIEW" || status === "WAITING_PARTS") return 2;
  if (status === "WAITING_APPROVAL") return 3;
  if (["READY_FOR_REPAIR", "IN_REPAIR", "PAUSED", "REWORK"].includes(status)) return 4;
  if (status === "WAITING_QC") return 5;
  if (status === "READY_FOR_PICKUP" || status === "WAITING_PAYMENT") return 6;
  return 2;
}
function workOrderNeedsAttention(status: string) { return status === "PAUSED" || status === "REWORK"; }

export function NewInquiries() {
  const [items, setItems] = useState<Inquiry[]>([]);
  const [workOrders, setWorkOrders] = useState<WorkOrderListItemContract[]>([]);
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
      const [response, workOrderResponse] = await Promise.all([
        fetch("/api/inquiries", { cache: "no-store" }),
        fetch("/api/work-orders", { cache: "no-store" }).catch(() => null),
      ]);
      const raw: unknown = await response.json().catch(() => null);
      const body = parseInquiriesPayload(raw);
      if (!response.ok || !body) throw new Error(inquiryPayloadMessage(raw, "Не вдалося завантажити звернення"));
      setItems(body.items); setStats(body.stats);

      if (workOrderResponse?.ok) {
        const rawWorkOrders: unknown = await workOrderResponse.json().catch(() => null);
        const parsed = parseWorkOrderListPayload(rawWorkOrders);
        setWorkOrders(parsed?.workOrders ?? []);
      } else {
        setWorkOrders([]);
      }
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
  const selectedWorkOrder = useMemo(() => selected ? activeWorkOrderFor(selected, workOrders) : null, [selected, workOrders]);
  const selectedVehicle = selected ? primaryVehicle(selected, selectedWorkOrder) : null;

  function openRequest(item: Inquiry) {
    const workOrder = activeWorkOrderFor(item, workOrders);
    const vehicle = primaryVehicle(item, workOrder);
    window.dispatchEvent(new CustomEvent("turbolev:open-new-request", {
      detail: {
        name: item.existingClient?.name || item.name || "",
        phone: item.phone || "",
        source: requestSource(item),
        plate: vehicle?.plateNumber || item.plate || "",
        vin: vehicle?.vin || "",
        inquiryId: item.id,
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
      navigateCrm("Активні");
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
      <div><strong>{stats?.withActiveLead ?? 0}</strong><span>вже мають активну заявку</span></div>
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
              <span className={styles.queueMeta}><span className={`${styles.channelBadge} ${styles[`channel${item.channel}`] || ""}`}>{channelIcon[item.channel] || "•"} {channelLabel[item.channel] || item.channel}</span>{item.existingClient && <span className={styles.clientBadge}>Постійний клієнт</span>}{item.existingLead && <span className={styles.leadBadge}>Є активна заявка</span>}<span className={styles.processHint}>Опрацювати →</span></span>
            </button>;
          })}
        </div>
      </aside>

      <main className={styles.detailPane}>
        {!selected ? <div className={styles.detailEmpty}><strong>Оберіть звернення</strong><span>Праворуч з’явиться клієнт і швидкі дії.</span></div> : <>
          <div className={styles.detailHeader}>
            <div className={flowStyles.detailHeaderMain}>
              {selected.existingClient ? <button type="button" className={flowStyles.clientIdentityButton} onClick={() => navigateCrm("Клієнти", { clientId: selected.existingClient!.id })} title="Відкрити картку клієнта">
                <span className={styles.avatar}>{(selected.name || "?").trim().charAt(0).toLocaleUpperCase("uk-UA") || "?"}</span>
                <span className={flowStyles.clientIdentityCopy}><span className={flowStyles.clientIdentityOverline}>ЗВЕРНЕННЯ · {timeLabel(selected.receivedAt)}</span><strong>{selected.name || "Без імені"}</strong><small>{contactLabel(selected)}</small></span>
              </button> : <div className={styles.personBlock}>
                <span className={styles.avatar}>{(selected.name || "?").trim().charAt(0).toLocaleUpperCase("uk-UA") || "?"}</span>
                <div><p className={styles.detailOverline}>ЗВЕРНЕННЯ · {timeLabel(selected.receivedAt)}</p><h2>{selected.name || "Без імені"}</h2><span>{contactLabel(selected)}</span></div>
              </div>}

              {selected.existingClient && <div className={flowStyles.headerQuickActions}>
                <ClientCommunicationActions clientId={selected.existingClient.id} vehicleId={selectedVehicle?.id} phone={selected.phone} />
                <button type="button" className={flowStyles.headerCommunicationsButton} onClick={() => navigateCrm("Комунікації", { clientId: selected.existingClient!.id })}>Комунікації →</button>
              </div>}
            </div>
            <details className={styles.moreMenu}><summary aria-label="Додаткові дії">•••</summary><div><button type="button" className={styles.spamAction} disabled={busyId === selected.id} onClick={() => void spam(selected)}>Позначити як спам</button></div></details>
          </div>

          {selected.existingClient ? <>
            <section className={flowStyles.reasonCompact}>
              <div><span>{selected.subject || "Нове звернення"}</span><small>{timeLabel(selected.receivedAt)} · {channelLabel[selected.channel] || selected.channel}</small></div>
              <p>{selected.preview || "Опис звернення відсутній."}</p>
            </section>

            {selectedVehicle ? <button type="button" className={flowStyles.vehicleFocus} onClick={() => navigateCrm("Авто", { vehicleId: selectedVehicle.id })} title="Відкрити картку автомобіля">
              <span className={flowStyles.vehicleVisual}><VehicleRender id={selectedVehicle.id} brand={selectedVehicle.brand} model={selectedVehicle.model} year={selectedVehicle.year} size="card" eager /></span>
              <span className={flowStyles.vehicleCopy}>
                <span className={flowStyles.toolLabel}>Автомобіль клієнта</span>
                <strong className={flowStyles.vehicleTitle}>{[selectedVehicle.brand, selectedVehicle.model, selectedVehicle.year].filter(Boolean).join(" ") || "Автомобіль"}</strong>
                <span className={flowStyles.vehiclePlate}>{plateLabel(selected, selectedWorkOrder)}</span>
                {selectedVehicle.vin && <small>VIN {selectedVehicle.vin}</small>}
                <span className={flowStyles.vehicleOpenHint}>Відкрити картку авто →</span>
              </span>
            </button> : <section className={flowStyles.vehicleFocusMissing}><strong>Автомобіль не визначено</strong><span>У клієнта не знайдено прив’язаного авто.</span></section>}

            {selectedWorkOrder && <section className={`${flowStyles.vehicleJourney} ${workOrderNeedsAttention(selectedWorkOrder.status) ? flowStyles.vehicleJourneyAttention : ""}`}>
              <div className={flowStyles.journeyHeader}><div><span>Авто зараз у роботі</span><strong>{selectedWorkOrder.statusLabel}</strong></div><button type="button" onClick={() => navigateCrm("Замовлення-наряди", { workOrderId: selectedWorkOrder.id })}>Наряд →</button></div>
              <div className={flowStyles.journeySteps} aria-label={`Поточний етап: ${selectedWorkOrder.statusLabel}`}>
                {WORK_ORDER_JOURNEY.map((label, index) => {
                  const current = workOrderJourneyIndex(selectedWorkOrder.status);
                  const stateClass = index < current ? flowStyles.journeyComplete : index === current ? flowStyles.journeyCurrent : flowStyles.journeyFuture;
                  return <span key={label} className={`${flowStyles.journeyStep} ${stateClass}`}><i>{index < current ? "✓" : index === current ? "●" : "○"}</i><b>{label}</b></span>;
                })}
              </div>
            </section>}

            <section className={flowStyles.singleActionHub}>
              {selectedWorkOrder ? <button type="button" className={flowStyles.singlePrimaryAction} onClick={() => navigateCrm("Замовлення-наряди", { workOrderId: selectedWorkOrder.id })}>Відкрити поточний наряд →</button>
                : selected.existingLead ? <button type="button" className={flowStyles.singlePrimaryAction} onClick={() => navigateCrm("Активні")}>Відкрити активну заявку →</button>
                  : <button type="button" className={flowStyles.singlePrimaryAction} onClick={() => openRequest(selected)}>+ Створити замовлення</button>}
            </section>
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
