"use client";

import { createPortal } from "react-dom";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PERMISSIONS } from "@/src/security/permissions";
import { navigateCrm } from "../crm-route";
import { useCrmAccess } from "../use-crm-access";

type SettingsItem = {
  id: string;
  label: string;
};

const SETTINGS: readonly SettingsItem[] = [
  { id: "schedule", label: "Графік" },
  { id: "personnel", label: "Персонал" },
  { id: "suppliers", label: "Постачальники" },
  { id: "warehouse", label: "Склад" },
  { id: "workPrices", label: "Прайс робіт" },
  { id: "posts", label: "Пости" },
  { id: "markup", label: "Націнка" },
  { id: "cash", label: "Каса" },
  { id: "integrations", label: "Інтеграції" },
  { id: "cameras", label: "Камери" },
  { id: "diagnosticTemplates", label: "Шаблони діагностики" },
  { id: "appearance", label: "Оформлення" },
  { id: "workflow", label: "Процеси та статуси" },
  { id: "security", label: "Ролі та доступи" },
  { id: "partsCatalog", label: "Каталог запчастин" },
] as const;

function text(value: Element | null | undefined) {
  return String(value?.textContent || "").replace(/\s+/g, " ").trim();
}

function ensureHost(parent: HTMLElement, attribute: string) {
  let host = parent.querySelector<HTMLElement>(`:scope > [${attribute}]`);
  if (host) return host;
  host = document.createElement("div");
  host.setAttribute(attribute, "1");
  host.className = "crmSettingsSubmenuBridge7";
  parent.appendChild(host);
  return host;
}

function compactSettingsHost() {
  const flyout = document.querySelector<HTMLElement>('.crmDockFlyout7[aria-label="Налаштування"]');
  if (!flyout) return null;
  const items = flyout.querySelector<HTMLElement>(":scope > div");
  if (!items) return null;
  for (const child of Array.from(items.children)) {
    if (child instanceof HTMLButtonElement) child.dataset.settingsNativeItemHidden = "1";
  }
  return ensureHost(items, "data-settings-submenu-compact-host");
}

function wideSettingsHost() {
  for (const group of Array.from(document.querySelectorAll<HTMLElement>(".crmWideGroup7"))) {
    if (text(group.querySelector(".crmWideGroupTitle7 strong")) !== "Налаштування") continue;
    const items = group.querySelector<HTMLElement>(".crmWideGroupItems7");
    if (!items) return null;
    for (const child of Array.from(items.children)) {
      if (child instanceof HTMLButtonElement) child.dataset.settingsNativeItemHidden = "1";
    }
    return ensureHost(items, "data-settings-submenu-wide-host");
  }
  return null;
}

export function SidebarSettingsSubmenuBridge() {
  const access = useCrmAccess();
  const frame = useRef(0);
  const [compactHost, setCompactHost] = useState<HTMLElement | null>(null);
  const [wideHost, setWideHost] = useState<HTMLElement | null>(null);
  const [activeTab, setActiveTab] = useState("schedule");

  const visibleSettings = useMemo(() => SETTINGS.filter((item) => {
    if (!access.enforced) return true;
    if (item.id === "personnel") return access.can(PERMISSIONS.PERSONNEL_READ);
    if (item.id === "cash") return access.can(PERMISSIONS.FINANCE_READ);
    if (item.id === "integrations") return access.can(PERMISSIONS.SETTINGS_INTEGRATIONS);
    if (item.id === "security") return access.can(PERMISSIONS.SECURITY_ACCESS_MANAGE);
    return access.can(PERMISSIONS.SETTINGS_READ);
  }), [access.enforced, access.loaded, access.snapshot]);

  const syncRoute = useCallback(() => {
    const url = new URL(window.location.href);
    setActiveTab(url.searchParams.get("settingsTab") || "schedule");
  }, []);

  const syncDom = useCallback(() => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const nextCompact = compactSettingsHost();
      const nextWide = wideSettingsHost();
      setCompactHost((current) => current === nextCompact ? current : nextCompact);
      setWideHost((current) => current === nextWide ? current : nextWide);
    });
  }, []);

  useEffect(() => {
    syncRoute();
    window.addEventListener("popstate", syncRoute);
    window.addEventListener("turbolev:navigate", syncRoute as EventListener);
    return () => {
      window.removeEventListener("popstate", syncRoute);
      window.removeEventListener("turbolev:navigate", syncRoute as EventListener);
    };
  }, [syncRoute]);

  useEffect(() => {
    syncDom();
    const observer = new MutationObserver(syncDom);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      cancelAnimationFrame(frame.current);
      observer.disconnect();
    };
  }, [syncDom]);

  const go = (id: string) => navigateCrm("Налаштування", { settingsTab: id });

  const compact = <>{visibleSettings.map((item) => <button
    type="button"
    role="menuitem"
    key={item.id}
    aria-current={activeTab === item.id ? "page" : undefined}
    className={activeTab === item.id ? "crmDockSubActive7" : ""}
    onClick={() => go(item.id)}
  >{item.label}</button>)}</>;

  const wide = <>{visibleSettings.map((item) => <button
    type="button"
    key={item.id}
    aria-current={activeTab === item.id ? "page" : undefined}
    className={activeTab === item.id ? "crmWideItemActive7" : ""}
    onClick={() => go(item.id)}
  >{item.label}</button>)}</>;

  return <>
    {compactHost ? createPortal(compact, compactHost) : null}
    {wideHost ? createPortal(wide, wideHost) : null}
    <style jsx global>{`
      @media(min-width:761px){
        [data-settings-native-item-hidden="1"]{display:none!important}
        .crmSettingsSubmenuBridge7{display:grid;gap:2px;min-width:0}

        .crmDockSlot7:has(.crmDockButton7[aria-label="Налаштування"]) .crmDockFlyout7{
          top:auto!important;
          bottom:-28px!important;
          max-height:min(72vh,560px)!important;
          overflow-y:auto!important;
          overflow-x:hidden!important;
          transform:translate(-7px,0) scale(.97)!important;
          transform-origin:left bottom!important;
        }
        .crmDockSlot7:has(.crmDockButton7[aria-label="Налаштування"]) .crmDockFlyoutShow7{
          transform:translate(0,0) scale(1)!important;
        }
      }
    `}</style>
  </>;
}
