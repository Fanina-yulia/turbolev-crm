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
};

type ServiceHistoryItem = {
  id: string;
  vehicleId?: string | null;
  status?: string | null;
  closedAt?: string | null;
  updatedAt?: string | null;
};

type ClientCard = {
  id: string;
  name?: string | null;
  phone: string;
  vehicles?: Vehicle[];
  serviceHistory?: ServiceHistoryItem[];
};

type CallActionTarget = {
  host: HTMLElement;
  phone: string;
};

function text(value: Element | null | undefined) {
  return String(value?.textContent || "").replace(/\s+/g, " ").trim();
}

function normalizedPhone(value: string) {
  let digits = value.replace(/\D/g, "");
  if (digits.startsWith("0")) digits = `38${digits}`;
  if (!digits.startsWith("380") && digits.length === 9) digits = `380${digits}`;
  return digits.length >= 12 ? `+${digits.slice(0, 12)}` : "";
}

function findCommunicationsPage() {
  const heading = Array.from(document.querySelectorAll("h1")).find((item) => text(item) === "Комунікації") as HTMLElement | undefined;
  if (!heading) return null;
  let node: HTMLElement | null = heading.parentElement;
  while (node && node !== document.body) {
    const buttons = Array.from(node.querySelectorAll("button"));
    const hasInbox = buttons.some((button) => text(button) === "Inbox");
    const hasIntegrations = buttons.some((button) => text(button) === "Інтеграції");
    if (hasInbox && hasIntegrations) return node;
    node = node.parentElement;
  }
  return null;
}

function ensureHostAfter(parent: HTMLElement, selector: string, attribute: string) {
  let host = parent.querySelector<HTMLElement>(`:scope > [${attribute}]`);
  if (host) return host;
  host = document.createElement("div");
  host.setAttribute(attribute, "1");
  const anchor = parent.querySelector<HTMLElement>(selector);
  if (anchor?.nextSibling) parent.insertBefore(host, anchor.nextSibling);
  else parent.appendChild(host);
  return host;
}

function ensureCallHost(article: HTMLElement) {
  let host = article.querySelector<HTMLElement>(":scope > [data-communications-call-action-host]");
  if (host) return host;
  host = document.createElement("span");
  host.dataset.communicationsCallActionHost = "1";
  const footer = article.querySelector(":scope > footer");
  if (footer) article.insertBefore(host, footer);
  else article.appendChild(host);
  return host;
}

function sameCallTargets(current: CallActionTarget[], next: CallActionTarget[]) {
  return current.length === next.length && current.every((item, index) => item.host === next[index]?.host && item.phone === next[index]?.phone);
}

function call(phone: string) {
  if (!phone) return;
  window.dispatchEvent(new CustomEvent("turbolev:call", { detail: { phone } }));
}

export function CommunicationsWorkspaceV3Enhancer() {
  const [quickActionsHost, setQuickActionsHost] = useState<HTMLElement | null>(null);
  const [callTargets, setCallTargets] = useState<CallActionTarget[]>([]);
  const [selectedPhone, setSelectedPhone] = useState("");
  const [selectedName, setSelectedName] = useState("");
  const [activeChannel, setActiveChannel] = useState("");
  const [client, setClient] = useState<ClientCard | null>(null);
  const frameRef = useRef(0);

  const syncDom = useCallback(() => {
    cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(() => {
      const page = findCommunicationsPage();
      if (!page) {
        setQuickActionsHost(null);
        setCallTargets([]);
        return;
      }

      page.dataset.communicationsWorkspaceV3 = "true";
      const nav = page.querySelector<HTMLElement>('nav[aria-label="Фільтри комунікацій"]');
      page.dataset.communicationsTab = nav ? "inbox" : "integrations";

      const pageHeader = Array.from(page.querySelectorAll<HTMLElement>("header")).find((header) => header.querySelector("h1"));
      if (pageHeader) {
        for (const span of Array.from(pageHeader.querySelectorAll<HTMLElement>("span"))) {
          const value = text(span);
          if (value === "NEON SERVER" || value === "LOCAL FALLBACK") span.dataset.communicationsServerBadge = "1";
        }
      }

      if (!nav) {
        setQuickActionsHost(null);
        setCallTargets([]);
        return;
      }

      const shell = nav.nextElementSibling instanceof HTMLElement ? nav.nextElementSibling : null;
      const list = shell?.querySelector<HTMLElement>('[data-communications-role="conversation-list"]') || shell?.querySelector<HTMLElement>("aside");
      const pane = shell?.querySelector<HTMLElement>('[data-communications-role="conversation-pane"]') || shell?.querySelector<HTMLElement>("section");
      if (!shell || !list || !pane) return;

      for (const row of Array.from(list.querySelectorAll<HTMLElement>("button[data-communications-conversation-row], button"))) {
        if (!row.querySelector("time")) continue;
        row.dataset.communicationsConversationRow = "1";
        const missed = Boolean(row.querySelector('[aria-label="Потрібно передзвонити"]')) || text(row).toLocaleLowerCase("uk-UA").includes("пропущ");
        row.dataset.communicationsAction = missed ? "MISSED" : "NORMAL";
      }

      const summary = pane.querySelector<HTMLElement>('button[title="Відкрити картку контакту"]');
      const phone = normalizedPhone(text(summary?.querySelector("small")));
      const name = text(summary?.querySelector("strong"));
      const channelText = text(pane.querySelector(".communicationsChannelContext b"));
      const channel = ["Binotel", "Instagram", "Facebook", "Telegram", "TikTok", "OLX", "Сайт"]
        .find((label) => channelText.toLocaleLowerCase("uk-UA").includes(label.toLocaleLowerCase("uk-UA"))) || "Інше";
      setSelectedPhone((current) => current === phone ? current : phone);
      setSelectedName((current) => current === name ? current : name);
      setActiveChannel((current) => current === channel ? current : channel);

      const headerStatus = pane.querySelector<HTMLElement>('[data-communications-lifecycle-host="header"]');
      if (headerStatus) headerStatus.dataset.communicationsHeaderStatus = "1";

      const composer = pane.querySelector<HTMLElement>(".communicationsComposer");
      const textarea = composer?.querySelector<HTMLTextAreaElement>("textarea");
      if (textarea) textarea.title = "Enter — надіслати · Shift+Enter — новий рядок";
      const composerHint = composer?.querySelector<HTMLElement>(":scope > span:last-child");
      if (composerHint) composerHint.dataset.communicationsComposerHint = "1";

      const nextCallTargets: CallActionTarget[] = [];
      const timeline = pane.querySelector<HTMLElement>('[data-communications-pane-role="timeline"]');
      if (timeline) {
        for (const article of Array.from(timeline.querySelectorAll<HTMLElement>("article"))) {
          const footerText = text(article.querySelector("footer")).toLocaleLowerCase("uk-UA");
          const bodyText = text(article.querySelector("p")).toLocaleLowerCase("uk-UA");
          const isCall = footerText.includes("binotel") || bodyText.includes("дзвінок") || bodyText.includes("розмова з клієнтом");
          if (!isCall) {
            article.dataset.communicationsEventKind = "message";
            continue;
          }
          article.dataset.communicationsEventKind = "call";
          const missed = bodyText.includes("пропущ");
          article.dataset.communicationsCallState = missed ? "MISSED" : "COMPLETED";
          if (missed && phone) nextCallTargets.push({ host: ensureCallHost(article), phone });
        }
      }
      setCallTargets((current) => sameCallTargets(current, nextCallTargets) ? current : nextCallTargets);

      const contextPanel = pane.querySelector<HTMLElement>(".communicationsContextPanel");
      if (contextPanel) {
        const host = ensureHostAfter(contextPanel, ".communicationsContextCard", "data-communications-quick-actions-host");
        setQuickActionsHost((current) => current === host ? current : host);
      } else {
        setQuickActionsHost(null);
      }
    });
  }, []);

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
    fetch(`/api/client-card?phone=${encodeURIComponent(selectedPhone)}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => response.ok ? response.json() : null)
      .then((payload) => setClient(payload?.client || null))
      .catch(() => { if (!controller.signal.aborted) setClient(null); });
    return () => controller.abort();
  }, [selectedPhone]);

  useEffect(() => {
    const interceptContextNavigation = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target || !client) return;

      const clientButton = target.closest<HTMLButtonElement>(".communicationsContextCard button");
      if (clientButton) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        navigateCrm("Клієнти", { clientId: client.id });
        return;
      }

      const vehicleButton = target.closest<HTMLButtonElement>(".communicationsContextVehicles > button");
      if (!vehicleButton) return;
      const parent = vehicleButton.parentElement;
      const index = parent ? Array.from(parent.querySelectorAll(":scope > button")).indexOf(vehicleButton) : -1;
      const vehicle = index >= 0 ? client.vehicles?.[index] : null;
      if (!vehicle?.id) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      navigateCrm("Авто", { vehicleId: vehicle.id });
    };
    document.addEventListener("click", interceptContextNavigation, true);
    return () => document.removeEventListener("click", interceptContextNavigation, true);
  }, [client]);

  const bookingVehicle = useMemo(() => {
    if (!client?.vehicles?.length) return null;
    const history = client.serviceHistory || [];
    const active = history.find((item) => !item.closedAt && !["CLOSED", "CANCELLED"].includes(String(item.status || "").toUpperCase()));
    const recent = active || history[0];
    const fromHistory = recent?.vehicleId ? client.vehicles.find((vehicle) => vehicle.id === recent.vehicleId) : null;
    if (fromHistory) return fromHistory;
    return client.vehicles.length === 1 ? client.vehicles[0] : null;
  }, [client]);

  const openBooking = useCallback(() => {
    window.dispatchEvent(new CustomEvent("turbolev:open-new-request", {
      detail: {
        name: client?.name?.trim() || selectedName,
        phone: selectedPhone,
        source: activeChannel || "Інше",
        plate: bookingVehicle?.plateNumber || "",
        vin: bookingVehicle?.vin || "",
      },
    }));
  }, [client?.name, selectedName, selectedPhone, activeChannel, bookingVehicle?.plateNumber, bookingVehicle?.vin]);

  return <>
    {quickActionsHost ? createPortal(<div className="communicationsContextQuickActions" aria-label="Швидкі дії">
      <button type="button" onClick={() => call(selectedPhone)} disabled={!selectedPhone}>☎ Передзвонити</button>
      <button type="button" className="primary" onClick={openBooking} disabled={!selectedPhone}>+ Записати на СТО</button>
    </div>, quickActionsHost) : null}

    {callTargets.map((target, index) => createPortal(<button
      key={`${target.phone}:${index}`}
      type="button"
      className="communicationsMissedCallAction"
      onClick={() => call(target.phone)}
      title="Передзвонити через Binotel"
    >☎ Передзвонити</button>, target.host))}
  </>;
}
