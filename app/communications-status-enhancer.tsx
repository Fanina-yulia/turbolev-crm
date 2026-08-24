"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  buildCommunicationConversations,
  normalizeCommunicationPhone,
  type CommunicationConversation,
  type CommunicationInquiry,
  type CommunicationLifecycleState,
} from "@/src/domain/communications-inbox";

type EditableStatus = "NEW" | "IN_WORK" | "CLOSED" | "SPAM";
type CustomFilter = "CLOSED" | "SPAM" | null;
type StatusTarget = {
  host: HTMLElement;
  conversationKey: string;
  location: "row" | "header";
  row?: HTMLElement;
};

const STATUS_OPTIONS: Array<{ value: EditableStatus; label: string }> = [
  { value: "NEW", label: "НОВИЙ" },
  { value: "IN_WORK", label: "В РОБОТІ" },
  { value: "CLOSED", label: "ЗАКРИТО" },
  { value: "SPAM", label: "СПАМ" },
];

function text(value: Element | null | undefined) {
  return String(value?.textContent || "").replace(/\s+/g, " ").trim();
}

function displayStatus(state: CommunicationLifecycleState): EditableStatus {
  return state === "WAITING_CLIENT" ? "IN_WORK" : state;
}

function statusLabel(state: CommunicationLifecycleState) {
  return STATUS_OPTIONS.find((item) => item.value === displayStatus(state))?.label || "В РОБОТІ";
}

function findCommunicationsRoot() {
  const heading = Array.from(document.querySelectorAll("h1")).find((item) => text(item) === "Комунікації") as HTMLElement | undefined;
  if (!heading) return null;
  let current: HTMLElement | null = heading.parentElement;
  while (current && current !== document.body) {
    const buttons = Array.from(current.querySelectorAll("button"));
    const hasFilters = buttons.some((button) => text(button).startsWith("Усі"))
      && buttons.some((button) => text(button).startsWith("Нові"));
    const hasInbox = Boolean(current.querySelector("aside time"));
    if (hasFilters && hasInbox) return current;
    current = current.parentElement;
  }
  return null;
}

function findFilterBar(root: HTMLElement) {
  const allButton = Array.from(root.querySelectorAll("button")).find((button) => text(button).startsWith("Усі"));
  const parent = allButton?.parentElement as HTMLElement | null;
  if (!parent) return null;
  const labels = Array.from(parent.querySelectorAll(":scope > button")).map((button) => text(button));
  return labels.some((label) => label.startsWith("Потрібна відповідь")) ? parent : null;
}

function phoneFromText(value: string) {
  const candidates = value.match(/(?:\+?38)?0(?:[\s().-]*\d){9}/g) || [];
  for (const candidate of candidates) {
    const normalized = normalizeCommunicationPhone(candidate);
    if (normalized) return normalized;
  }
  return "";
}

function conversationForText(value: string, conversations: CommunicationConversation[]) {
  const normalizedPhone = phoneFromText(value);
  if (normalizedPhone) {
    const byPhone = conversations.find((conversation) => normalizeCommunicationPhone(conversation.phone) === normalizedPhone);
    if (byPhone) return byPhone;
  }
  const lower = value.toLocaleLowerCase("uk-UA");
  const byHandle = conversations.find((conversation) => {
    const handle = conversation.handle?.trim().toLocaleLowerCase("uk-UA");
    return Boolean(handle && lower.includes(handle));
  });
  if (byHandle) return byHandle;
  return conversations.find((conversation) => {
    const name = conversation.displayName.trim().toLocaleLowerCase("uk-UA");
    return Boolean(name && name !== "без імені" && lower.includes(name));
  }) || null;
}

function ensureHost(parent: HTMLElement, kind: "row" | "header", before?: Element | null) {
  const selector = `[data-communications-lifecycle-host="${kind}"]`;
  let host = parent.querySelector<HTMLElement>(`:scope > ${selector}`);
  if (!host) {
    host = document.createElement(kind === "header" ? "div" : "span");
    host.dataset.communicationsLifecycleHost = kind;
    if (before) parent.insertBefore(host, before);
    else parent.appendChild(host);
  }
  return host;
}

function rowTargets(root: HTMLElement, conversations: CommunicationConversation[]) {
  const result: StatusTarget[] = [];
  const rows = Array.from(root.querySelectorAll<HTMLElement>("aside button")).filter((row) => Boolean(row.querySelector("time")));
  for (const row of rows) {
    const conversation = conversationForText(text(row), conversations);
    if (!conversation) continue;
    row.dataset.communicationLifecycleState = conversation.lifecycleState;
    row.dataset.communicationConversationKey = conversation.key;
    const rowTop = Array.from(row.querySelectorAll<HTMLElement>("span")).find((item) => Boolean(item.querySelector(":scope > strong") && item.querySelector(":scope > time")));
    const time = rowTop?.querySelector(":scope > time") || null;
    if (!rowTop || !time) continue;
    const host = ensureHost(rowTop, "row", time);
    result.push({ host, conversationKey: conversation.key, location: "row", row });
  }
  return result;
}

function headerTarget(root: HTMLElement, conversations: CommunicationConversation[]) {
  const pageHeader = Array.from(root.querySelectorAll("header")).find((item) => item.querySelector("h1"));
  const headers = Array.from(root.querySelectorAll<HTMLElement>("header")).filter((item) => item !== pageHeader);
  for (const header of headers) {
    const conversation = conversationForText(text(header), conversations);
    if (!conversation) continue;
    const host = ensureHost(header, "header");
    return { host, conversationKey: conversation.key, location: "header" as const };
  }
  return null;
}

function ensureFilterHost(filterBar: HTMLElement) {
  let host = filterBar.querySelector<HTMLElement>(":scope > [data-communications-lifecycle-filters]");
  if (!host) {
    host = document.createElement("div");
    host.dataset.communicationsLifecycleFilters = "1";
    filterBar.appendChild(host);
  }
  return host;
}

function updateNativeFilterCounts(filterBar: HTMLElement, conversations: CommunicationConversation[]) {
  const active = conversations.filter((conversation) => conversation.lifecycleState !== "SPAM");
  const counts = new Map<string, number>([
    ["Усі", active.length],
    ["Нові", active.filter((item) => item.unreadCount > 0).length],
    ["Потрібна відповідь", active.filter((item) => item.actionState === "MISSED" || item.actionState === "NEEDS_REPLY").length],
    ["Пропущені", active.filter((item) => item.unresolvedMissedCount > 0).length],
    ["Повідомлення", active.filter((item) => item.hasMessages).length],
    ["Instagram", active.filter((item) => item.channels.includes("INSTAGRAM")).length],
    ["Facebook", active.filter((item) => item.channels.includes("FACEBOOK")).length],
    ["Telegram", active.filter((item) => item.channels.includes("TELEGRAM")).length],
    ["TikTok", active.filter((item) => item.channels.includes("TIKTOK")).length],
    ["Binotel", active.filter((item) => item.channels.includes("BINOTEL")).length],
    ["OLX", active.filter((item) => item.channels.includes("OLX")).length],
    ["Сайт", active.filter((item) => item.channels.includes("WEBSITE")).length],
  ]);
  for (const button of Array.from(filterBar.querySelectorAll<HTMLElement>(":scope > button"))) {
    const raw = text(button);
    const label = Array.from(counts.keys()).find((key) => raw.startsWith(key));
    if (!label) continue;
    const counter = button.querySelector<HTMLElement>("span");
    const next = String(counts.get(label) || 0);
    if (counter && counter.textContent !== next) counter.textContent = next;
  }
}

function LifecycleSelect({
  conversation,
  saving,
  isClient,
  compact,
  onChange,
}: {
  conversation: CommunicationConversation;
  saving: boolean;
  isClient: boolean;
  compact: boolean;
  onChange: (state: EditableStatus) => void;
}) {
  const value = displayStatus(conversation.lifecycleState);
  return <span
    className={`communicationsLifecycleControl ${compact ? "compact" : "header"}`}
    data-state={value}
    onPointerDown={(event) => event.stopPropagation()}
    onClick={(event) => event.stopPropagation()}
    onKeyDown={(event) => event.stopPropagation()}
  >
    {!compact && isClient ? <span className="communicationsClientBadge">НАШ КЛІЄНТ</span> : null}
    <select
      aria-label={`Статус діалогу: ${statusLabel(conversation.lifecycleState)}`}
      title="Статус діалогу"
      value={value}
      disabled={saving}
      onChange={(event) => onChange(event.target.value as EditableStatus)}
    >
      {STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
    {saving ? <span className="communicationsLifecycleSaving">…</span> : null}
  </span>;
}

export function CommunicationsStatusEnhancer() {
  const [items, setItems] = useState<CommunicationInquiry[]>([]);
  const [targets, setTargets] = useState<StatusTarget[]>([]);
  const [filterHost, setFilterHost] = useState<HTMLElement | null>(null);
  const [customFilter, setCustomFilter] = useState<CustomFilter>(null);
  const [savingKey, setSavingKey] = useState("");
  const [clientFlags, setClientFlags] = useState<Record<string, boolean>>({});
  const [toast, setToast] = useState("");
  const programmaticFilterClick = useRef(false);
  const clientCache = useRef(new Map<string, boolean>());
  const toastTimer = useRef<number | null>(null);

  const conversations = useMemo(() => buildCommunicationConversations(items), [items]);
  const byKey = useMemo(() => new Map(conversations.map((conversation) => [conversation.key, conversation])), [conversations]);

  const notify = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(""), 3000);
  }, []);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/communications", { cache: "no-store" });
      const data = await response.json().catch(() => null) as { items?: CommunicationInquiry[] } | null;
      if (!response.ok || !data?.items) return;
      setItems(data.items);
    } catch {
      // The core inbox already handles its own offline fallback.
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 20_000);
    const refresh = () => {
      clientCache.current.clear();
      setClientFlags({});
      void load();
    };
    window.addEventListener("turbolev:data-changed", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("turbolev:data-changed", refresh);
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
    };
  }, [load]);

  useEffect(() => {
    let frame = 0;
    const sync = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const root = findCommunicationsRoot();
        if (!root) {
          setTargets([]);
          setFilterHost(null);
          return;
        }
        const filterBar = findFilterBar(root);
        if (filterBar) {
          updateNativeFilterCounts(filterBar, conversations);
          setFilterHost(ensureFilterHost(filterBar));
        }
        const nextTargets = rowTargets(root, conversations);
        const header = headerTarget(root, conversations);
        if (header) nextTargets.push(header);
        setTargets((current) => {
          if (current.length === nextTargets.length && current.every((item, index) => item.host === nextTargets[index]?.host && item.conversationKey === nextTargets[index]?.conversationKey)) return current;
          return nextTargets;
        });
      });
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("popstate", sync);
    window.addEventListener("turbolev:data-changed", sync as EventListener);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("popstate", sync);
      window.removeEventListener("turbolev:data-changed", sync as EventListener);
    };
  }, [conversations]);

  useEffect(() => {
    const filterBar = filterHost?.parentElement as HTMLElement | null;
    if (!filterBar) return;
    const onClick = (event: Event) => {
      if (programmaticFilterClick.current) return;
      const button = (event.target as Element | null)?.closest("button");
      if (!button || button.closest("[data-communications-lifecycle-filters]")) return;
      setCustomFilter(null);
    };
    filterBar.addEventListener("click", onClick, true);
    return () => filterBar.removeEventListener("click", onClick, true);
  }, [filterHost]);

  useEffect(() => {
    for (const target of targets) {
      if (!target.row) continue;
      const conversation = byKey.get(target.conversationKey);
      if (!conversation) continue;
      const hidden = customFilter === "CLOSED"
        ? conversation.lifecycleState !== "CLOSED"
        : customFilter === "SPAM"
          ? conversation.lifecycleState !== "SPAM"
          : conversation.lifecycleState === "SPAM";
      target.row.hidden = hidden;
    }
    const filterBar = filterHost?.parentElement as HTMLElement | null;
    if (filterBar) {
      const allButton = Array.from(filterBar.querySelectorAll<HTMLElement>(":scope > button")).find((button) => text(button).startsWith("Усі"));
      if (allButton) allButton.dataset.suppressLifecycleActive = customFilter ? "1" : "0";
    }
  }, [targets, byKey, customFilter, filterHost]);

  const headerConversation = useMemo(() => {
    const target = targets.find((item) => item.location === "header");
    return target ? byKey.get(target.conversationKey) || null : null;
  }, [targets, byKey]);

  useEffect(() => {
    const phone = normalizeCommunicationPhone(headerConversation?.phone);
    if (!phone || Object.prototype.hasOwnProperty.call(clientFlags, phone)) return;
    if (clientCache.current.has(phone)) {
      setClientFlags((current) => ({ ...current, [phone]: Boolean(clientCache.current.get(phone)) }));
      return;
    }
    let active = true;
    void (async () => {
      try {
        const response = await fetch(`/api/client-card?phone=${encodeURIComponent(phone)}`, { cache: "no-store" });
        const data = await response.json().catch(() => null) as { client?: unknown } | null;
        const exists = Boolean(response.ok && data?.client);
        clientCache.current.set(phone, exists);
        if (active) setClientFlags((current) => ({ ...current, [phone]: exists }));
      } catch {
        clientCache.current.set(phone, false);
        if (active) setClientFlags((current) => ({ ...current, [phone]: false }));
      }
    })();
    return () => { active = false; };
  }, [headerConversation?.phone, clientFlags]);

  const setConversationStatus = useCallback(async (conversation: CommunicationConversation, state: EditableStatus) => {
    if (savingKey || displayStatus(conversation.lifecycleState) === state) return;
    setSavingKey(conversation.key);
    try {
      const responses = await Promise.all(conversation.inquiryIds.map(async (id) => {
        const response = await fetch(`/api/communications/${encodeURIComponent(id)}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ state }),
        });
        return response.ok;
      }));
      if (responses.some((ok) => !ok)) throw new Error("Не всі звернення вдалося оновити");
      await load();
      window.dispatchEvent(new CustomEvent("turbolev:data-changed"));
      notify(state === "SPAM" ? "Діалог переміщено в спам." : state === "CLOSED" ? "Діалог закрито." : "Статус діалогу оновлено.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Не вдалося змінити статус діалогу.");
    } finally {
      setSavingKey("");
    }
  }, [load, notify, savingKey]);

  const activateCustomFilter = useCallback((next: Exclude<CustomFilter, null>) => {
    const filterBar = filterHost?.parentElement as HTMLElement | null;
    const allButton = filterBar ? Array.from(filterBar.querySelectorAll<HTMLButtonElement>(":scope > button")).find((button) => text(button).startsWith("Усі")) : null;
    setCustomFilter((current) => current === next ? null : next);
    if (allButton) {
      programmaticFilterClick.current = true;
      allButton.click();
      window.setTimeout(() => { programmaticFilterClick.current = false; }, 0);
    }
  }, [filterHost]);

  const closedCount = conversations.filter((conversation) => conversation.lifecycleState === "CLOSED").length;
  const spamCount = conversations.filter((conversation) => conversation.lifecycleState === "SPAM").length;

  return <>
    {targets.map((target) => {
      const conversation = byKey.get(target.conversationKey);
      if (!conversation) return null;
      const phone = normalizeCommunicationPhone(conversation.phone);
      const isClient = target.location === "header" && Boolean(phone && clientFlags[phone]);
      return createPortal(
        <LifecycleSelect
          conversation={conversation}
          saving={savingKey === conversation.key}
          isClient={isClient}
          compact={target.location === "row"}
          onChange={(state) => void setConversationStatus(conversation, state)}
        />,
        target.host,
        `${target.location}:${conversation.key}`,
      );
    })}
    {filterHost ? createPortal(<div className="communicationsLifecycleFilters">
      <button type="button" className={customFilter === "CLOSED" ? "active" : ""} onClick={() => activateCustomFilter("CLOSED")}>Закриті <span>{closedCount}</span></button>
      <button type="button" className={customFilter === "SPAM" ? "active spam" : "spam"} onClick={() => activateCustomFilter("SPAM")}>Спам <span>{spamCount}</span></button>
    </div>, filterHost) : null}
    {toast ? <div className="communicationsLifecycleToast">{toast}</div> : null}
    <style jsx global>{`
      [data-communications-lifecycle-host="row"]{display:inline-flex;align-items:center;justify-content:flex-end;flex:none;margin-left:auto;margin-right:6px;min-width:108px}
      [data-communications-lifecycle-host="header"]{display:flex;align-items:center;flex:none;margin-left:auto}
      .communicationsLifecycleControl{display:inline-flex;align-items:center;gap:6px;position:relative}
      .communicationsLifecycleControl select{height:30px;min-width:108px;max-width:132px;border:1px solid var(--line);border-radius:999px;background:var(--surface);color:var(--text);padding:0 25px 0 10px;font-size:12px;font-weight:850;line-height:1;cursor:pointer;outline:none;text-transform:uppercase}
      .communicationsLifecycleControl.header select{height:34px;min-width:122px}
      .communicationsLifecycleControl[data-state="NEW"] select{border-color:color-mix(in srgb,#2563eb 45%,var(--line));background:color-mix(in srgb,#2563eb 8%,var(--surface));color:#2563eb}
      .communicationsLifecycleControl[data-state="IN_WORK"] select{border-color:color-mix(in srgb,var(--orange) 48%,var(--line));background:color-mix(in srgb,var(--orange) 8%,var(--surface));color:var(--orange)}
      .communicationsLifecycleControl[data-state="CLOSED"] select{border-color:color-mix(in srgb,#16a34a 40%,var(--line));background:color-mix(in srgb,#16a34a 7%,var(--surface));color:#16a34a}
      .communicationsLifecycleControl[data-state="SPAM"] select{border-color:color-mix(in srgb,#ef4444 45%,var(--line));background:color-mix(in srgb,#ef4444 8%,var(--surface));color:#dc2626}
      .communicationsLifecycleControl select:disabled{cursor:wait;opacity:.65}
      .communicationsLifecycleSaving{position:absolute;right:8px;color:currentColor;font-size:12px;font-weight:900;pointer-events:none}
      .communicationsClientBadge{display:inline-flex;align-items:center;height:30px;border:1px solid color-mix(in srgb,#16a34a 42%,var(--line));border-radius:999px;background:color-mix(in srgb,#16a34a 8%,var(--surface));color:#16a34a;padding:0 9px;font-size:12px;font-weight:900;white-space:nowrap}
      [data-communications-lifecycle-filters]{display:contents}
      .communicationsLifecycleFilters{display:contents}
      .communicationsLifecycleFilters button{min-height:40px;display:flex;align-items:center;gap:7px;white-space:nowrap;border:1px solid var(--line);border-radius:999px;background:var(--panel);color:var(--text);padding:0 14px;font-size:14px;font-weight:760;cursor:pointer}
      .communicationsLifecycleFilters button span{display:grid;place-items:center;min-width:22px;height:22px;border-radius:999px;background:var(--surface);color:var(--muted);font-size:12px}
      .communicationsLifecycleFilters button.active{border-color:#16a34a;background:#16a34a;color:#fff}
      .communicationsLifecycleFilters button.active span{background:rgba(255,255,255,.2);color:#fff}
      .communicationsLifecycleFilters button.spam.active{border-color:#dc2626;background:#dc2626}
      button[data-suppress-lifecycle-active="1"]{border-color:var(--line)!important;background:var(--panel)!important;color:var(--text)!important}
      button[data-suppress-lifecycle-active="1"] span{background:var(--surface)!important;color:var(--muted)!important}
      .communicationsLifecycleToast{position:fixed;right:20px;bottom:20px;z-index:1800;max-width:380px;border:1px solid var(--line);border-radius:12px;background:var(--panel);box-shadow:0 18px 50px rgba(0,0,0,.2);padding:12px 14px;color:var(--text);font-size:13px;font-weight:700;line-height:1.4}
      @media(max-width:1366px){[data-communications-lifecycle-host="row"]{min-width:96px}.communicationsLifecycleControl.compact select{min-width:96px;max-width:108px;padding-left:8px;font-size:12px}[data-communications-lifecycle-host="header"]{margin-left:0}}
      @media(max-width:900px){[data-communications-lifecycle-host="row"]{min-width:0;margin-right:2px}.communicationsLifecycleControl.compact select{min-width:88px;max-width:96px}.communicationsClientBadge{display:none}}
    `}</style>
  </>;
}
