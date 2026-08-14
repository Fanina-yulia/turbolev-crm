"use client";

import { useEffect, useMemo, useState } from "react";

type Channel = "ALL" | "FACEBOOK" | "INSTAGRAM" | "TIKTOK" | "BINOTEL" | "OLX" | "WEBSITE";
type InboxFilter = Channel | "UNREAD" | "NO_REPLY";
type InquiryState = "NEW" | "IN_WORK" | "CONVERTED" | "LINKED" | "SPAM";

type Message = { id: string; direction: "in" | "out"; text: string; at: string };
type Inquiry = {
  id: string;
  channel: Exclude<Channel, "ALL">;
  name: string;
  phone?: string;
  handle?: string;
  preview: string;
  subject: string;
  vehicle?: string;
  plate?: string;
  unread: boolean;
  answered: boolean;
  receivedAt: string;
  state: InquiryState;
  sourceDetail?: string;
  campaign?: string;
  utm?: string;
  existingLeadId?: string;
  messages: Message[];
};

type LegacyLead = {
  id: string;
  name: string;
  phone: string;
  plate: string;
  car: string;
  need: string;
  source: string;
  status: string;
  responsible: string;
  nextAction: string;
  nextContactAt: string;
  contactAttempts: number;
  lastActivityAt: string;
  lossReason?: string;
};

const STORAGE_KEY = "turbolev-communications-v1";
const LEADS_KEY = "turbolev-leads-v1";

const channelMeta: Record<Exclude<Channel, "ALL">, { label: string; short: string; tone: string }> = {
  FACEBOOK: { label: "Facebook", short: "f", tone: "#1877f2" },
  INSTAGRAM: { label: "Instagram", short: "◎", tone: "#e1306c" },
  TIKTOK: { label: "TikTok", short: "♪", tone: "#25f4ee" },
  BINOTEL: { label: "Binotel", short: "☎", tone: "#ff7a00" },
  OLX: { label: "OLX", short: "O", tone: "#23e5db" },
  WEBSITE: { label: "Сайт / Lead Form", short: "W", tone: "#7c8cff" },
};

const integrations = [
  { key: "FACEBOOK", title: "Facebook + Instagram", subtitle: "Messenger, Instagram Direct, Meta Lead Ads", ready: false, need: "Meta App + Page access token + Webhook" },
  { key: "TIKTOK", title: "TikTok", subtitle: "Lead forms та повідомлення, якщо доступні для акаунта", ready: false, need: "TikTok Business / Developer access + token" },
  { key: "BINOTEL", title: "Binotel", subtitle: "Вхідні, вихідні, пропущені дзвінки", ready: false, need: "API key/secret + webhook URL" },
  { key: "OLX", title: "OLX", subtitle: "Діалоги та прив'язка до оголошення", ready: false, need: "OLX API / партнерський доступ" },
  { key: "WEBSITE", title: "Сайт / Lead Forms", subtitle: "Форми запису, callback, рекламні landing pages", ready: true, need: "POST у CRM endpoint після серверного підключення БД" },
];

const seed: Inquiry[] = [
  {
    id: "C-2051", channel: "INSTAGRAM", name: "Олександр", handle: "@alex_mazda", phone: "+380 67 425 18 30", preview: "Скільки коштує заміна передніх амортизаторів?", subject: "Заміна передніх амортизаторів", vehicle: "Mazda 6 · 2016", plate: "AA4271KI", unread: true, answered: false, state: "NEW", receivedAt: new Date(Date.now() - 9 * 60_000).toISOString(), sourceDetail: "Instagram Direct", campaign: "Reels · Ходова", utm: "instagram / organic",
    messages: [{ id: "m1", direction: "in", text: "Добрий день. Скільки коштує заміна передніх амортизаторів на Mazda 6?", at: new Date(Date.now() - 9 * 60_000).toISOString() }],
  },
  {
    id: "C-2050", channel: "BINOTEL", name: "Невідомий номер", phone: "+380 99 730 11 08", preview: "Пропущений дзвінок · 0:00", subject: "Пропущений дзвінок", unread: true, answered: false, state: "NEW", receivedAt: new Date(Date.now() - 21 * 60_000).toISOString(), sourceDetail: "Binotel · пропущений",
    messages: [{ id: "m1", direction: "in", text: "Пропущений вхідний дзвінок. Потрібно передзвонити.", at: new Date(Date.now() - 21 * 60_000).toISOString() }],
  },
  {
    id: "C-2049", channel: "FACEBOOK", name: "Ірина К.", phone: "+380 93 771 42 15", preview: "Потрібно ТО і діагностика ходової", subject: "ТО + діагностика ходової", vehicle: "Renault Scenic · 2013", plate: "BH3057TE", unread: false, answered: true, state: "IN_WORK", receivedAt: new Date(Date.now() - 62 * 60_000).toISOString(), sourceDetail: "Facebook Messenger", campaign: "Google/Meta remarketing",
    messages: [
      { id: "m1", direction: "in", text: "Хочу записатися на ТО і перевірити ходову. Renault Scenic 2013.", at: new Date(Date.now() - 62 * 60_000).toISOString() },
      { id: "m2", direction: "out", text: "Добрий день! Підкажіть, будь ласка, номер авто і коли зручно заїхати?", at: new Date(Date.now() - 48 * 60_000).toISOString() },
    ],
  },
  {
    id: "C-2048", channel: "OLX", name: "Віктор", handle: "OLX user 8821", preview: "Чи робите заміну гальмівних дисків?", subject: "Гальмівні диски", vehicle: "Volkswagen Caddy", unread: true, answered: false, state: "NEW", receivedAt: new Date(Date.now() - 2.1 * 60 * 60_000).toISOString(), sourceDetail: "OLX · оголошення «СТО Глеваха»",
    messages: [{ id: "m1", direction: "in", text: "Чи робите заміну гальмівних дисків і колодок на Caddy?", at: new Date(Date.now() - 2.1 * 60 * 60_000).toISOString() }],
  },
  {
    id: "C-2047", channel: "WEBSITE", name: "Андрій", phone: "+380 50 902 66 71", preview: "Заявка з форми: заміна сайлентблоків", subject: "Заміна сайлентблоків", vehicle: "Ford S-Max · 2014", plate: "AI5523PM", unread: false, answered: false, state: "NEW", receivedAt: new Date(Date.now() - 3.5 * 60 * 60_000).toISOString(), sourceDetail: "Форма сайту · /hodova", campaign: "Google Ads · Ходова", utm: "google / cpc / hodova-smax",
    messages: [{ id: "m1", direction: "in", text: "Lead form: Ford S-Max 2014. Потрібна заміна сайлентблоків. Зателефонуйте після 17:00.", at: new Date(Date.now() - 3.5 * 60 * 60_000).toISOString() }],
  },
  {
    id: "C-2046", channel: "TIKTOK", name: "Максим", handle: "@max_auto", preview: "Після вашого відео: є стук спереду", subject: "Стук у передній підвісці", unread: false, answered: true, state: "IN_WORK", receivedAt: new Date(Date.now() - 5.2 * 60 * 60_000).toISOString(), sourceDetail: "TikTok · Lead/DM", campaign: "Video · діагностика ходової",
    messages: [
      { id: "m1", direction: "in", text: "Після вашого відео хочу заїхати. Є стук спереду.", at: new Date(Date.now() - 5.2 * 60 * 60_000).toISOString() },
      { id: "m2", direction: "out", text: "Напишіть номер телефону та номер авто — підберемо час.", at: new Date(Date.now() - 5 * 60 * 60_000).toISOString() },
    ],
  },
];

function normalizePhone(value?: string) {
  const digits = (value || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 10 && digits.startsWith("0")) return `380${digits}`;
  if (digits.length === 12 && digits.startsWith("380")) return digits;
  return digits;
}

function channelSource(channel: Inquiry["channel"]) {
  if (channel === "FACEBOOK") return "Facebook";
  if (channel === "INSTAGRAM") return "Instagram";
  if (channel === "OLX") return "OLX";
  if (channel === "WEBSITE") return "Сайт";
  if (channel === "BINOTEL") return "Телефон";
  return "TikTok";
}

function fmt(value: string) {
  const d = new Date(value);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return new Intl.DateTimeFormat("uk-UA", { hour: "2-digit", minute: "2-digit" }).format(d);
  return new Intl.DateTimeFormat("uk-UA", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(d);
}

export function CommunicationsHub() {
  const [items, setItems] = useState<Inquiry[]>(seed);
  const [filter, setFilter] = useState<InboxFilter>("ALL");
  const [selectedId, setSelectedId] = useState(seed[0].id);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<"inbox" | "integrations">("inbox");
  const [reply, setReply] = useState("");
  const [toast, setToast] = useState("");
  const [setup, setSetup] = useState<string | null>(null);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) setItems(JSON.parse(raw));
    } catch {}
  }, []);

  useEffect(() => {
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items)); } catch {}
  }, [items]);

  const selected = items.find((x) => x.id === selectedId) || items[0];
  const counts = useMemo(() => ({
    ALL: items.filter((x) => x.state !== "SPAM").length,
    UNREAD: items.filter((x) => x.unread && x.state !== "SPAM").length,
    NO_REPLY: items.filter((x) => !x.answered && x.state !== "SPAM").length,
    FACEBOOK: items.filter((x) => x.channel === "FACEBOOK" && x.state !== "SPAM").length,
    INSTAGRAM: items.filter((x) => x.channel === "INSTAGRAM" && x.state !== "SPAM").length,
    TIKTOK: items.filter((x) => x.channel === "TIKTOK" && x.state !== "SPAM").length,
    BINOTEL: items.filter((x) => x.channel === "BINOTEL" && x.state !== "SPAM").length,
    OLX: items.filter((x) => x.channel === "OLX" && x.state !== "SPAM").length,
    WEBSITE: items.filter((x) => x.channel === "WEBSITE" && x.state !== "SPAM").length,
  }), [items]);

  const visible = useMemo(() => items.filter((x) => {
    if (x.state === "SPAM") return false;
    if (filter === "UNREAD" && !x.unread) return false;
    if (filter === "NO_REPLY" && x.answered) return false;
    if (!["ALL", "UNREAD", "NO_REPLY"].includes(filter) && x.channel !== filter) return false;
    const hay = `${x.name} ${x.phone || ""} ${x.handle || ""} ${x.preview} ${x.vehicle || ""} ${x.plate || ""}`.toLowerCase();
    return hay.includes(query.trim().toLowerCase());
  }).sort((a, b) => +new Date(b.receivedAt) - +new Date(a.receivedAt)), [items, filter, query]);

  const duplicateLead = useMemo(() => {
    if (!selected?.phone) return null;
    try {
      const leads = JSON.parse(window.localStorage.getItem(LEADS_KEY) || "[]") as LegacyLead[];
      return leads.find((lead) => normalizePhone(lead.phone) === normalizePhone(selected.phone));
    } catch { return null; }
  }, [selected]);

  function showToast(text: string) {
    setToast(text);
    window.setTimeout(() => setToast(""), 2800);
  }

  function patchInquiry(id: string, patch: Partial<Inquiry>) {
    setItems((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item));
  }

  function openInquiry(id: string) {
    setSelectedId(id);
    patchInquiry(id, { unread: false });
  }

  function createLead() {
    if (!selected) return;
    if (duplicateLead) {
      patchInquiry(selected.id, { state: "LINKED", existingLeadId: duplicateLead.id, unread: false });
      showToast(`Звернення прив'язано до ${duplicateLead.id}`);
      return;
    }
    if (!selected.phone) {
      showToast("Спочатку потрібно отримати телефон клієнта");
      return;
    }
    const now = new Date();
    const next = new Date(now.getTime() + 60 * 60_000);
    const lead: LegacyLead = {
      id: `L-${Math.floor(1200 + Math.random() * 8700)}`,
      name: selected.name || "Новий клієнт",
      phone: selected.phone,
      plate: selected.plate || "",
      car: selected.vehicle || "Авто уточнюється",
      need: selected.subject,
      source: channelSource(selected.channel),
      status: "NEW",
      responsible: "Продавник 1",
      nextAction: selected.channel === "BINOTEL" ? "Передзвонити клієнту" : "Зв'язатися та кваліфікувати звернення",
      nextContactAt: next.toISOString(),
      contactAttempts: 0,
      lastActivityAt: now.toISOString(),
    };
    try {
      const current = JSON.parse(window.localStorage.getItem(LEADS_KEY) || "[]") as LegacyLead[];
      window.localStorage.setItem(LEADS_KEY, JSON.stringify([lead, ...current]));
    } catch {}
    patchInquiry(selected.id, { state: "CONVERTED", existingLeadId: lead.id, unread: false });
    showToast(`Створено лід ${lead.id}`);
  }

  function navigateToLeads() {
    window.dispatchEvent(new CustomEvent("turbolev:navigate", { detail: "Ліди" }));
  }

  function sendReply() {
    if (!selected || !reply.trim()) return;
    const message: Message = { id: `m-${Date.now()}`, direction: "out", text: reply.trim(), at: new Date().toISOString() };
    patchInquiry(selected.id, { messages: [...selected.messages, message], answered: true, state: selected.state === "NEW" ? "IN_WORK" : selected.state });
    setReply("");
  }

  function createRequest() {
    if (!selected?.existingLeadId) {
      showToast("Спочатку створіть або прив'яжіть лід");
      return;
    }
    showToast("Лід готовий до переходу в запис/заявку");
    navigateToLeads();
  }

  const filters: { key: InboxFilter; label: string; count: number }[] = [
    { key: "ALL", label: "Усі звернення", count: counts.ALL },
    { key: "UNREAD", label: "Непрочитані", count: counts.UNREAD },
    { key: "NO_REPLY", label: "Без відповіді", count: counts.NO_REPLY },
    { key: "INSTAGRAM", label: "Instagram", count: counts.INSTAGRAM },
    { key: "FACEBOOK", label: "Facebook", count: counts.FACEBOOK },
    { key: "TIKTOK", label: "TikTok", count: counts.TIKTOK },
    { key: "BINOTEL", label: "Binotel", count: counts.BINOTEL },
    { key: "OLX", label: "OLX", count: counts.OLX },
    { key: "WEBSITE", label: "Сайт / Lead Forms", count: counts.WEBSITE },
  ];

  return <div className="commsPage">
    {toast && <div className="commsToast">{toast}</div>}
    <header className="commsTop">
      <div><p className="eyebrow">OMNICHANNEL · ЄДИНА ТОЧКА ВХОДУ</p><h1>Комунікації</h1><p>Facebook, Instagram, TikTok, Binotel, OLX та форми сайту → звернення → лід → заявка.</p></div>
      <div className="commsTopTabs"><button className={tab === "inbox" ? "active" : ""} onClick={() => setTab("inbox")}>Inbox</button><button className={tab === "integrations" ? "active" : ""} onClick={() => setTab("integrations")}>Інтеграції</button></div>
    </header>

    {tab === "integrations" ? <section className="integrationPage">
      <div className="integrationIntro"><div><p className="eyebrow">КАНАЛИ</p><h2>Підключення джерел</h2></div><span>Інтерфейс готовий. Реальне підключення потребує токенів/доступів кожного сервісу.</span></div>
      <div className="integrationGrid">{integrations.map((item) => <article key={item.key}>
        <div className="integrationIcon">{item.key === "BINOTEL" ? "☎" : item.key.slice(0,1)}</div>
        <div className="integrationCopy"><strong>{item.title}</strong><span>{item.subtitle}</span><small>{item.need}</small></div>
        <div className={`integrationState ${item.ready ? "ready" : "waiting"}`}>{item.ready ? "CRM готова" : "Потрібен доступ"}</div>
        <button className="ghost" onClick={() => setSetup(item.key)}>Налаштувати</button>
      </article>)}</div>
      <div className="integrationFlow"><b>Маршрут даних</b><span>Канал → Звернення → дедуплікація → Лід → Запис/Заявка → Клієнт + Авто → Діагностика → Замовлення-наряд</span></div>
    </section> : <div className="commsLayout">
      <aside className="commsFilters">
        <div className="commsFilterTitle">Вхідні</div>
        {filters.map((item) => <button key={item.key} className={filter === item.key ? "active" : ""} onClick={() => setFilter(item.key)}><span>{item.label}</span><b>{item.count}</b></button>)}
        <div className="commsRule"><strong>SLA</strong><span>Будь-яке комерційне звернення повинно отримати відповідального та наступну дію.</span></div>
      </aside>

      <section className="commsList">
        <div className="commsSearch"><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Пошук: ім'я, телефон, номер авто…" /></div>
        <div className="commsListScroll">{visible.map((item) => {
          const meta = channelMeta[item.channel];
          return <button key={item.id} className={`commsConversation ${selected?.id === item.id ? "selected" : ""} ${item.unread ? "unread" : ""}`} onClick={() => openInquiry(item.id)}>
            <span className="commsChannelIcon" style={{ background: meta.tone }}>{meta.short}</span>
            <span className="commsConversationCopy"><span className="commsNameLine"><strong>{item.name}</strong><small>{fmt(item.receivedAt)}</small></span><b>{meta.label}</b><span>{item.preview}</span>{item.existingLeadId && <em>{item.existingLeadId}</em>}</span>
          </button>;
        })}{!visible.length && <div className="commsEmpty">Немає звернень у цьому фільтрі.</div>}</div>
      </section>

      {selected && <section className="commsThread">
        <header><div><span className="commsChannelIcon" style={{ background: channelMeta[selected.channel].tone }}>{channelMeta[selected.channel].short}</span><div><strong>{selected.name}</strong><small>{selected.phone || selected.handle || "Контакт ще не отримано"}</small></div></div><span className={`inquiryState state-${selected.state.toLowerCase()}`}>{selected.state === "NEW" ? "Нове звернення" : selected.state === "IN_WORK" ? "В роботі" : selected.state === "CONVERTED" ? "Лід створено" : selected.state === "LINKED" ? "Прив'язано" : "Спам"}</span></header>
        <div className="threadMessages">{selected.messages.map((message) => <div className={`threadBubble ${message.direction}`} key={message.id}><p>{message.text}</p><small>{fmt(message.at)}</small></div>)}</div>
        {selected.channel !== "BINOTEL" ? <div className="threadComposer"><textarea value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Відповісти клієнту…" /><button className="primary" onClick={sendReply}>Надіслати</button></div> : <div className="threadCallAction"><a href={`tel:${(selected.phone || "").replace(/\s/g, "")}`}>☎ Передзвонити</a><span>Після реального підключення Binotel тут буде дзвінок через телефонію та історія записів.</span></div>}
      </section>}

      {selected && <aside className="commsContext">
        <div className="contextHead"><p className="eyebrow">ЗВЕРНЕННЯ · {selected.id}</p><h3>{selected.subject}</h3><span>{selected.sourceDetail}</span></div>
        <div className="contextGrid"><div><small>Телефон</small><strong>{selected.phone || "Не отримано"}</strong></div><div><small>Авто</small><strong>{selected.vehicle || "Уточнюється"}</strong><span>{selected.plate || ""}</span></div>{selected.campaign && <div><small>Кампанія</small><strong>{selected.campaign}</strong></div>}{selected.utm && <div><small>UTM</small><strong>{selected.utm}</strong></div>}</div>
        {duplicateLead && <div className="duplicateBox"><b>Можливий дубль</b><span>Телефон вже є у ліді <strong>{duplicateLead.id}</strong></span><button onClick={createLead}>Прив'язати до існуючого</button></div>}
        {!duplicateLead && selected.existingLeadId && <div className="linkedBox"><b>Звернення вже у продажах</b><span>Лід {selected.existingLeadId}</span><button onClick={navigateToLeads}>Відкрити «Ліди» →</button></div>}
        {!selected.existingLeadId && <button className="contextPrimary" onClick={createLead}>+ Створити лід</button>}
        <button className="contextSecondary" onClick={createRequest}>Перейти в запис / заявку</button>
        <button className="contextLink" onClick={() => patchInquiry(selected.id, { state: "SPAM", unread: false })}>Позначити як спам / нецільове</button>
        <div className="contextRule"><b>Правило Turbo LEV</b><span>Звернення не стає клієнтом автоматично. Спочатку — лід. Клієнт + авто формуються на переході в реальну заявку/заїзд.</span></div>
      </aside>}
    </div>}

    {setup && <div className="setupBackdrop" onMouseDown={() => setSetup(null)}><div className="setupModal" onMouseDown={(e) => e.stopPropagation()}><header><div><p className="eyebrow">ІНТЕГРАЦІЯ</p><h2>{integrations.find((x) => x.key === setup)?.title}</h2></div><button onClick={() => setSetup(null)}>×</button></header><p>CRM-частина готова. Для живого каналу потрібні доступи від зовнішнього сервісу.</p><div className="setupSteps"><div><b>1</b><span>Отримати API/OAuth доступ та токени сервісу.</span></div><div><b>2</b><span>Додати секрети у Vercel Environment Variables.</span></div><div><b>3</b><span>Зареєструвати CRM webhook і перевірити тестове звернення.</span></div><div><b>4</b><span>Увімкнути дедуп за телефоном/номером авто та автоматичні правила створення лідів.</span></div></div><button className="primary" onClick={() => setSetup(null)}>Зрозуміло</button></div></div>}

    <style jsx global>{`
      .commsPage{min-width:0}.commsTop{display:flex;justify-content:space-between;gap:24px;align-items:flex-start;margin-bottom:18px}.commsTop h1{margin:0;font-size:32px;letter-spacing:-.04em}.commsTop p:last-child{color:var(--muted);font-size:13px}.commsTopTabs{display:flex;border:1px solid var(--line);border-radius:11px;overflow:hidden;background:var(--panel)}.commsTopTabs button{border:0;background:transparent;color:var(--muted);padding:10px 14px;cursor:pointer}.commsTopTabs button.active{background:var(--orange);color:#111;font-weight:800}.commsLayout{display:grid;grid-template-columns:190px minmax(260px,330px) minmax(360px,1fr) minmax(260px,320px);height:calc(100vh - 165px);min-height:610px;border:1px solid var(--line);border-radius:16px;overflow:hidden;background:var(--panel)}.commsFilters,.commsList,.commsThread,.commsContext{min-width:0}.commsFilters{padding:12px;border-right:1px solid var(--line);background:var(--panel-2);display:flex;flex-direction:column;gap:4px}.commsFilterTitle{font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.12em;padding:7px 8px 10px}.commsFilters>button{border:0;background:transparent;color:var(--soft-text);display:flex;justify-content:space-between;align-items:center;padding:9px 9px;border-radius:9px;text-align:left;cursor:pointer;font-size:11px}.commsFilters>button b{min-width:20px;height:20px;border-radius:99px;display:grid;place-items:center;background:var(--panel);font-size:9px}.commsFilters>button.active{background:rgba(255,102,0,.12);color:var(--text)}.commsFilters>button.active b{color:var(--orange)}.commsRule{margin-top:auto;border:1px solid rgba(255,102,0,.22);background:rgba(255,102,0,.06);padding:10px;border-radius:10px;display:grid;gap:5px}.commsRule strong{font-size:10px;color:var(--orange)}.commsRule span{font-size:9px;color:var(--muted);line-height:1.45}.commsList{border-right:1px solid var(--line);display:flex;flex-direction:column}.commsSearch{padding:10px;border-bottom:1px solid var(--line)}.commsSearch input{width:100%;border:1px solid var(--line);background:var(--panel-2);color:var(--text);border-radius:9px;padding:10px 11px;outline:0;font-size:11px}.commsSearch input:focus{border-color:var(--orange)}.commsListScroll{overflow:auto}.commsConversation{width:100%;display:grid;grid-template-columns:34px 1fr;gap:9px;border:0;border-bottom:1px solid var(--line);background:transparent;color:var(--text);padding:11px;text-align:left;cursor:pointer}.commsConversation:hover,.commsConversation.selected{background:rgba(255,102,0,.055)}.commsConversation.selected{box-shadow:inset 3px 0 0 var(--orange)}.commsConversation.unread .commsConversationCopy>span:last-of-type{color:var(--text);font-weight:600}.commsChannelIcon{width:30px;height:30px;border-radius:9px;display:grid;place-items:center;color:#071015;font-weight:900;font-size:12px;flex:0 0 auto}.commsConversationCopy{min-width:0;display:grid;gap:3px}.commsNameLine{display:flex;align-items:center;justify-content:space-between;gap:8px}.commsNameLine strong{font-size:11px}.commsNameLine small{font-size:8px;color:var(--muted)}.commsConversationCopy>b{font-size:8px;color:var(--orange);font-weight:800}.commsConversationCopy>span{font-size:9px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.commsConversationCopy em{font-size:8px;color:var(--green);font-style:normal}.commsEmpty{padding:30px 14px;color:var(--muted);font-size:11px;text-align:center}.commsThread{display:flex;flex-direction:column;border-right:1px solid var(--line);background:var(--bg)}.commsThread>header{height:62px;padding:10px 14px;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:center;gap:12px;background:var(--panel)}.commsThread>header>div{display:flex;align-items:center;gap:9px;min-width:0}.commsThread>header>div>div{display:grid;gap:3px}.commsThread>header strong{font-size:12px}.commsThread>header small{font-size:9px;color:var(--muted)}.inquiryState{font-size:8px;border:1px solid var(--line);padding:5px 7px;border-radius:99px;color:var(--muted);white-space:nowrap}.state-converted,.state-linked{color:var(--green);border-color:rgba(43,182,115,.28);background:rgba(43,182,115,.07)}.threadMessages{flex:1;overflow:auto;padding:18px;display:flex;flex-direction:column;gap:9px}.threadBubble{max-width:78%;padding:9px 11px;border-radius:12px;display:grid;gap:5px}.threadBubble p{margin:0;font-size:11px;line-height:1.5}.threadBubble small{font-size:8px;opacity:.65}.threadBubble.in{align-self:flex-start;background:var(--panel);border:1px solid var(--line)}.threadBubble.out{align-self:flex-end;background:rgba(255,102,0,.13);border:1px solid rgba(255,102,0,.24)}.threadComposer{display:grid;grid-template-columns:1fr auto;gap:8px;padding:11px;border-top:1px solid var(--line);background:var(--panel)}.threadComposer textarea{min-height:48px;max-height:110px;resize:vertical;border:1px solid var(--line);background:var(--panel-2);color:var(--text);border-radius:10px;padding:10px;font:inherit;font-size:10px;outline:0}.threadComposer textarea:focus{border-color:var(--orange)}.threadCallAction{padding:12px;border-top:1px solid var(--line);background:var(--panel);display:grid;gap:7px}.threadCallAction a{display:inline-flex;justify-content:center;background:var(--orange);color:#111;border-radius:10px;padding:10px;text-decoration:none;font-size:11px;font-weight:800}.threadCallAction span{font-size:8px;color:var(--muted);line-height:1.4}.commsContext{padding:15px;overflow:auto;background:var(--panel)}.contextHead{padding-bottom:13px;border-bottom:1px solid var(--line)}.contextHead h3{margin:0 0 5px;font-size:16px;line-height:1.35}.contextHead>span{font-size:9px;color:var(--muted)}.contextGrid{display:grid;gap:0}.contextGrid>div{padding:11px 0;border-bottom:1px solid var(--line);display:grid;gap:3px}.contextGrid small{font-size:8px;color:var(--muted);text-transform:uppercase;letter-spacing:.08em}.contextGrid strong{font-size:11px;line-height:1.4}.contextGrid span{font-size:9px;color:var(--muted)}.duplicateBox,.linkedBox{margin:13px 0;padding:11px;border-radius:10px;display:grid;gap:5px}.duplicateBox{border:1px solid rgba(240,180,41,.3);background:rgba(240,180,41,.07)}.linkedBox{border:1px solid rgba(43,182,115,.28);background:rgba(43,182,115,.07)}.duplicateBox b,.linkedBox b{font-size:10px}.duplicateBox span,.linkedBox span{font-size:9px;color:var(--muted)}.duplicateBox button,.linkedBox button{border:0;background:transparent;color:var(--orange);padding:3px 0;text-align:left;font-size:9px;font-weight:800;cursor:pointer}.contextPrimary,.contextSecondary,.contextLink{width:100%;border-radius:10px;padding:10px 11px;cursor:pointer;margin-top:8px;font-size:10px}.contextPrimary{border:1px solid var(--orange);background:var(--orange);color:#111;font-weight:900}.contextSecondary{border:1px solid var(--line);background:var(--panel-2);color:var(--text)}.contextLink{border:0;background:transparent;color:var(--muted)}.contextRule{margin-top:16px;padding:11px;border:1px solid rgba(255,102,0,.2);background:rgba(255,102,0,.05);border-radius:10px;display:grid;gap:5px}.contextRule b{font-size:9px;color:var(--orange)}.contextRule span{font-size:8px;color:var(--muted);line-height:1.45}.commsToast{position:fixed;z-index:2200;top:24px;right:24px;background:#173b2c;border:1px solid rgba(43,182,115,.35);color:#c4f7d8;padding:11px 14px;border-radius:10px;font-size:11px;box-shadow:0 15px 50px rgba(0,0,0,.3)}.integrationPage{border:1px solid var(--line);background:var(--panel);border-radius:16px;padding:20px}.integrationIntro{display:flex;justify-content:space-between;gap:20px;align-items:flex-start;padding-bottom:18px;border-bottom:1px solid var(--line)}.integrationIntro h2{margin:0;font-size:21px}.integrationIntro>span{max-width:520px;font-size:10px;color:var(--muted);line-height:1.5}.integrationGrid{display:grid;gap:9px;margin-top:14px}.integrationGrid article{display:grid;grid-template-columns:40px minmax(0,1fr) auto auto;gap:12px;align-items:center;border:1px solid var(--line);background:var(--panel-2);border-radius:12px;padding:12px}.integrationIcon{width:36px;height:36px;border-radius:10px;background:rgba(255,102,0,.1);color:var(--orange);display:grid;place-items:center;font-weight:900}.integrationCopy{display:grid;gap:3px}.integrationCopy strong{font-size:12px}.integrationCopy span{font-size:9px;color:var(--soft-text)}.integrationCopy small{font-size:8px;color:var(--muted)}.integrationState{font-size:8px;padding:5px 7px;border-radius:99px;border:1px solid var(--line)}.integrationState.ready{color:var(--green);border-color:rgba(43,182,115,.25)}.integrationState.waiting{color:var(--yellow);border-color:rgba(240,180,41,.25)}.integrationFlow{margin-top:14px;border:1px solid rgba(255,102,0,.22);background:rgba(255,102,0,.05);border-radius:11px;padding:12px;display:grid;gap:4px}.integrationFlow b{font-size:10px;color:var(--orange)}.integrationFlow span{font-size:9px;color:var(--muted);line-height:1.5}.setupBackdrop{position:fixed;inset:0;z-index:2300;background:rgba(0,0,0,.62);display:grid;place-items:center;padding:20px;backdrop-filter:blur(5px)}.setupModal{width:min(560px,100%);background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:18px;box-shadow:0 30px 100px rgba(0,0,0,.4)}.setupModal>header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:1px solid var(--line);padding-bottom:13px}.setupModal h2{margin:0}.setupModal>header button{border:0;background:transparent;color:var(--text);font-size:25px;cursor:pointer}.setupModal>p{font-size:10px;color:var(--muted);line-height:1.5}.setupSteps{display:grid;gap:8px;margin:14px 0}.setupSteps>div{display:grid;grid-template-columns:26px 1fr;gap:8px;align-items:center;padding:9px;border:1px solid var(--line);border-radius:9px;background:var(--panel-2)}.setupSteps b{width:24px;height:24px;border-radius:50%;display:grid;place-items:center;background:rgba(255,102,0,.12);color:var(--orange);font-size:9px}.setupSteps span{font-size:9px;color:var(--soft-text);line-height:1.4}@media(max-width:1250px){.commsLayout{grid-template-columns:165px 280px minmax(360px,1fr)}.commsContext{display:none}}@media(max-width:900px){.commsLayout{grid-template-columns:150px 1fr;height:auto;min-height:700px}.commsThread{grid-column:1/-1;min-height:520px;border-top:1px solid var(--line)}.integrationGrid article{grid-template-columns:40px 1fr}.integrationState,.integrationGrid article>.ghost{grid-column:2}}@media(max-width:650px){.commsTop{flex-direction:column}.commsLayout{display:block}.commsFilters{display:grid;grid-template-columns:1fr 1fr;border-right:0;border-bottom:1px solid var(--line)}.commsFilterTitle,.commsRule{grid-column:1/-1}.commsList{max-height:360px}.commsThread{min-height:520px}.integrationIntro{flex-direction:column}}
    `}</style>
  </div>;
}
