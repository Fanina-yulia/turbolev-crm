"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ClientCardDrawer } from "./client-card-drawer";
import styles from "./communications-contact-inbox.module.css";
import {
  buildCommunicationConversations,
  type CommunicationChannel as Channel,
  type CommunicationConversation,
  type CommunicationInquiry as Inquiry,
  type CommunicationInquiryState as InquiryState,
  type CommunicationMessage as Message,
} from "@/src/domain/communications-inbox";

type Filter = "ALL" | "NEW" | "NEEDS_REPLY" | "MISSED" | "MESSAGES" | Channel;
type BinotelHealth = { ok: boolean; databaseConfigured: boolean; restConfigured: boolean; webhookTokenConfigured: boolean; websocketConfigured: boolean; companyIdConfigured: boolean; webhookPath: string; missing: string[]; optionalMissing: string[] };

const LOCAL_KEY = "turbolev-communications-v1";
const channels: Channel[] = ["INSTAGRAM", "FACEBOOK", "TIKTOK", "BINOTEL", "OLX", "WEBSITE"];
const channelMeta: Record<Channel, { label: string; short: string; tone: string }> = {
  FACEBOOK: { label: "Facebook", short: "f", tone: "#1877f2" },
  INSTAGRAM: { label: "Instagram", short: "◎", tone: "#e1306c" },
  TIKTOK: { label: "TikTok", short: "♪", tone: "#111827" },
  BINOTEL: { label: "Binotel", short: "☎", tone: "#ff7a00" },
  OLX: { label: "OLX", short: "O", tone: "#23a6a0" },
  WEBSITE: { label: "Сайт", short: "W", tone: "#6366f1" },
};
const integrations = [
  { key: "META", title: "Facebook + Instagram", endpoint: "/api/webhooks/meta", text: "Messenger, Instagram та Meta lead forms" },
  { key: "BINOTEL", title: "Binotel", endpoint: "/api/telephony/binotel-webhook", text: "Вхідні, пропущені дзвінки, CallHistory та записи розмов" },
  { key: "WEBSITE", title: "Сайт / Lead Forms", endpoint: "/api/webhooks/website", text: "Форми сайту та landing pages" },
  { key: "TIKTOK", title: "TikTok", endpoint: "/api/webhooks/tiktok", text: "Lead forms та повідомлення" },
  { key: "OLX", title: "OLX", endpoint: "/api/webhooks/olx", text: "Діалоги та прив'язка до оголошень" },
];

function fmt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const today = new Date();
  const sameDay = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(date) === new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(today);
  return new Intl.DateTimeFormat("uk-UA", sameDay ? { hour: "2-digit", minute: "2-digit" } : { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date);
}
function fmtLong(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("uk-UA", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(date);
}
function actionLabel(state: CommunicationConversation["actionState"]) {
  return state === "MISSED" ? "Потрібно передзвонити" : state === "NEW" ? "Нове" : state === "NEEDS_REPLY" ? "Потрібна відповідь" : "Опрацьовано";
}
function messageIsMissed(message: Message) {
  const metadata = message.metadata && typeof message.metadata === "object" ? message.metadata as Record<string, unknown> : null;
  const direct = typeof metadata?.callStatus === "string" ? metadata.callStatus.toUpperCase() : "";
  const nested = metadata?.metadata && typeof metadata.metadata === "object" ? metadata.metadata as Record<string, unknown> : null;
  const nestedStatus = typeof nested?.callStatus === "string" ? nested.callStatus.toUpperCase() : "";
  return direct === "MISSED" || nestedStatus === "MISSED" || message.text.toLocaleLowerCase("uk-UA").includes("пропущен");
}
function searchText(conversation: CommunicationConversation) {
  return [
    conversation.displayName,
    conversation.phone,
    conversation.handle,
    conversation.representative.subject,
    conversation.representative.preview,
    ...conversation.inquiries.flatMap((item) => [item.name, item.phone, item.handle, item.vehicle, item.plate, item.subject, item.preview]),
  ].filter(Boolean).join(" ").toLocaleLowerCase("uk-UA");
}

export function CommunicationsHub() {
  const [items, setItems] = useState<Inquiry[]>([]);
  const [selectedKey, setSelectedKey] = useState("");
  const [filter, setFilter] = useState<Filter>("ALL");
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<"inbox" | "integrations">("inbox");
  const [reply, setReply] = useState("");
  const [toast, setToast] = useState("");
  const [serverMode, setServerMode] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pageSize, setPageSize] = useState<20 | 50 | 100>(20);
  const [binotelHealth, setBinotelHealth] = useState<BinotelHealth | null>(null);
  const [clientCardOpen, setClientCardOpen] = useState(false);
  const messageEndRef = useRef<HTMLDivElement | null>(null);

  const notify = (message: string) => { setToast(message); window.setTimeout(() => setToast(""), 3200); };
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/communications", { cache: "no-store" });
      if (!response.ok) throw new Error();
      const data = await response.json();
      setItems((data.items || []) as Inquiry[]);
      setServerMode(true);
    } catch {
      setServerMode(false);
      try { setItems(JSON.parse(window.localStorage.getItem(LOCAL_KEY) || "[]") as Inquiry[]); }
      catch { setItems([]); }
    } finally { setLoading(false); }
  }, []);
  const loadBinotelHealth = useCallback(async () => {
    try {
      const response = await fetch("/api/telephony/binotel-health", { cache: "no-store" });
      setBinotelHealth(await response.json());
    } catch { setBinotelHealth(null); }
  }, []);

  useEffect(() => { void load(); void loadBinotelHealth(); }, [load, loadBinotelHealth]);
  useEffect(() => { if (!serverMode) try { window.localStorage.setItem(LOCAL_KEY, JSON.stringify(items)); } catch {} }, [items, serverMode]);

  const conversations = useMemo(() => buildCommunicationConversations(items), [items]);
  const selected = useMemo(() => conversations.find((item) => item.key === selectedKey) || null, [conversations, selectedKey]);

  useEffect(() => {
    if (!conversations.length) { if (selectedKey) setSelectedKey(""); return; }
    if (!conversations.some((item) => item.key === selectedKey)) setSelectedKey(conversations[0].key);
  }, [conversations, selectedKey]);
  useEffect(() => { messageEndRef.current?.scrollIntoView({ block: "end" }); }, [selectedKey, items]);

  const counts = useMemo(() => ({
    ALL: conversations.length,
    NEW: conversations.filter((item) => item.unreadCount > 0).length,
    NEEDS_REPLY: conversations.filter((item) => item.actionState === "MISSED" || item.actionState === "NEEDS_REPLY").length,
    MISSED: conversations.filter((item) => item.unresolvedMissedCount > 0).length,
    MESSAGES: conversations.filter((item) => item.hasMessages).length,
  }), [conversations]);
  const visible = useMemo(() => conversations.filter((conversation) => {
    if (filter === "NEW" && conversation.unreadCount === 0) return false;
    if (filter === "NEEDS_REPLY" && !(["MISSED", "NEEDS_REPLY"] as const).includes(conversation.actionState as "MISSED" | "NEEDS_REPLY")) return false;
    if (filter === "MISSED" && conversation.unresolvedMissedCount === 0) return false;
    if (filter === "MESSAGES" && !conversation.hasMessages) return false;
    if (!(["ALL", "NEW", "NEEDS_REPLY", "MISSED", "MESSAGES"] as string[]).includes(filter) && !conversation.channels.includes(filter as Channel)) return false;
    const needle = query.trim().toLocaleLowerCase("uk-UA");
    return !needle || searchText(conversation).includes(needle);
  }), [conversations, filter, query]);
  const displayed = visible.slice(0, pageSize);

  async function patchOne(id: string, data: Partial<Pick<Inquiry, "unread" | "answered" | "state">>) {
    setItems((current) => current.map((item) => item.id === id ? { ...item, ...data } : item));
    if (!serverMode) return true;
    try {
      const response = await fetch(`/api/communications/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(data) });
      return response.ok;
    } catch { return false; }
  }
  async function openConversation(conversation: CommunicationConversation) {
    setSelectedKey(conversation.key);
    setClientCardOpen(false);
    if (!conversation.unreadInquiryIds.length) return;
    const results = await Promise.all(conversation.unreadInquiryIds.map((id) => patchOne(id, { unread: false })));
    if (results.some((ok) => !ok)) notify("Не всі позначки прочитання вдалося синхронізувати");
  }
  async function sendReply() {
    if (!selected || !reply.trim()) return;
    const inquiry = selected.representative;
    const finalText = reply.trim();
    if (!serverMode) {
      const message: Message = { id: `local-${Date.now()}`, direction: "out", text: finalText, at: new Date().toISOString() };
      setItems((current) => current.map((item) => item.id === inquiry.id ? { ...item, messages: [...item.messages, message], answered: true, unread: false, state: item.state === "NEW" ? "IN_WORK" : item.state } : item));
      setReply("");
      return;
    }
    try {
      const response = await fetch(`/api/communications/${inquiry.id}/messages`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: finalText }) });
      if (!response.ok) throw new Error();
      setReply("");
      await load();
      notify(inquiry.channel === "BINOTEL" ? "Відповідь збережено в історії контакту." : "Повідомлення збережено. Доставка залежить від API каналу.");
    } catch { notify("Не вдалося зберегти повідомлення"); }
  }
  async function convertToLead() {
    if (!selected || !serverMode) return notify("Для створення ліда потрібне серверне з'єднання");
    try {
      const response = await fetch(`/api/communications/${selected.representative.id}/convert`, { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Помилка");
      notify(data.linkedExisting ? "Контакт прив'язано до існуючого ліда" : "Лід створено");
      await load();
    } catch (error) { notify(error instanceof Error ? error.message : "Не вдалося створити лід"); }
  }
  function openLead() {
    if (!selected?.existingLeadId) return;
    window.dispatchEvent(new CustomEvent("turbolev:navigate", { detail: { section: "Ліди", filter: selected.existingLeadId, filterLabel: `Лід ${selected.existingLeadId}` } }));
  }
  async function copyPhone() {
    if (!selected?.phone) return;
    try { await navigator.clipboard.writeText(selected.phone); notify("Номер скопійовано"); }
    catch { notify("Не вдалося скопіювати номер"); }
  }

  const filterPills: { key: Filter; label: string; count: number }[] = [
    { key: "ALL", label: "Усі", count: counts.ALL },
    { key: "NEW", label: "Нові", count: counts.NEW },
    { key: "NEEDS_REPLY", label: "Потрібна відповідь", count: counts.NEEDS_REPLY },
    { key: "MISSED", label: "Пропущені", count: counts.MISSED },
    { key: "MESSAGES", label: "Повідомлення", count: counts.MESSAGES },
    ...channels.map((key) => ({ key, label: channelMeta[key].label, count: conversations.filter((item) => item.channels.includes(key)).length })),
  ];

  return <div className={styles.page}>
    {toast && <div className={styles.toast}>{toast}</div>}
    <header className={styles.header}>
      <div><p className={styles.eyebrow}>OMNICHANNEL · CONTACT INBOX</p><h1>Комунікації</h1><p className={styles.subtitle}>Один клієнт — один діалог. Дзвінки та повідомлення зберігаються єдиною хронологією.</p></div>
      <div className={styles.headerRight}><span className={styles.serverBadge} data-ok={serverMode}>{serverMode ? "NEON SERVER" : "LOCAL FALLBACK"}</span><div className={styles.tabs}><button className={tab === "inbox" ? styles.active : ""} onClick={() => setTab("inbox")}>Inbox</button><button className={tab === "integrations" ? styles.active : ""} onClick={() => setTab("integrations")}>Інтеграції</button></div></div>
    </header>

    {tab === "integrations" ? <section className={styles.integrations}>
      <div className={styles.integrationHead}><div><p className={styles.eyebrow}>КАНАЛИ</p><h2>Інтеграції комунікацій</h2></div><span>Підключення каналів керується централізовано.</span></div>
      <div className={styles.integrationGrid}>{integrations.map((item) => <article className={styles.integrationCard} key={item.key}><div className={styles.integrationIcon}>{item.key === "BINOTEL" ? "☎" : item.key[0]}</div><div><strong>{item.title}</strong><p>{item.text}</p><code>{item.endpoint}</code></div><span className={`${styles.integrationState} ${item.key === "BINOTEL" && binotelHealth?.ok ? styles.ready : ""}`}>{item.key === "BINOTEL" && binotelHealth?.ok ? "Підключено" : item.key === "WEBSITE" ? "Endpoint готовий" : "Потрібен доступ"}</span></article>)}</div>
    </section> : <>
      <nav className={styles.filters} aria-label="Фільтри комунікацій">{filterPills.map((item) => <button key={item.key} className={`${styles.filterButton} ${filter === item.key ? styles.active : ""}`} onClick={() => setFilter(item.key)}>{item.label}<span>{item.count}</span></button>)}</nav>
      <section className={styles.shell}>
        <aside className={styles.left}>
          <div className={styles.search}><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Пошук: клієнт, телефон, авто, номер..."/><button onClick={() => void load()} aria-label="Оновити">↻</button></div>
          <div className={styles.listMeta}><span>Показано {displayed.length} із {visible.length} контактів</span><label>по <select value={pageSize} onChange={(event) => setPageSize(Number(event.target.value) as 20 | 50 | 100)}><option value={20}>20</option><option value={50}>50</option><option value={100}>100</option></select></label></div>
          <div className={styles.list}>{loading ? <div className={styles.empty}>Завантаження…</div> : displayed.length === 0 ? <div className={styles.empty}>Немає контактів за цим фільтром.</div> : displayed.map((conversation) => {
            const latestChannel = conversation.representative.channel;
            const selectedRow = selectedKey === conversation.key;
            return <button key={conversation.key} className={`${styles.row} ${selectedRow ? styles.selected : ""} ${conversation.unreadCount ? styles.unread : ""} ${conversation.actionState === "MISSED" ? styles.missed : ""}`} onClick={() => void openConversation(conversation)}>
              <span className={styles.avatar} style={{ background: channelMeta[latestChannel].tone }}>{channelMeta[latestChannel].short}</span>
              <span className={styles.rowMain}>
                <span className={styles.rowTop}><strong>{conversation.displayName}</strong><time>{fmt(conversation.receivedAt)}</time></span>
                <span className={styles.identity}>{conversation.phone || conversation.handle || "Контакт без номера"}</span>
                <em className={styles.source}>{conversation.channels.map((channel) => channelMeta[channel].label).join(" · ")}</em>
                <span className={styles.preview}>{conversation.preview}</span>
                <span className={styles.badges}>
                  {conversation.missedCount > 0 && <span className={`${styles.badge} ${conversation.unresolvedMissedCount ? styles.badgeMissed : ""}`}>☎ {conversation.missedCount} пропущ.</span>}
                  {conversation.unreadCount > 0 && <span className={`${styles.badge} ${styles.badgeUnread}`}>● {conversation.unreadCount} нов.</span>}
                  {conversation.inquiryCount > 1 && <span className={styles.badge}>{conversation.inquiryCount} подій</span>}
                  {conversation.existingLeadId && <span className={styles.badge}>Лід</span>}
                </span>
              </span>
              {(conversation.actionState !== "HANDLED" || conversation.unreadCount > 0) && <i className={styles.attention} aria-label={actionLabel(conversation.actionState)}/>} 
            </button>;
          })}</div>
        </aside>

        <section className={styles.right}>{!selected ? <div className={styles.noSelection}>Оберіть контакт</div> : <>
          <header className={styles.chatHead}>
            <span className={styles.avatar} style={{ background: channelMeta[selected.representative.channel].tone }}>{channelMeta[selected.representative.channel].short}</span>
            <div className={styles.chatIdentity}><h2>{selected.displayName}</h2><p>{selected.phone || selected.handle || "Контакт без номера"} · {selected.inquiryCount} {selected.inquiryCount === 1 ? "подія" : "подій"}</p><div className={styles.channelChips}>{selected.channels.map((channel) => <span className={styles.channelChip} style={{ background: channelMeta[channel].tone }} key={channel}>{channelMeta[channel].label}</span>)}</div><span className={styles.actionState} data-state={selected.actionState}>{actionLabel(selected.actionState)}{selected.actionState === "MISSED" && selected.unresolvedMissedCount > 1 ? ` · ${selected.unresolvedMissedCount}` : ""}</span></div>
            <div className={styles.chatActions}>{selected.phone && <button onClick={() => void copyPhone()}>Копіювати номер</button>}{selected.phone && <button onClick={() => setClientCardOpen(true)}>Картка клієнта</button>}{selected.existingLeadId ? <button className={styles.primaryAction} onClick={openLead}>Відкрити лід</button> : <button className={styles.primaryAction} onClick={() => void convertToLead()}>Створити лід</button>}</div>
          </header>
          <div className={styles.timeline}>
            {selected.inquiryCount > 1 && <div className={styles.conversationSummary}>Об'єднано {selected.inquiryCount} звернень цього контакту · історія не видаляється</div>}
            {selected.timeline.length === 0 ? <div className={styles.empty}>{selected.preview}</div> : selected.timeline.map((message) => <article key={`${message.inquiryId}:${message.id}`} className={`${styles.event} ${styles[message.direction]} ${messageIsMissed(message) ? styles.missedEvent : ""}`}><p>{message.text}</p><footer><span>{channelMeta[message.channel].label}</span><time>{fmtLong(message.at)}</time></footer></article>)}
            <div ref={messageEndRef}/>
          </div>
          <div className={styles.composer}><textarea value={reply} onChange={(event) => setReply(event.target.value)} placeholder="Повідомлення або внутрішня відповідь по контакту..." onKeyDown={(event) => { if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) void sendReply(); }}/><button disabled={!reply.trim()} onClick={() => void sendReply()}>Надіслати</button><span className={styles.composerHint}>Ctrl/⌘ + Enter · відповідь додається до останнього звернення контакту. Фактична доставка залежить від підключеного API каналу.</span></div>
        </>}</section>
      </section>
    </>}

    {selected && <ClientCardDrawer open={clientCardOpen} name={selected.displayName} phone={selected.phone} existingLeadId={selected.existingLeadId} onClose={() => setClientCardOpen(false)} onCreateLead={() => { setClientCardOpen(false); void convertToLead(); }}/>} 
  </div>;
}
