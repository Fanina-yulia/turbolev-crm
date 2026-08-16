"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ClientCardDrawer } from "./client-card-drawer";
import { CommunicationsVehicleCardDrawer } from "./communications-vehicle-card-drawer";
import { VehicleBrandLogo } from "./vehicle-brand-logo";
import styles from "./communications-contact-inbox.module.css";
import {
  buildCommunicationConversations,
  type CommunicationChannel as Channel,
  type CommunicationConversation,
  type CommunicationInquiry as Inquiry,
  type CommunicationMessage as Message,
} from "@/src/domain/communications-inbox";

type Filter = "ALL" | "NEW" | "NEEDS_REPLY" | "MISSED" | "MESSAGES" | Channel;
type BinotelHealth = { ok: boolean; databaseConfigured: boolean; restConfigured: boolean; webhookTokenConfigured: boolean; websocketConfigured: boolean; companyIdConfigured: boolean; webhookPath: string; missing: string[]; optionalMissing: string[] };
type LinkedVehicle = { id: string; plateNumber?: string | null; vin?: string | null; brand?: string | null; model?: string | null; year?: number | null };
type LinkedClientCard = { id: string; name?: string | null; phone: string; vehicles: LinkedVehicle[] };

const LOCAL_KEY = "turbolev-communications-v1";
const channels: Channel[] = ["INSTAGRAM", "FACEBOOK", "TIKTOK", "BINOTEL", "OLX", "WEBSITE"];
const emojis = ["😀","😊","👍","❤️","🔥","✅","🙏","😉","😂","🚗","🔧","📍","☎️","💬","👌","🎯"];
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
  const dayFormatter = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" });
  const sameDay = dayFormatter.format(date) === dayFormatter.format(today);
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
function vehicleTitle(vehicle: LinkedVehicle) {
  return [vehicle.brand, vehicle.model].filter(Boolean).join(" ") || "Автомобіль";
}

export function CommunicationsHub() {
  const [items, setItems] = useState<Inquiry[]>([]);
  const [selectedKey, setSelectedKey] = useState("");
  const [filter, setFilter] = useState<Filter>("ALL");
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<"inbox" | "integrations">("inbox");
  const [reply, setReply] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [serverMode, setServerMode] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pageSize, setPageSize] = useState<20 | 50 | 100>(20);
  const [binotelHealth, setBinotelHealth] = useState<BinotelHealth | null>(null);
  const [clientCardOpen, setClientCardOpen] = useState(false);
  const [linkedClient, setLinkedClient] = useState<LinkedClientCard | null>(null);
  const [vehicleCardId, setVehicleCardId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
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
  const linkedVehicle = linkedClient?.vehicles?.[0] || null;

  useEffect(() => {
    if (!conversations.length) { if (selectedKey) setSelectedKey(""); return; }
    if (!conversations.some((item) => item.key === selectedKey)) setSelectedKey(conversations[0].key);
  }, [conversations, selectedKey]);
  useEffect(() => { messageEndRef.current?.scrollIntoView({ block: "end" }); }, [selectedKey, items]);
  useEffect(() => {
    const phone = selected?.phone;
    setLinkedClient(null);
    if (!phone) return;
    let active = true;
    const loadCard = async () => {
      try {
        const response = await fetch(`/api/client-card?phone=${encodeURIComponent(phone)}`, { cache: "no-store" });
        if (!response.ok) return;
        const data = await response.json() as { client?: LinkedClientCard | null };
        if (active) setLinkedClient(data.client || null);
      } catch {
        if (active) setLinkedClient(null);
      }
    };
    const refresh = () => { void loadCard(); };
    void loadCard();
    window.addEventListener("turbolev:data-changed", refresh);
    return () => { active = false; window.removeEventListener("turbolev:data-changed", refresh); };
  }, [selected?.phone]);

  const counts = useMemo(() => ({
    ALL: conversations.length,
    NEW: conversations.filter((item) => item.unreadCount > 0).length,
    NEEDS_REPLY: conversations.filter((item) => item.actionState === "MISSED" || item.actionState === "NEEDS_REPLY").length,
    MISSED: conversations.filter((item) => item.unresolvedMissedCount > 0).length,
    MESSAGES: conversations.filter((item) => item.hasMessages).length,
  }), [conversations]);
  const visible = useMemo(() => conversations.filter((conversation) => {
    if (filter === "NEW" && conversation.unreadCount === 0) return false;
    if (filter === "NEEDS_REPLY" && conversation.actionState !== "MISSED" && conversation.actionState !== "NEEDS_REPLY") return false;
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
    setVehicleCardId(null);
    setFiles([]);
    setEmojiOpen(false);
    if (!conversation.unreadInquiryIds.length) return;
    const results = await Promise.all(conversation.unreadInquiryIds.map((id) => patchOne(id, { unread: false })));
    if (results.some((ok) => !ok)) notify("Не всі позначки прочитання вдалося синхронізувати");
  }
  async function sendReply() {
    if (!selected || (!reply.trim() && files.length === 0)) return;
    const inquiry = selected.representative;
    const attachmentText = files.length ? `\n${files.map((file) => `📎 ${file.name}`).join("\n")}` : "";
    const finalText = `${reply.trim()}${attachmentText}`.trim();
    const attachments = files.map((file) => ({ name: file.name, type: file.type, size: file.size }));
    if (!serverMode) {
      const message: Message = { id: `local-${Date.now()}`, direction: "out", text: finalText, at: new Date().toISOString(), metadata: { attachments } };
      setItems((current) => current.map((item) => item.id === inquiry.id ? { ...item, messages: [...item.messages, message], answered: true, unread: false, state: item.state === "NEW" ? "IN_WORK" : item.state } : item));
      setReply(""); setFiles([]); setEmojiOpen(false);
      return;
    }
    try {
      const response = await fetch(`/api/communications/${inquiry.id}/messages`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: finalText, attachments }) });
      if (!response.ok) throw new Error();
      setReply(""); setFiles([]); setEmojiOpen(false);
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
            <button type="button" className={styles.contactSummary} disabled={!selected.phone} onClick={() => selected.phone && setClientCardOpen(true)} title={selected.phone ? "Відкрити картку контакту" : undefined}>
              <span className={styles.avatar} style={{ background: channelMeta[selected.representative.channel].tone }}>{channelMeta[selected.representative.channel].short}</span>
              <span className={styles.contactText}><strong>{linkedClient?.name?.trim() || selected.displayName}</strong><small>{selected.phone || selected.handle || "Контакт без номера"}</small></span>
              {selected.phone && <span className={styles.openHint}>Картка ›</span>}
            </button>
            <div className={styles.contactChannels}><span className={styles.metaLabel}>Канал зв’язку</span><div className={styles.channelChips}>{selected.channels.map((channel) => <span className={styles.channelChip} style={{ background: channelMeta[channel].tone }} key={channel}>{channelMeta[channel].label}</span>)}</div></div>
            {linkedVehicle && <button type="button" className={styles.vehicleSummary} onClick={() => setVehicleCardId(linkedVehicle.id)} title="Відкрити картку автомобіля">
              <VehicleBrandLogo brand={linkedVehicle.brand} size={38}/>
              <span className={styles.vehicleText}><strong>{vehicleTitle(linkedVehicle)}</strong><small>{linkedVehicle.plateNumber || linkedVehicle.vin || "Без держномера"}</small></span>
              {linkedClient && linkedClient.vehicles.length > 1 && <em>+{linkedClient.vehicles.length - 1}</em>}
              <i>›</i>
            </button>}
          </header>
          <div className={styles.timeline}>
            {selected.inquiryCount > 1 && <div className={styles.conversationSummary}>Об'єднано {selected.inquiryCount} звернень цього контакту · історія не видаляється</div>}
            {selected.timeline.length === 0 ? <div className={styles.empty}>{selected.preview}</div> : selected.timeline.map((message) => <article key={`${message.inquiryId}:${message.id}`} className={`${styles.event} ${styles[message.direction]} ${messageIsMissed(message) ? styles.missedEvent : ""}`}><p>{message.text}</p><footer><span>{channelMeta[message.channel].label}</span><time>{fmtLong(message.at)}</time></footer></article>)}
            <div ref={messageEndRef}/>
          </div>
          <div className={`${styles.composer} communicationsComposer`}>
            {files.length > 0 && <div className="communicationsFileChips">{files.map((file, index) => <span key={`${file.name}-${index}`}>📎 {file.name}<button type="button" onClick={() => setFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))}>×</button></span>)}</div>}
            {emojiOpen && <div className="communicationsEmojiPicker">{emojis.map((emoji) => <button type="button" key={emoji} onClick={() => { setReply((current) => current + emoji); setEmojiOpen(false); }}>{emoji}</button>)}</div>}
            <div className="communicationsComposeRow">
              <input ref={fileInputRef} type="file" multiple hidden onChange={(event) => { setFiles((current) => [...current, ...Array.from(event.target.files || [])].slice(0, 8)); event.currentTarget.value = ""; }}/>
              <button type="button" className="communicationsToolButton" onClick={() => fileInputRef.current?.click()} title="Додати файл">📎</button>
              <textarea value={reply} onChange={(event) => setReply(event.target.value)} placeholder="Повідомлення або внутрішня відповідь по контакту..." onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void sendReply(); } }}/>
              <button type="button" className="communicationsToolButton" onClick={() => setEmojiOpen((current) => !current)} title="Emoji">☺</button>
              <button type="button" className="communicationsToolButton" onClick={() => notify("Голосові повідомлення підключимо разом з API каналу") } title="Голосове повідомлення">🎙</button>
              <button type="button" className="communicationsSendButton" disabled={!reply.trim() && files.length === 0} onClick={() => void sendReply()}>➤</button>
            </div>
            <span className={styles.composerHint}>Enter — надіслати · Shift+Enter — новий рядок. Відповідь додається до останнього звернення контакту; фактична доставка залежить від API каналу.</span>
          </div>
        </>}</section>
      </section>
    </>}

    {selected && <ClientCardDrawer open={clientCardOpen} name={linkedClient?.name?.trim() || selected.displayName} phone={selected.phone} existingLeadId={selected.existingLeadId} onClose={() => setClientCardOpen(false)} onCreateLead={() => { setClientCardOpen(false); void convertToLead(); }}/>} 
    <CommunicationsVehicleCardDrawer vehicleId={vehicleCardId} onClose={() => setVehicleCardId(null)}/>
    <style jsx global>{`
      .communicationsComposer{display:block!important;position:relative}
      .communicationsFileChips{display:flex;gap:6px;flex-wrap:wrap;margin:0 0 8px}.communicationsFileChips>span{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--line);border-radius:999px;background:var(--surface);padding:5px 8px;color:var(--muted);font-size:8px}.communicationsFileChips button{width:18px!important;height:18px!important;padding:0!important;border:0!important;border-radius:50%!important;background:transparent!important;color:var(--muted)!important}
      .communicationsEmojiPicker{position:absolute;left:12px;bottom:76px;z-index:5;width:220px;display:grid;grid-template-columns:repeat(8,1fr);gap:3px;border:1px solid var(--line);border-radius:12px;background:var(--panel);padding:8px;box-shadow:0 14px 34px rgba(0,0,0,.16)}.communicationsEmojiPicker button{width:25px!important;height:25px!important;padding:0!important;border:0!important;background:transparent!important;color:var(--text)!important;font-size:15px!important}
      .communicationsComposeRow{display:grid;grid-template-columns:36px minmax(0,1fr) 36px 36px 44px;gap:7px;align-items:end}.communicationsComposeRow textarea{min-height:42px!important;max-height:100px}.communicationsComposeRow button{height:42px!important;padding:0!important}.communicationsToolButton{border:1px solid var(--line)!important;background:var(--surface)!important;color:var(--text)!important;border-radius:10px!important;font-size:15px!important}.communicationsSendButton{border:0!important;background:var(--orange)!important;color:#fff!important;border-radius:10px!important;font-size:15px!important}.communicationsSendButton:disabled{opacity:.4}
    `}</style>
  </div>;
}