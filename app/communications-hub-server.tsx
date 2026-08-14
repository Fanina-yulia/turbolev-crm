"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Channel = "FACEBOOK" | "INSTAGRAM" | "TIKTOK" | "BINOTEL" | "OLX" | "WEBSITE";
type Filter = "ALL" | "UNREAD" | "NO_REPLY" | Channel;
type InquiryState = "NEW" | "IN_WORK" | "CONVERTED" | "LINKED" | "SPAM";
type Message = { id: string; direction: "in" | "out" | "system"; text: string; at: string; metadata?: unknown };
type Inquiry = {
  id: string;
  channel: Channel;
  state: InquiryState;
  name: string;
  phone?: string;
  handle?: string;
  subject: string;
  preview: string;
  vehicle?: string;
  plate?: string;
  unread: boolean;
  answered: boolean;
  receivedAt: string;
  sourceDetail?: string;
  campaign?: string;
  utm?: string;
  existingLeadId?: string;
  duplicateLead?: { id: string; name?: string | null } | null;
  messages: Message[];
};

const LOCAL_KEY = "turbolev-communications-v1";
const channelMeta: Record<Channel, { label: string; short: string; tone: string }> = {
  FACEBOOK: { label: "Facebook", short: "f", tone: "#1877f2" },
  INSTAGRAM: { label: "Instagram", short: "◎", tone: "#e1306c" },
  TIKTOK: { label: "TikTok", short: "♪", tone: "#25f4ee" },
  BINOTEL: { label: "Binotel", short: "☎", tone: "#ff7a00" },
  OLX: { label: "OLX", short: "O", tone: "#23e5db" },
  WEBSITE: { label: "Сайт", short: "W", tone: "#7c8cff" },
};

const integrations = [
  { key: "META", title: "Facebook + Instagram", endpoint: "/api/webhooks/meta", text: "Messenger, Instagram та Meta lead forms", status: "Потрібні Meta App, токен сторінки і verify token" },
  { key: "BINOTEL", title: "Binotel", endpoint: "/api/webhooks/binotel", text: "Пропущені дзвінки → звернення; історія дзвінків", status: "Потрібні API key/secret і webhook у Binotel" },
  { key: "WEBSITE", title: "Сайт / Lead Forms", endpoint: "/api/webhooks/website", text: "Форми сайту та landing pages", status: "CRM endpoint готовий до POST" },
  { key: "TIKTOK", title: "TikTok", endpoint: "/api/webhooks/tiktok", text: "Lead forms / події акаунта", status: "Потрібен TikTok Business/Developer access" },
  { key: "OLX", title: "OLX", endpoint: "/api/webhooks/olx", text: "Діалоги та прив'язка до оголошень", status: "Потрібен доступ OLX API" },
];

function fmt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const today = new Date();
  return new Intl.DateTimeFormat("uk-UA", date.toDateString() === today.toDateString() ? { hour: "2-digit", minute: "2-digit" } : { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date);
}

function stateLabel(state: InquiryState) {
  return state === "NEW" ? "Нове" : state === "IN_WORK" ? "В роботі" : state === "CONVERTED" ? "Лід створено" : state === "LINKED" ? "Прив'язано" : "Спам";
}

export function CommunicationsHub() {
  const [items, setItems] = useState<Inquiry[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [filter, setFilter] = useState<Filter>("ALL");
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<"inbox" | "integrations">("inbox");
  const [reply, setReply] = useState("");
  const [toast, setToast] = useState("");
  const [serverMode, setServerMode] = useState(false);
  const [loading, setLoading] = useState(true);

  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 3200);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/communications", { cache: "no-store" });
      if (!response.ok) throw new Error("server unavailable");
      const data = await response.json();
      const next = (data.items || []) as Inquiry[];
      setItems(next);
      setServerMode(true);
      setSelectedId((current) => next.some((x) => x.id === current) ? current : next[0]?.id || "");
    } catch {
      setServerMode(false);
      try {
        const local = JSON.parse(window.localStorage.getItem(LOCAL_KEY) || "[]") as Inquiry[];
        setItems(local);
        setSelectedId((current) => local.some((x) => x.id === current) ? current : local[0]?.id || "");
      } catch {
        setItems([]);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!serverMode) {
      try { window.localStorage.setItem(LOCAL_KEY, JSON.stringify(items)); } catch {}
    }
  }, [items, serverMode]);

  const selected = items.find((x) => x.id === selectedId);
  const counts = useMemo(() => ({
    ALL: items.filter((x) => x.state !== "SPAM").length,
    UNREAD: items.filter((x) => x.unread && x.state !== "SPAM").length,
    NO_REPLY: items.filter((x) => !x.answered && x.state !== "SPAM").length,
  }), [items]);

  const visible = useMemo(() => items.filter((item) => {
    if (item.state === "SPAM") return false;
    if (filter === "UNREAD" && !item.unread) return false;
    if (filter === "NO_REPLY" && item.answered) return false;
    if (!["ALL","UNREAD","NO_REPLY"].includes(filter) && item.channel !== filter) return false;
    const hay = `${item.name} ${item.phone || ""} ${item.handle || ""} ${item.subject} ${item.vehicle || ""} ${item.plate || ""}`.toLowerCase();
    return hay.includes(query.trim().toLowerCase());
  }).sort((a,b) => +new Date(b.receivedAt) - +new Date(a.receivedAt)), [items, filter, query]);

  const filters: { key: Filter; label: string; count: number }[] = [
    { key: "ALL", label: "Усі звернення", count: counts.ALL },
    { key: "UNREAD", label: "Непрочитані", count: counts.UNREAD },
    { key: "NO_REPLY", label: "Без відповіді", count: counts.NO_REPLY },
    ...(["INSTAGRAM","FACEBOOK","TIKTOK","BINOTEL","OLX","WEBSITE"] as Channel[]).map((key) => ({ key, label: channelMeta[key].label, count: items.filter((x) => x.channel === key && x.state !== "SPAM").length })),
  ];

  async function patch(id: string, data: Partial<Pick<Inquiry,"unread"|"answered"|"state">>) {
    setItems((current) => current.map((x) => x.id === id ? { ...x, ...data } : x));
    if (!serverMode) return;
    try {
      await fetch(`/api/communications/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(data) });
    } catch { notify("Не вдалося зберегти зміну на сервері"); }
  }

  function openInquiry(id: string) {
    setSelectedId(id);
    void patch(id, { unread: false });
  }

  async function convertToLead() {
    if (!selected) return;
    if (!serverMode) {
      notify("Серверна БД ще не активована. Після міграції конвертація піде в Neon.");
      return;
    }
    try {
      const response = await fetch(`/api/communications/${selected.id}/convert`, { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Помилка");
      notify(data.linkedExisting ? `Прив'язано до існуючого ліда ${data.lead.id}` : `Створено лід ${data.lead.id}`);
      await load();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Не вдалося створити лід");
    }
  }

  async function sendReply() {
    if (!selected || !reply.trim()) return;
    if (!serverMode) {
      const message: Message = { id: `local-${Date.now()}`, direction: "out", text: reply.trim(), at: new Date().toISOString() };
      setItems((current) => current.map((x) => x.id === selected.id ? { ...x, messages: [...x.messages, message], answered: true, state: x.state === "NEW" ? "IN_WORK" : x.state } : x));
      setReply("");
      return;
    }
    try {
      const response = await fetch(`/api/communications/${selected.id}/messages`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: reply.trim() }) });
      if (!response.ok) throw new Error("Не вдалося зберегти повідомлення");
      setReply("");
      notify("Повідомлення збережено в CRM. Відправка в канал запрацює після підключення його API.");
      await load();
    } catch (error) { notify(error instanceof Error ? error.message : "Помилка"); }
  }

  const navigateToLeads = () => window.dispatchEvent(new CustomEvent("turbolev:navigate", { detail: "Ліди" }));

  return <div className="commsPage">
    {toast && <div className="commsToast">{toast}</div>}
    <header className="commsTop">
      <div><p className="eyebrow">OMNICHANNEL · ЄДИНА ТОЧКА ВХОДУ</p><h1>Комунікації</h1><p>Канал → звернення → дедуп → лід → заявка → клієнт + авто.</p></div>
      <div className="commsTopRight"><span className={`commsServer ${serverMode ? "online" : "fallback"}`}>{serverMode ? "NEON SERVER" : "LOCAL FALLBACK"}</span><div className="commsTopTabs"><button className={tab === "inbox" ? "active" : ""} onClick={() => setTab("inbox")}>Inbox</button><button className={tab === "integrations" ? "active" : ""} onClick={() => setTab("integrations")}>Інтеграції</button></div></div>
    </header>

    {tab === "integrations" ? <section className="integrationPage">
      <div className="integrationIntro"><div><p className="eyebrow">КАНАЛИ</p><h2>Інтеграційний контур</h2></div><span>Webhook/API-рівень CRM підготовлений. Для живих каналів залишиться додати зовнішні доступи.</span></div>
      <div className="integrationGrid">{integrations.map((item) => <article key={item.key}><div className="integrationIcon">{item.key === "BINOTEL" ? "☎" : item.key.slice(0,1)}</div><div className="integrationCopy"><strong>{item.title}</strong><span>{item.text}</span><code>{item.endpoint}</code><small>{item.status}</small></div><div className={`integrationState ${item.key === "WEBSITE" ? "ready" : "waiting"}`}>{item.key === "WEBSITE" ? "Endpoint готовий" : "Потрібен доступ"}</div></article>)}</div>
      <div className="integrationFlow"><b>Правило</b><span>Webhook не створює клієнта напряму. Він створює звернення. Лише після кваліфікації звернення переходить у Lead.</span></div>
    </section> : <div className="commsLayout">
      <aside className="commsFilters"><div className="commsFilterTitle">Вхідні</div>{filters.map((item) => <button key={item.key} className={filter === item.key ? "active" : ""} onClick={() => setFilter(item.key)}><span>{item.label}</span><b>{item.count}</b></button>)}<div className="commsRule"><strong>SLA 2 години</strong><span>Комерційне звернення має отримати відповідального і наступну дію.</span></div></aside>

      <section className="commsList"><div className="commsSearch"><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Пошук: клієнт, телефон, авто…" /><button onClick={() => void load()}>↻</button></div><div className="commsListScroll">{loading ? <div className="commsEmpty">Завантажую звернення…</div> : visible.map((item) => { const meta = channelMeta[item.channel]; return <button key={item.id} className={`commsConversation ${selected?.id === item.id ? "selected" : ""} ${item.unread ? "unread" : ""}`} onClick={() => openInquiry(item.id)}><span className="commsChannelIcon" style={{ background: meta.tone }}>{meta.short}</span><span className="commsConversationCopy"><span className="commsNameLine"><strong>{item.name}</strong><small>{fmt(item.receivedAt)}</small></span><b>{meta.label}</b><span>{item.preview}</span>{item.existingLeadId && <em>Лід {item.existingLeadId}</em>}</span></button>; })}{!loading && !visible.length && <div className="commsEmpty"><b>Поки немає звернень</b><span>Після підключення каналів вони автоматично з'являтимуться тут.</span></div>}</div></section>

      <section className="commsThread">{selected ? <><header><div><span className="commsChannelIcon" style={{ background: channelMeta[selected.channel].tone }}>{channelMeta[selected.channel].short}</span><div><strong>{selected.name}</strong><small>{selected.phone || selected.handle || "Контакт ще не отримано"}</small></div></div><span className={`inquiryState state-${selected.state.toLowerCase()}`}>{stateLabel(selected.state)}</span></header><div className="threadMessages">{selected.messages.map((message) => <div className={`threadBubble ${message.direction}`} key={message.id}><p>{message.text}</p><small>{fmt(message.at)}</small></div>)}</div>{selected.channel === "BINOTEL" ? <div className="threadCallAction"><a href={`tel:${(selected.phone || "").replace(/\D/g, "")}`}>☎ Передзвонити</a><span>Після підключення Binotel тут також буде журнал дзвінків і записи.</span></div> : <div className="threadComposer"><textarea value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Відповідь клієнту…" /><button className="primary" onClick={() => void sendReply()}>Зберегти</button></div>}</> : <div className="threadPlaceholder"><strong>Оберіть звернення</strong><span>Тут буде вся історія комунікації з клієнтом.</span></div>}</section>

      <aside className="commsContext">{selected ? <><div className="contextHead"><p className="eyebrow">ЗВЕРНЕННЯ · {selected.id}</p><h3>{selected.subject}</h3><span>{selected.sourceDetail || channelMeta[selected.channel].label}</span></div><div className="contextGrid"><div><small>Телефон</small><strong>{selected.phone || "Не отримано"}</strong></div><div><small>Авто</small><strong>{selected.vehicle || "Уточнюється"}</strong><span>{selected.plate || ""}</span></div>{selected.campaign && <div><small>Кампанія</small><strong>{selected.campaign}</strong></div>}{selected.utm && <div><small>UTM</small><strong>{selected.utm}</strong></div>}</div>{selected.duplicateLead && !selected.existingLeadId && <div className="duplicateBox"><b>Можливий дубль</b><span>Телефон уже є у ліді <strong>{selected.duplicateLead.id}</strong></span><button onClick={() => void convertToLead()}>Прив'язати</button></div>}{selected.existingLeadId ? <div className="linkedBox"><b>Уже в продажах</b><span>Лід {selected.existingLeadId}</span><button onClick={navigateToLeads}>Відкрити «Ліди» →</button></div> : <button className="contextPrimary" onClick={() => void convertToLead()}>+ Створити / прив'язати лід</button>}<button className="contextSecondary" onClick={navigateToLeads} disabled={!selected.existingLeadId}>Перейти в запис / заявку</button><button className="contextLink" onClick={() => void patch(selected.id, { state: "SPAM", unread: false })}>Спам / нецільове</button><div className="contextRule"><b>Правило Turbo LEV</b><span>Звернення ≠ клієнт. Клієнт + автомобіль формуються далі, коли лід переходить у реальну заявку/заїзд.</span></div></> : <div className="contextEmpty">Дані звернення з'являться після вибору діалогу.</div>}</aside>
    </div>}
  </div>;
}
