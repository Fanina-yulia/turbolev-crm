"use client";

import { createPortal } from "react-dom";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { navigateCrm } from "./crm-route";

type Vehicle = {
  id: string;
  plateNumber?: string | null;
  vin?: string | null;
  brand?: string | null;
  model?: string | null;
  year?: number | null;
};

type ServiceHistoryItem = {
  id: string;
  vehicleId?: string | null;
  status?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  closedAt?: string | null;
};

type ClientCard = {
  id: string;
  name?: string | null;
  phone: string;
  vehicles?: Vehicle[];
  serviceHistory?: ServiceHistoryItem[];
};

type ChannelOption = {
  key: string;
  label: string;
  mark: string;
  tone: string;
};

const CHANNELS: ChannelOption[] = [
  { key: "INSTAGRAM", label: "Instagram", mark: "◎", tone: "#e1306c" },
  { key: "FACEBOOK", label: "Facebook", mark: "f", tone: "#1877f2" },
  { key: "TELEGRAM", label: "Telegram", mark: "✈", tone: "#229ed9" },
  { key: "TIKTOK", label: "TikTok", mark: "♪", tone: "#111827" },
  { key: "BINOTEL", label: "Binotel", mark: "☎", tone: "#ff7a00" },
  { key: "OLX", label: "OLX", mark: "O", tone: "#23a6a0" },
  { key: "WEBSITE", label: "Сайт", mark: "W", tone: "#6366f1" },
];

function plainText(value: Element | null | undefined) {
  return String(value?.textContent || "").replace(/\s+/g, " ").trim();
}

function normalizedPhone(value: string) {
  const digits = value.replace(/\D/g, "");
  if (digits.length < 10) return "";
  return digits.startsWith("380") ? `+${digits.slice(0, 12)}` : value.trim();
}

function findCommunicationsRoot() {
  const heading = Array.from(document.querySelectorAll("h1")).find((node) => plainText(node) === "Комунікації") as HTMLElement | undefined;
  if (!heading) return null;
  let current: HTMLElement | null = heading.parentElement;
  while (current && current !== document.body) {
    if (current.querySelector('nav[aria-label="Фільтри комунікацій"]')) return current;
    current = current.parentElement;
  }
  return null;
}

function ensureHost(parent: HTMLElement, attribute: string) {
  let host = parent.querySelector<HTMLElement>(`:scope > [${attribute}]`);
  if (!host) {
    host = document.createElement("div");
    host.setAttribute(attribute, "1");
    parent.appendChild(host);
  }
  return host;
}

function statusLabel(value?: string | null) {
  const normalized = String(value || "").toUpperCase();
  const labels: Record<string, string> = {
    NEW: "Новий",
    DIAGNOSIS: "Діагностика",
    ESTIMATE: "Кошторис",
    APPROVAL: "Погодження",
    WAITING_PARTS: "Очікує запчастин",
    IN_REPAIR: "В ремонті",
    QC: "Контроль якості",
    READY: "Готовий",
    CLOSED: "Закритий",
    CANCELLED: "Скасований",
  };
  return labels[normalized] || normalized || "—";
}

function formatDate(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("uk-UA", { day: "2-digit", month: "2-digit", year: "2-digit" }).format(date);
}

export function CommunicationsWorkspaceEnhancer() {
  const [channelHost, setChannelHost] = useState<HTMLElement | null>(null);
  const [contextHost, setContextHost] = useState<HTMLElement | null>(null);
  const [selectedPhone, setSelectedPhone] = useState("");
  const [selectedName, setSelectedName] = useState("");
  const [activeChannel, setActiveChannel] = useState("");
  const [channelCounts, setChannelCounts] = useState<Record<string, number>>({});
  const [channelOpen, setChannelOpen] = useState(false);
  const [client, setClient] = useState<ClientCard | null>(null);
  const [clientLoading, setClientLoading] = useState(false);
  const frameRef = useRef(0);

  const syncDom = useCallback(() => {
    cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(() => {
      const root = findCommunicationsRoot();
      if (!root) {
        setChannelHost(null);
        setContextHost(null);
        return;
      }
      root.dataset.communicationsWorkspaceV2 = "true";
      const nav = root.querySelector<HTMLElement>('nav[aria-label="Фільтри комунікацій"]');
      const shell = nav?.nextElementSibling instanceof HTMLElement ? nav.nextElementSibling : null;
      const left = shell ? Array.from(shell.children).find((node) => node.tagName === "ASIDE") as HTMLElement | undefined : undefined;
      const right = shell ? Array.from(shell.children).find((node) => node.tagName === "SECTION") as HTMLElement | undefined : undefined;
      if (!nav || !shell || !left || !right) return;

      shell.dataset.communicationsRole = "workspace-shell";
      left.dataset.communicationsRole = "conversation-list";
      right.dataset.communicationsRole = "conversation-pane";

      const counts: Record<string, number> = {};
      for (const button of Array.from(nav.querySelectorAll<HTMLElement>(":scope > button"))) {
        const label = plainText(button);
        const channel = CHANNELS.find((item) => label.startsWith(item.label));
        if (channel) {
          button.dataset.communicationsFilterKind = "channel";
          button.dataset.communicationsFilterKey = channel.key;
          counts[channel.key] = Number(button.querySelector("span")?.textContent || 0) || 0;
        } else if (label.startsWith("Активні") || label.startsWith("Повідомлення")) {
          button.dataset.communicationsFilterKind = "secondary";
        } else {
          button.dataset.communicationsFilterKind = "primary";
        }
      }
      setChannelCounts((current) => JSON.stringify(current) === JSON.stringify(counts) ? current : counts);

      for (const row of Array.from(left.querySelectorAll<HTMLElement>("button"))) {
        if (row.querySelector("time")) row.dataset.communicationsConversationRow = "1";
      }

      const nextChannelHost = ensureHost(nav, "data-communications-channel-menu-host");
      if (channelHost !== nextChannelHost) setChannelHost(nextChannelHost);

      for (const child of Array.from(right.children) as HTMLElement[]) {
        if (child.hasAttribute("data-communications-context-host")) continue;
        if (child.tagName === "HEADER") child.dataset.communicationsPaneRole = "header";
        else if (child.classList.contains("communicationsLinkPanel")) child.dataset.communicationsPaneRole = "link-panel";
        else if (child.classList.contains("communicationsComposer")) child.dataset.communicationsPaneRole = "composer";
        else if (child.tagName === "DIV") child.dataset.communicationsPaneRole = "timeline";
      }

      const nextContextHost = ensureHost(right, "data-communications-context-host");
      if (contextHost !== nextContextHost) setContextHost(nextContextHost);

      const summary = right.querySelector<HTMLElement>('button[title="Відкрити картку контакту"]');
      const phone = normalizedPhone(plainText(summary?.querySelector("small")));
      const name = plainText(summary?.querySelector("strong"));
      const channel = plainText(right.querySelector(".communicationsChannelContext b")).replace(/\s*·\s*активний канал.*$/i, "");
      setSelectedPhone((current) => current === phone ? current : phone);
      setSelectedName((current) => current === name ? current : name);
      setActiveChannel((current) => current === channel ? current : channel);
    });
  }, [channelHost, contextHost]);

  useEffect(() => {
    syncDom();
    const observer = new MutationObserver(syncDom);
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("popstate", syncDom);
    window.addEventListener("turbolev:data-changed", syncDom as EventListener);
    return () => {
      cancelAnimationFrame(frameRef.current);
      observer.disconnect();
      window.removeEventListener("popstate", syncDom);
      window.removeEventListener("turbolev:data-changed", syncDom as EventListener);
    };
  }, [syncDom]);

  useEffect(() => {
    if (!selectedPhone) {
      setClient(null);
      return;
    }
    const controller = new AbortController();
    setClientLoading(true);
    fetch(`/api/client-card?phone=${encodeURIComponent(selectedPhone)}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => response.ok ? response.json() : null)
      .then((data) => setClient(data?.client || null))
      .catch(() => { if (!controller.signal.aborted) setClient(null); })
      .finally(() => { if (!controller.signal.aborted) setClientLoading(false); });
    return () => controller.abort();
  }, [selectedPhone]);

  useEffect(() => {
    if (!channelOpen) return;
    const close = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && channelHost?.contains(target)) return;
      setChannelOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [channelOpen, channelHost]);

  const routeChannel = useMemo(() => {
    if (typeof window === "undefined") return "";
    const filter = new URL(window.location.href).searchParams.get("filter") || "";
    return CHANNELS.find((item) => item.key === filter)?.label || "";
  }, [channelHost, channelCounts]);

  const triggerFilter = useCallback((label: string) => {
    const nav = channelHost?.parentElement;
    if (!nav) return;
    const button = Array.from(nav.querySelectorAll<HTMLButtonElement>(":scope > button")).find((item) => plainText(item).startsWith(label));
    button?.click();
    setChannelOpen(false);
  }, [channelHost]);

  const openClientCard = useCallback(() => {
    const pane = contextHost?.parentElement;
    pane?.querySelector<HTMLButtonElement>('button[title="Відкрити картку контакту"]')?.click();
  }, [contextHost]);

  const openVehicle = useCallback((vehicle: Vehicle) => {
    const pane = contextHost?.parentElement;
    const buttons = Array.from(pane?.querySelectorAll<HTMLButtonElement>('button[title="Відкрити картку автомобіля"]') || []);
    const needle = String(vehicle.plateNumber || vehicle.model || vehicle.brand || "").trim().toLocaleLowerCase("uk-UA");
    const match = buttons.find((button) => !needle || plainText(button).toLocaleLowerCase("uk-UA").includes(needle));
    match?.click();
  }, [contextHost]);

  const history = client?.serviceHistory || [];
  const activeOrder = history.find((item) => !item.closedAt) || null;
  const latestOrder = activeOrder || history[0] || null;

  return <>
    {channelHost ? createPortal(<div className="communicationsChannelPicker">
      <button type="button" className="communicationsChannelPickerButton" aria-expanded={channelOpen} onClick={() => setChannelOpen((value) => !value)}>
        <span>{routeChannel || "Канал"}</span><i>⌄</i>
      </button>
      {channelOpen ? <div className="communicationsChannelPickerMenu">
        <button type="button" onClick={() => triggerFilter("Усі")}><span className="communicationsChannelDot all">•</span><b>Усі канали</b></button>
        {CHANNELS.map((item) => <button type="button" key={item.key} onClick={() => triggerFilter(item.label)}>
          <span className="communicationsChannelDot" style={{ background: item.tone }}>{item.mark}</span><b>{item.label}</b><em>{channelCounts[item.key] || 0}</em>
        </button>)}
      </div> : null}
    </div>, channelHost) : null}

    {contextHost ? createPortal(<aside className="communicationsContextPanel" aria-label="Контекст клієнта">
      <div className="communicationsContextTitle"><div><span>КОНТЕКСТ</span><strong>{selectedName || "Діалог"}</strong></div>{activeChannel ? <small>{activeChannel}</small> : null}</div>
      {!selectedPhone ? <div className="communicationsContextEmpty">Для цього зовнішнього контакту ще немає номера або прив'язаної картки клієнта.</div> : clientLoading ? <div className="communicationsContextEmpty">Завантажую картку клієнта…</div> : <>
        <section className="communicationsContextCard">
          <div className="communicationsContextIcon">👤</div>
          <div><span>Клієнт</span><strong>{client?.name?.trim() || selectedName || "Без імені"}</strong><small>{selectedPhone}</small></div>
          {client ? <button type="button" onClick={openClientCard}>Відкрити</button> : null}
        </section>

        <div className="communicationsContextStats">
          <div><span>Авто</span><strong>{client?.vehicles?.length || 0}</strong></div>
          <div><span>Візити</span><strong>{history.length}</strong></div>
          <div><span>Наряд</span><strong>{activeOrder ? "Активний" : latestOrder ? "Є історія" : "—"}</strong></div>
        </div>

        <section className="communicationsContextSection">
          <header><span>АВТОМОБІЛІ</span></header>
          {client?.vehicles?.length ? <div className="communicationsContextVehicles">{client.vehicles.slice(0, 4).map((vehicle) => <button type="button" key={vehicle.id} onClick={() => openVehicle(vehicle)}>
            <span className="communicationsVehicleGlyph">🚗</span><div><strong>{[vehicle.brand, vehicle.model].filter(Boolean).join(" ") || "Автомобіль"}</strong><small>{vehicle.plateNumber || vehicle.vin || (vehicle.year ? String(vehicle.year) : "Без номера")}</small></div><i>›</i>
          </button>)}</div> : <p>У клієнта ще немає автомобіля в CRM.</p>}
        </section>

        <section className="communicationsContextSection">
          <header><span>ОСТАННІЙ НАРЯД</span></header>
          {latestOrder ? <button type="button" className="communicationsContextOrder" onClick={() => navigateCrm("Наряди та ремонт", { workOrderId: latestOrder.id })}>
            <div><strong>{statusLabel(latestOrder.status)}</strong><small>{activeOrder ? "Активний зараз" : `Закрито ${formatDate(latestOrder.closedAt || latestOrder.updatedAt)}`}</small></div><span>WO →</span>
          </button> : <p>Нарядів по клієнту ще немає.</p>}
        </section>

        <section className="communicationsContextSection communicationsContextHint">
          <header><span>ПРИНЦИП</span></header>
          <p>Один клієнт — один діалог. Дзвінки й повідомлення залишаються в єдиній хронології незалежно від каналу.</p>
        </section>
      </>}
    </aside>, contextHost) : null}
  </>;
}
