"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ClientCardDrawer } from "./client-card-drawer";
import { CommunicationsVehicleCardDrawer } from "./communications-vehicle-card-drawer";
import { VehicleBrandLogo } from "./vehicle-brand-logo";
import styles from "./communications-contact-inbox.module.css";
import {
  buildCommunicationConversations,
  getCommunicationReplyInquiries,
  getDefaultCommunicationReplyInquiry,
  isLiveReplyChannel,
  type CommunicationChannel as Channel,
  type CommunicationConversation,
  type CommunicationInquiry as Inquiry,
  type CommunicationMessage as Message,
} from "@/src/domain/communications-inbox";

type Filter = "ALL" | "NEW" | "NEEDS_REPLY" | "MISSED" | "MESSAGES" | Channel;
type BinotelHealth = { ok: boolean; databaseConfigured: boolean; restConfigured: boolean; webhookTokenConfigured: boolean; websocketConfigured: boolean; companyIdConfigured: boolean; webhookPath: string; missing: string[]; optionalMissing: string[] };
type LinkedVehicle = { id: string; plateNumber?: string | null; vin?: string | null; brand?: string | null; model?: string | null; year?: number | null };
type LinkedClientCard = { id: string; name?: string | null; phone: string; vehicles: LinkedVehicle[] };
type ClientSearchItem = { id: string; name?: string | null; phone: string; vehicles?: LinkedVehicle[] };
type CommunicationIntegrationStatus = {
  ok: boolean;
  meta?: {
    configured: boolean;
    status: string;
    lastTestAt?: string | null;
    lastTestMessage?: string | null;
    lastFacebookEventAt?: string | null;
    lastInstagramEventAt?: string | null;
    webhookPath: string;
  };
  olx?: {
    configured: boolean;
    status: string;
    lastTestAt?: string | null;
    lastTestMessage?: string | null;
    lastSyncedAt?: string | null;
    lastSuccessAt?: string | null;
    error?: string | null;
  };
};

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
  { key: "META", title: "Facebook + Instagram", endpoint: "/api/webhooks/meta", text: "Messenger та Instagram Direct через Meta Webhooks + Send API" },
  { key: "BINOTEL", title: "Binotel", endpoint: "/api/telephony/binotel-webhook", text: "Вхідні, пропущені дзвінки, CallHistory та записи розмов" },
  { key: "WEBSITE", title: "Сайт / Lead Forms", endpoint: "/api/webhooks/website", text: "Форми сайту та landing pages" },
  { key: "TIKTOK", title: "TikTok", endpoint: "/api/webhooks/tiktok", text: "Lead forms та повідомлення" },
  { key: "OLX", title: "OLX", endpoint: "/api/integrations/olx/connect", text: "OAuth, діалоги, синхронізація та відповіді з CRM" },
] as const;

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
function messageDelivery(message: Message) {
  if (message.direction !== "out" || !message.metadata || typeof message.metadata !== "object") return null;
  const metadata = message.metadata as Record<string, unknown>;
  const delivery = typeof metadata.delivery === "string" ? metadata.delivery.toUpperCase() : "";
  if (delivery === "FAILED") return { text: "⚠ не відправлено", failed: true };
  if (delivery === "PENDING") return { text: "◷ надсилається", failed: false };
  if (delivery === "READ") return { text: "✓✓ прочитано", failed: false };
  if (delivery === "DELIVERED") return { text: "✓✓ доставлено", failed: false };
  if (delivery === "SENT") return { text: "✓ надіслано", failed: false };
  if (delivery === "CRM_ONLY") return { text: "збережено в CRM", failed: false };
  return null;
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
function integrationReady(key: typeof integrations[number]["key"], status: CommunicationIntegrationStatus | null, binotel: BinotelHealth | null) {
  if (key === "BINOTEL") return Boolean(binotel?.ok);
  if (key === "WEBSITE") return true;
  if (key === "META") return Boolean(status?.meta?.configured && (status.meta.status === "CONNECTED" || status.meta.lastFacebookEventAt || status.meta.lastInstagramEventAt));
  if (key === "OLX") return Boolean(status?.olx?.configured && (status.olx.status === "READY" || status.olx.status === "CONNECTED"));
  return false;
}
function integrationStateText(key: typeof integrations[number]["key"], status: CommunicationIntegrationStatus | null, binotel: BinotelHealth | null) {
  if (integrationReady(key, status, binotel)) return "Підключено";
  if (key === "WEBSITE") return "Endpoint готовий";
  if (key === "META" && status?.meta?.configured) return "Налаштовано · перевірити Meta";
  if (key === "OLX" && status?.olx?.configured) return status.olx.status === "ERROR" ? "Помилка синхронізації" : "Потрібна OAuth-авторизація";
  return "Потрібен доступ";
}
function metaReplyDeadline(inquiry: Inquiry | null) {
  if (!inquiry || (inquiry.channel !== "FACEBOOK" && inquiry.channel !== "INSTAGRAM")) return null;
  if (inquiry.replyAllowedUntil) {
    const explicit = new Date(inquiry.replyAllowedUntil);
    if (!Number.isNaN(explicit.getTime())) return explicit;
  }
  const inboundTimes = inquiry.messages
    .filter((message) => message.direction === "in")
    .map((message) => new Date(message.at).getTime())
    .filter(Number.isFinite);
  const latestInbound = inboundTimes.length ? Math.max(...inboundTimes) : new Date(inquiry.receivedAt).getTime();
  if (!Number.isFinite(latestInbound)) return null;
  return new Date(latestInbound + 24 * 60 * 60 * 1000);
}

export function CommunicationsHub() {
  const [items, setItems] = useState<Inquiry[]>([]);
  const [selectedKey, setSelectedKey] = useState("");
  const [filter, setFilter] = useState<Filter>("ALL");
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<"inbox" | "integrations">("inbox");
  const [reply, setReply] = useState("");
  const [replyInquiryId, setReplyInquiryId] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [serverMode, setServerMode] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [retryingMessageId, setRetryingMessageId] = useState("");
  const [syncingOlx, setSyncingOlx] = useState(false);
  const [pageSize, setPageSize] = useState<20 | 50 | 100>(20);
  const [binotelHealth, setBinotelHealth] = useState<BinotelHealth | null>(null);
  const [integrationStatus, setIntegrationStatus] = useState<CommunicationIntegrationStatus | null>(null);
  const [clientCardOpen, setClientCardOpen] = useState(false);
  const [linkedClient, setLinkedClient] = useState<LinkedClientCard | null>(null);
  const [vehicleCardId, setVehicleCardId] = useState<string | null>(null);
  const [linkingOpen, setLinkingOpen] = useState(false);
  const [clientSearch, setClientSearch] = useState("");
  const [clientResults, setClientResults] = useState<ClientSearchItem[]>([]);
  const [clientSearching, setClientSearching] = useState(false);
  const [linkingClientId, setLinkingClientId] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const messageEndRef = useRef<HTMLDivElement | null>(null);

  const notify = (message: string) => { setToast(message); window.setTimeout(() => setToast(""), 3600); };
  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const response = await fetch("/api/communications", { cache: "no-store" });
      if (!response.ok) throw new Error();
      const data = await response.json();
      setItems((data.items || []) as Inquiry[]);
      setServerMode(true);
    } catch {
      if (!silent) {
        setServerMode(false);
        try { setItems(JSON.parse(window.localStorage.getItem(LOCAL_KEY) || "[]") as Inquiry[]); }
        catch { setItems([]); }
      }
    } finally { if (!silent) setLoading(false); }
  }, []);
  const loadBinotelHealth = useCallback(async () => {
    try {
      const response = await fetch("/api/telephony/binotel-health", { cache: "no-store" });
      setBinotelHealth(await response.json());
    } catch { setBinotelHealth(null); }
  }, []);
  const loadIntegrationStatus = useCallback(async () => {
    try {
      const response = await fetch("/api/integrations/communications/status", { cache: "no-store" });
      if (!response.ok) return;
      setIntegrationStatus(await response.json() as CommunicationIntegrationStatus);
    } catch { setIntegrationStatus(null); }
  }, []);
  const pollOlx = useCallback(async () => {
    try {
      const response = await fetch("/api/integrations/olx/poll", { method: "POST" });
      if (!response.ok) return;
      const data = await response.json() as { configured?: boolean; skipped?: boolean; messages?: number };
      if (data.configured && !data.skipped) {
        await Promise.all([load(true), loadIntegrationStatus()]);
      }
    } catch {}
  }, [load, loadIntegrationStatus]);

  useEffect(() => { void load(); void loadBinotelHealth(); void loadIntegrationStatus(); }, [load, loadBinotelHealth, loadIntegrationStatus]);
  useEffect(() => {
    const refresh = () => { void load(true); };
    window.addEventListener("turbolev:data-changed", refresh);
    return () => window.removeEventListener("turbolev:data-changed", refresh);
  }, [load]);
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load(true);
    }, 7000);
    return () => window.clearInterval(timer);
  }, [load]);
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void pollOlx();
    }, 55_000);
    return () => window.clearInterval(timer);
  }, [pollOlx]);
  useEffect(() => { if (!serverMode) try { window.localStorage.setItem(LOCAL_KEY, JSON.stringify(items)); } catch {} }, [items, serverMode]);

  const conversations = useMemo(() => buildCommunicationConversations(items), [items]);
  const selected = useMemo(() => conversations.find((item) => item.key === selectedKey) || null, [conversations, selectedKey]);
  const replyCandidates = useMemo(() => selected ? getCommunicationReplyInquiries(selected) : [], [selected]);
  const replyInquiry = useMemo(() => {
    if (!selected) return null;
    return replyCandidates.find((item) => item.id === replyInquiryId) || getDefaultCommunicationReplyInquiry(selected);
  }, [selected, replyCandidates, replyInquiryId]);
  const replyDeadline = useMemo(() => metaReplyDeadline(replyInquiry), [replyInquiry]);
  const metaReplyExpired = Boolean(replyDeadline && replyDeadline.getTime() < Date.now());
  const externalLinkInquiry = useMemo(() => selected?.inquiries.find((item) => (item.channel === "FACEBOOK" || item.channel === "INSTAGRAM" || item.channel === "OLX")) || null, [selected]);
  const canLinkExternalClient = Boolean(serverMode && selected && !selected.phone && externalLinkInquiry);

  useEffect(() => {
    if (!conversations.length) { if (selectedKey) setSelectedKey(""); return; }
    if (!conversations.some((item) => item.key === selectedKey)) setSelectedKey(conversations[0].key);
  }, [conversations, selectedKey]);
  useEffect(() => { messageEndRef.current?.scrollIntoView({ block: "end" }); }, [selectedKey, items]);
  useEffect(() => {
    if (!selected) { setReplyInquiryId(""); return; }
    setReplyInquiryId(getDefaultCommunicationReplyInquiry(selected).id);
    setFiles([]);
    setLinkingOpen(false);
    setClientSearch("");
    setClientResults([]);
  }, [selectedKey]);
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
    setReplyInquiryId(getDefaultCommunicationReplyInquiry(conversation).id);
    if (!conversation.unreadInquiryIds.length) return;
    const results = await Promise.all(conversation.unreadInquiryIds.map((id) => patchOne(id, { unread: false })));
    if (results.some((ok) => !ok)) notify("Не всі позначки прочитання вдалося синхронізувати");
  }
  async function sendReply() {
    if (!selected || !replyInquiry || (!reply.trim() && files.length === 0) || sending || metaReplyExpired) return;
    const inquiry = replyInquiry;
    if (isLiveReplyChannel(inquiry.channel) && files.length > 0) {
      notify("Файли для Facebook, Instagram та OLX ще не відправляються назовні. Надішліть текст окремо; модуль вкладень готується наступним етапом.");
      return;
    }
    const attachmentText = files.length ? `\n${files.map((file) => `📎 ${file.name}`).join("\n")}` : "";
    const finalText = `${reply.trim()}${attachmentText}`.trim();
    const attachments = files.map((file) => ({ name: file.name, type: file.type, size: file.size }));
    if (!serverMode) {
      const message: Message = { id: `local-${Date.now()}`, direction: "out", text: finalText, at: new Date().toISOString(), metadata: { attachments, delivery: "CRM_ONLY" } };
      setItems((current) => current.map((item) => item.id === inquiry.id ? { ...item, messages: [...item.messages, message], answered: true, unread: false, state: item.state === "NEW" ? "IN_WORK" : item.state } : item));
      setReply(""); setFiles([]); setEmojiOpen(false);
      return;
    }
    setSending(true);
    try {
      const response = await fetch(`/api/communications/${inquiry.id}/messages`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: finalText, attachments }) });
      const data = await response.json().catch(() => ({})) as { ok?: boolean; error?: string; delivery?: string };
      if (!response.ok || !data.ok) throw new Error(data.error || "Не вдалося доставити повідомлення");
      setReply(""); setFiles([]); setEmojiOpen(false);
      await load(true);
      if (data.delivery === "SENT") notify(`Надіслано в ${channelMeta[inquiry.channel].label}.`);
      else if (inquiry.channel === "BINOTEL") notify("Відповідь збережено в історії контакту.");
      else notify("Повідомлення збережено в CRM.");
    } catch (error) {
      await load(true);
      notify(error instanceof Error ? error.message : "Не вдалося доставити повідомлення");
    } finally { setSending(false); }
  }
  async function retryMessage(inquiryId: string, messageId: string) {
    if (!serverMode || retryingMessageId) return;
    setRetryingMessageId(messageId);
    try {
      const response = await fetch(`/api/communications/${encodeURIComponent(inquiryId)}/messages/${encodeURIComponent(messageId)}/retry`, { method: "POST" });
      const data = await response.json().catch(() => ({})) as { ok?: boolean; error?: string; delivery?: string };
      if (!response.ok || !data.ok) throw new Error(data.error || "Не вдалося повторити відправлення");
      await load(true);
      notify("Повідомлення повторно надіслано.");
    } catch (error) {
      await load(true);
      notify(error instanceof Error ? error.message : "Не вдалося повторити відправлення");
    } finally { setRetryingMessageId(""); }
  }
  async function convertToLead() {
    if (!selected || !serverMode) return notify("Для додавання в Активні потрібне серверне з'єднання");
    try {
      const response = await fetch(`/api/communications/${selected.representative.id}/convert`, { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Помилка");
      notify(data.linkedExisting ? "Контакт уже є в Активних" : "Контакт додано в Активні");
      await load(true);
    } catch (error) { notify(error instanceof Error ? error.message : "Не вдалося додати контакт в Активні"); }
  }
  async function searchClients() {
    const needle = clientSearch.trim();
    if (needle.length < 2) { setClientResults([]); return; }
    setClientSearching(true);
    try {
      const response = await fetch(`/api/clients-vehicles?q=${encodeURIComponent(needle)}&limit=12`, { cache: "no-store" });
      const data = await response.json().catch(() => ({})) as { clients?: ClientSearchItem[]; error?: string };
      if (!response.ok) throw new Error(data.error || "Не вдалося знайти клієнтів");
      setClientResults(data.clients || []);
    } catch (error) {
      setClientResults([]);
      notify(error instanceof Error ? error.message : "Не вдалося знайти клієнтів");
    } finally { setClientSearching(false); }
  }
  async function linkExistingClient(clientId: string) {
    if (!externalLinkInquiry || linkingClientId) return;
    setLinkingClientId(clientId);
    try {
      const response = await fetch(`/api/communications/${encodeURIComponent(externalLinkInquiry.id)}/link-client`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ clientId }),
      });
      const data = await response.json().catch(() => ({})) as { ok?: boolean; error?: string };
      if (!response.ok || !data.ok) throw new Error(data.error || "Не вдалося прив'язати клієнта");
      setLinkingOpen(false);
      setClientSearch("");
      setClientResults([]);
      await load(true);
      window.dispatchEvent(new CustomEvent("turbolev:data-changed"));
      notify("Зовнішній контакт прив'язано до клієнта CRM.");
    } catch (error) { notify(error instanceof Error ? error.message : "Не вдалося прив'язати клієнта"); }
    finally { setLinkingClientId(""); }
  }
  async function syncOlxNow() {
    if (syncingOlx) return;
    setSyncingOlx(true);
    try {
      const response = await fetch("/api/integrations/olx/sync", { method: "POST" });
      const data = await response.json().catch(() => ({})) as { ok?: boolean; error?: string; threads?: number; messages?: number };
      if (!response.ok || !data.ok) throw new Error(data.error || "Не вдалося синхронізувати OLX");
      await Promise.all([load(true), loadIntegrationStatus()]);
      notify(`OLX синхронізовано: ${data.threads || 0} діалогів, ${data.messages || 0} повідомлень.`);
    } catch (error) { notify(error instanceof Error ? error.message : "Помилка синхронізації OLX"); }
    finally { setSyncingOlx(false); }
  }
  async function copyMetaWebhook() {
    const value = `${window.location.origin}/api/webhooks/meta`;
    try { await navigator.clipboard.writeText(value); notify("Meta webhook URL скопійовано"); }
    catch { notify(value); }
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
      <div className={styles.headerRight}><span className={styles.serverBadge} data-ok={serverMode}>{serverMode ? "NEON SERVER" : "LOCAL FALLBACK"}</span><div className={styles.tabs}><button className={tab === "inbox" ? styles.active : ""} onClick={() => setTab("inbox")}>Inbox</button><button className={tab === "integrations" ? styles.active : ""} onClick={() => { setTab("integrations"); void loadIntegrationStatus(); }}>Інтеграції</button></div></div>
    </header>

    {tab === "integrations" ? <section className={styles.integrations}>
      <div className={styles.integrationHead}><div><p className={styles.eyebrow}>КАНАЛИ</p><h2>Інтеграції комунікацій</h2></div><span>Live-стан каналів та службові дії.</span></div>
      <div className={styles.integrationGrid}>{integrations.map((item) => {
        const ready = integrationReady(item.key, integrationStatus, binotelHealth);
        return <article className={styles.integrationCard} key={item.key}>
          <div className={styles.integrationIcon}>{item.key === "BINOTEL" ? "☎" : item.key[0]}</div>
          <div><strong>{item.title}</strong><p>{item.text}</p><code>{item.endpoint}</code>
            {item.key === "META" && <div className="communicationsIntegrationActions"><button type="button" onClick={() => void copyMetaWebhook()}>Копіювати webhook URL</button><button type="button" onClick={() => void loadIntegrationStatus()}>Оновити стан</button></div>}
            {item.key === "OLX" && <div className="communicationsIntegrationActions"><button type="button" onClick={() => { window.location.href = "/api/integrations/olx/connect"; }}>Підключити OLX</button><button type="button" disabled={syncingOlx || !integrationStatus?.olx?.configured} onClick={() => void syncOlxNow()}>{syncingOlx ? "Синхронізую…" : "Синхронізувати зараз"}</button></div>}
            {item.key === "OLX" && integrationStatus?.olx?.lastSuccessAt && <small className="communicationsIntegrationMeta">Остання успішна синхронізація: {fmtLong(integrationStatus.olx.lastSuccessAt)}</small>}
            {item.key === "META" && (integrationStatus?.meta?.lastFacebookEventAt || integrationStatus?.meta?.lastInstagramEventAt) && <small className="communicationsIntegrationMeta">Остання Meta-подія: {fmtLong(integrationStatus.meta.lastInstagramEventAt || integrationStatus.meta.lastFacebookEventAt || "")}</small>}
          </div>
          <span className={`${styles.integrationState} ${ready ? styles.ready : ""}`}>{integrationStateText(item.key, integrationStatus, binotelHealth)}</span>
        </article>;
      })}</div>
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
            {canLinkExternalClient && <button type="button" className="communicationsLinkClientButton" onClick={() => setLinkingOpen((current) => !current)}>Прив'язати клієнта</button>}
            {linkedClient?.vehicles?.length ? <div className={styles.vehicleSummaries} aria-label="Автомобілі клієнта">
              {linkedClient.vehicles.map((vehicle) => <button type="button" className={styles.vehicleSummary} key={vehicle.id} onClick={() => setVehicleCardId(vehicle.id)} title="Відкрити картку автомобіля">
                <VehicleBrandLogo brand={vehicle.brand} size={38}/>
                <span className={styles.vehicleText}><strong>{vehicleTitle(vehicle)}</strong><small><b>ДержЗнак:</b> {vehicle.plateNumber || "не вказано"}</small></span>
                <i>›</i>
              </button>)}
            </div> : null}
          </header>
          {linkingOpen && <div className="communicationsLinkPanel">
            <div><strong>Прив'язати зовнішній контакт до клієнта CRM</strong><span>Після прив'язки наступні повідомлення цього Instagram / Facebook / OLX користувача відкриватимуть правильну картку клієнта.</span></div>
            <div className="communicationsClientSearch"><input value={clientSearch} onChange={(event) => setClientSearch(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void searchClients(); } }} placeholder="ПІБ, телефон, номер авто або VIN"/><button type="button" onClick={() => void searchClients()} disabled={clientSearching}>{clientSearching ? "…" : "Знайти"}</button><button type="button" onClick={() => setLinkingOpen(false)}>×</button></div>
            {clientResults.length > 0 && <div className="communicationsClientResults">{clientResults.map((client) => <button type="button" key={client.id} disabled={Boolean(linkingClientId)} onClick={() => void linkExistingClient(client.id)}><strong>{client.name?.trim() || "Клієнт без імені"}</strong><span>{client.phone}</span><small>{client.vehicles?.length ? client.vehicles.map((vehicle) => [vehicle.brand, vehicle.model, vehicle.plateNumber].filter(Boolean).join(" ")).join(" · ") : "Без авто"}</small>{linkingClientId === client.id && <i>Прив'язую…</i>}</button>)}</div>}
          </div>}
          <div className={styles.timeline}>
            {selected.inquiryCount > 1 && <div className={styles.conversationSummary}>Об'єднано {selected.inquiryCount} звернень цього контакту · історія не видаляється</div>}
            {selected.timeline.length === 0 ? <div className={styles.empty}>{selected.preview}</div> : selected.timeline.map((message) => {
              const delivery = messageDelivery(message);
              return <article key={`${message.inquiryId}:${message.id}`} className={`${styles.event} ${styles[message.direction]} ${messageIsMissed(message) ? styles.missedEvent : ""}`}><p>{message.text}</p><footer><span>{channelMeta[message.channel].label}{delivery ? <em className={delivery.failed ? "communicationsDeliveryFailed" : "communicationsDeliveryState"}> · {delivery.text}</em> : null}{delivery?.failed && isLiveReplyChannel(message.channel) ? <button className="communicationsRetryButton" type="button" disabled={Boolean(retryingMessageId)} onClick={() => void retryMessage(message.inquiryId, message.id)}>{retryingMessageId === message.id ? "Повторюю…" : "Повторити"}</button> : null}</span><time>{fmtLong(message.at)}</time></footer></article>;
            })}
            <div ref={messageEndRef}/>
          </div>
          <div className={`${styles.composer} communicationsComposer`}>
            <div className="communicationsReplyMeta">
              <label>Відповісти через <select value={replyInquiry?.id || ""} onChange={(event) => { setReplyInquiryId(event.target.value); setFiles([]); }}>{replyCandidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{channelMeta[candidate.channel].label}</option>)}</select></label>
              {replyDeadline && <span className={metaReplyExpired ? "expired" : ""}>{metaReplyExpired ? "Стандартне вікно Meta завершилося" : `Meta: відповідь дозволена до ${fmtLong(replyDeadline.toISOString())}`}</span>}
            </div>
            {files.length > 0 && <div className="communicationsFileChips">{files.map((file, index) => <span key={`${file.name}-${index}`}>📎 ${file.name}<button type="button" onClick={() => setFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))}>×</button></span>)}</div>}
            {emojiOpen && <div className="communicationsEmojiPicker">{emojis.map((emoji) => <button type="button" key={emoji} onClick={() => { setReply((current) => current + emoji); setEmojiOpen(false); }}>{emoji}</button>)}</div>}
            <div className="communicationsComposeRow">
              <input ref={fileInputRef} type="file" multiple hidden onChange={(event) => { setFiles((current) => [...current, ...Array.from(event.target.files || [])].slice(0, 8)); event.currentTarget.value = ""; }}/>
              <button type="button" className="communicationsToolButton" onClick={() => { if (replyInquiry && isLiveReplyChannel(replyInquiry.channel)) notify("Реальну відправку фото та файлів через API каналів додаємо наступним етапом. Зараз вкладення не буде маскуватися як відправлене."); else fileInputRef.current?.click(); }} title={replyInquiry && isLiveReplyChannel(replyInquiry.channel) ? "Вкладення для live-каналів ще не активовані" : "Додати файл"}>📎</button>
              <textarea value={reply} onChange={(event) => setReply(event.target.value)} placeholder={metaReplyExpired ? "Стандартне вікно відповіді Meta завершилося" : "Повідомлення або внутрішня відповідь по контакту..."} disabled={metaReplyExpired} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void sendReply(); } }}/>
              <button type="button" className="communicationsToolButton" onClick={() => setEmojiOpen((current) => !current)} title="Emoji">☺</button>
              <button type="button" className="communicationsToolButton" onClick={() => notify("Голосові повідомлення підключимо разом з API каналу") } title="Голосове повідомлення">🎙</button>
              <button type="button" className="communicationsSendButton" disabled={sending || metaReplyExpired || (!reply.trim() && files.length === 0)} onClick={() => void sendReply()}>{sending ? "…" : "➤"}</button>
            </div>
            <span className={styles.composerHint}>Enter — надіслати · Shift+Enter — новий рядок. Facebook, Instagram та OLX відправляються через API обраного каналу; для інших каналів відповідь зберігається в CRM.</span>
          </div>
        </>}</section>
      </section>
    </>}

    {selected && <ClientCardDrawer open={clientCardOpen} name={linkedClient?.name?.trim() || selected.displayName} phone={selected.phone} existingLeadId={selected.existingLeadId} onClose={() => setClientCardOpen(false)} onCreateLead={() => { setClientCardOpen(false); void convertToLead(); }}/>} 
    <CommunicationsVehicleCardDrawer vehicleId={vehicleCardId} onClose={() => setVehicleCardId(null)}/>
    <style jsx global>{`
      .communicationsComposer{display:block!important;position:relative}
      .communicationsReplyMeta{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:0 0 8px;color:var(--muted);font-size:9px}.communicationsReplyMeta label{display:flex;align-items:center;gap:6px}.communicationsReplyMeta select{border:1px solid var(--line);border-radius:8px;background:var(--surface);color:var(--text);padding:5px 8px;font:inherit}.communicationsReplyMeta span{padding:5px 8px;border-radius:999px;background:var(--surface);border:1px solid var(--line)}.communicationsReplyMeta span.expired{color:#ef4444;border-color:rgba(239,68,68,.35);background:rgba(239,68,68,.07)}
      .communicationsFileChips{display:flex;gap:6px;flex-wrap:wrap;margin:0 0 8px}.communicationsFileChips>span{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--line);border-radius:999px;background:var(--surface);padding:5px 8px;color:var(--muted);font-size:8px}.communicationsFileChips button{width:18px!important;height:18px!important;padding:0!important;border:0!important;border-radius:50%!important;background:transparent!important;color:var(--muted)!important}
      .communicationsEmojiPicker{position:absolute;left:12px;bottom:76px;z-index:5;width:220px;display:grid;grid-template-columns:repeat(8,1fr);gap:3px;border:1px solid var(--line);border-radius:12px;background:var(--panel);padding:8px;box-shadow:0 14px 34px rgba(0,0,0,.16)}.communicationsEmojiPicker button{width:25px!important;height:25px!important;padding:0!important;border:0!important;background:transparent!important;color:var(--text)!important;font-size:15px!important}
      .communicationsComposeRow{display:grid;grid-template-columns:36px minmax(0,1fr) 36px 36px 44px;gap:7px;align-items:end}.communicationsComposeRow textarea{min-height:42px!important;max-height:100px}.communicationsComposeRow button{height:42px!important;padding:0!important}.communicationsToolButton{border:1px solid var(--line)!important;background:var(--surface)!important;color:var(--text)!important;border-radius:10px!important;font-size:15px!important}.communicationsSendButton{border:0!important;background:var(--orange)!important;color:#fff!important;border-radius:10px!important;font-size:15px!important}.communicationsSendButton:disabled{opacity:.4}
      .communicationsDeliveryState{font-style:normal;color:var(--muted);font-size:8px}.communicationsDeliveryFailed{font-style:normal;color:#ef4444;font-size:8px}.communicationsRetryButton{margin-left:6px;border:1px solid rgba(239,68,68,.35);border-radius:999px;background:rgba(239,68,68,.07);color:#ef4444;padding:3px 7px;font:inherit;font-size:8px;cursor:pointer}.communicationsRetryButton:disabled{opacity:.5;cursor:wait}
      .communicationsLinkClientButton{margin-left:auto;border:1px solid var(--orange);border-radius:9px;background:transparent;color:var(--orange);padding:7px 10px;font:inherit;font-size:9px;cursor:pointer}.communicationsLinkPanel{border-bottom:1px solid var(--line);background:var(--surface);padding:12px 14px;display:grid;gap:9px}.communicationsLinkPanel>div:first-child{display:grid;gap:3px}.communicationsLinkPanel strong{font-size:10px}.communicationsLinkPanel span{font-size:8px;color:var(--muted)}.communicationsClientSearch{display:grid!important;grid-template-columns:minmax(0,1fr) auto auto;gap:6px!important}.communicationsClientSearch input{min-width:0;border:1px solid var(--line);border-radius:9px;background:var(--panel);color:var(--text);padding:8px 10px;font:inherit;font-size:9px}.communicationsClientSearch button{border:1px solid var(--line);border-radius:9px;background:var(--panel);color:var(--text);padding:7px 10px;font:inherit;font-size:9px;cursor:pointer}.communicationsClientResults{display:grid!important;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:6px!important}.communicationsClientResults>button{display:grid;text-align:left;gap:2px;border:1px solid var(--line);border-radius:10px;background:var(--panel);color:var(--text);padding:9px 10px;cursor:pointer}.communicationsClientResults>button:hover{border-color:var(--orange)}.communicationsClientResults small{font-size:8px;color:var(--muted)}.communicationsClientResults i{font-size:8px;color:var(--orange);font-style:normal}
      .communicationsIntegrationActions{display:flex;gap:7px;flex-wrap:wrap;margin-top:10px}.communicationsIntegrationActions button{border:1px solid var(--line);border-radius:9px;background:var(--surface);color:var(--text);padding:7px 10px;font:inherit;font-size:9px;cursor:pointer}.communicationsIntegrationActions button:disabled{opacity:.45;cursor:not-allowed}.communicationsIntegrationMeta{display:block;margin-top:7px;color:var(--muted);font-size:8px}
      @media (max-width:900px){.communicationsReplyMeta{align-items:flex-start;flex-direction:column}.communicationsClientResults{grid-template-columns:1fr!important}.communicationsLinkClientButton{margin-left:0}}
    `}</style>
  </div>;
}
