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

type FlyoutPosition = {
  left: number;
  bottom: number;
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

function isSettingsAnchor(target: EventTarget | null): target is HTMLElement {
  return target instanceof Element && Boolean(target.closest('.crmDockButton7[aria-label="Налаштування"]'));
}

function settingsAnchorFrom(target: EventTarget | null) {
  if (!(target instanceof Element)) return null;
  return target.closest<HTMLElement>('.crmDockButton7[aria-label="Налаштування"]');
}

export function SidebarSettingsSubmenuBridge() {
  const access = useCrmAccess();
  const closeTimer = useRef<number | null>(null);
  const wideFrame = useRef(0);
  const anchorRef = useRef<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<FlyoutPosition>({ left: 82, bottom: 12 });
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

  const clearClose = useCallback(() => {
    if (closeTimer.current) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);

  const syncPosition = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    setPosition({
      left: Math.max(76, Math.round(rect.right + 10)),
      bottom: Math.max(12, Math.round(window.innerHeight - rect.bottom - 10)),
    });
  }, []);

  const showFrom = useCallback((anchor: HTMLElement) => {
    clearClose();
    anchorRef.current = anchor;
    const rect = anchor.getBoundingClientRect();
    setPosition({
      left: Math.max(76, Math.round(rect.right + 10)),
      bottom: Math.max(12, Math.round(window.innerHeight - rect.bottom - 10)),
    });
    setOpen(true);
  }, [clearClose]);

  const scheduleClose = useCallback(() => {
    clearClose();
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = null;
      setOpen(false);
    }, 220);
  }, [clearClose]);

  const syncWideDom = useCallback(() => {
    cancelAnimationFrame(wideFrame.current);
    wideFrame.current = requestAnimationFrame(() => {
      const nextWide = wideSettingsHost();
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
    const onPointerOver = (event: PointerEvent) => {
      const anchor = settingsAnchorFrom(event.target);
      if (anchor) showFrom(anchor);
    };
    const onPointerOut = (event: PointerEvent) => {
      if (!isSettingsAnchor(event.target)) return;
      const next = event.relatedTarget;
      if (next instanceof Element && next.closest(".crmSettingsFixedFlyout7")) return;
      scheduleClose();
    };
    const onFocusIn = (event: FocusEvent) => {
      const anchor = settingsAnchorFrom(event.target);
      if (anchor) showFrom(anchor);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        clearClose();
        setOpen(false);
      }
    };
    const onViewportChange = () => {
      if (open) syncPosition();
    };

    document.addEventListener("pointerover", onPointerOver, true);
    document.addEventListener("pointerout", onPointerOut, true);
    document.addEventListener("focusin", onFocusIn, true);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", onViewportChange);
    window.addEventListener("scroll", onViewportChange, true);
    return () => {
      document.removeEventListener("pointerover", onPointerOver, true);
      document.removeEventListener("pointerout", onPointerOut, true);
      document.removeEventListener("focusin", onFocusIn, true);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", onViewportChange);
      window.removeEventListener("scroll", onViewportChange, true);
      clearClose();
    };
  }, [clearClose, open, scheduleClose, showFrom, syncPosition]);

  useEffect(() => {
    syncWideDom();
    const observer = new MutationObserver(syncWideDom);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      cancelAnimationFrame(wideFrame.current);
      observer.disconnect();
    };
  }, [syncWideDom]);

  const go = (id: string) => {
    clearClose();
    setOpen(false);
    navigateCrm("Налаштування", { settingsTab: id });
  };

  const wide = <>{visibleSettings.map((item) => <button
    type="button"
    key={item.id}
    aria-current={activeTab === item.id ? "page" : undefined}
    className={activeTab === item.id ? "crmWideItemActive7" : ""}
    onClick={() => go(item.id)}
  >{item.label}</button>)}</>;

  return <>
    {open && <aside
      className="crmSettingsFixedFlyout7"
      role="menu"
      aria-label="Налаштування"
      style={{ left: position.left, bottom: position.bottom }}
      onPointerEnter={clearClose}
      onPointerLeave={scheduleClose}
      onFocusCapture={clearClose}
    >
      <header>Налаштування</header>
      <div>
        {visibleSettings.map((item) => <button
          type="button"
          role="menuitem"
          key={item.id}
          aria-current={activeTab === item.id ? "page" : undefined}
          className={activeTab === item.id ? "crmDockSubActive7" : ""}
          onClick={() => go(item.id)}
        >{item.label}</button>)}
      </div>
    </aside>}
    {wideHost ? createPortal(wide, wideHost) : null}
    <style jsx global>{`
      @media(min-width:761px){
        [data-settings-native-item-hidden="1"]{display:none!important}
        .crmSettingsSubmenuBridge7{display:grid;gap:2px;min-width:0}

        /* V7 renders a one-item Settings flyout by default. Hide only that shell;
           the stable fixed Settings flyout below owns compact Settings navigation. */
        .crmDockFlyout7[aria-label="Налаштування"]{display:none!important}

        .crmSettingsFixedFlyout7{
          position:fixed;
          z-index:2920;
          width:252px;
          max-height:min(72vh,560px);
          padding:8px;
          overflow-y:auto;
          overflow-x:hidden;
          border:1px solid color-mix(in srgb,var(--line) 76%,transparent);
          border-radius:14px;
          background:color-mix(in srgb,var(--panel) 96%,transparent);
          color:var(--text);
          box-shadow:0 16px 38px rgba(0,0,0,.20);
          backdrop-filter:blur(16px);
          -webkit-backdrop-filter:blur(16px);
          animation:crmSettingsFlyoutIn7 150ms cubic-bezier(.16,1,.3,1);
        }
        .crmSettingsFixedFlyout7::before{
          content:"";
          position:absolute;
          top:-8px;
          bottom:-8px;
          left:-20px;
          width:20px;
        }
        .crmSettingsFixedFlyout7 header{
          padding:6px 8px 9px;
          margin-bottom:5px;
          border-bottom:1px solid color-mix(in srgb,var(--line) 70%,transparent);
          font-size:12px;
          line-height:1.2;
          font-weight:800;
          letter-spacing:.03em;
        }
        .crmSettingsFixedFlyout7>div{display:grid;gap:2px}
        .crmSettingsFixedFlyout7 button{
          width:100%;
          min-height:34px;
          padding:7px 10px!important;
          border:0!important;
          border-radius:9px!important;
          background:transparent!important;
          color:var(--soft-text)!important;
          text-align:left!important;
          font-size:12px!important;
          line-height:1.2!important;
          font-weight:600!important;
          cursor:pointer!important;
        }
        .crmSettingsFixedFlyout7 button:hover,.crmSettingsFixedFlyout7 button:focus-visible{
          background:var(--panel-2)!important;
          color:var(--text)!important;
          outline:none!important;
        }
        .crmSettingsFixedFlyout7 .crmDockSubActive7{
          background:rgba(255,102,0,.09)!important;
          color:var(--orange)!important;
          font-weight:800!important;
        }
        @keyframes crmSettingsFlyoutIn7{
          from{opacity:0;transform:translateX(-7px) scale(.97)}
          to{opacity:1;transform:translateX(0) scale(1)}
        }
      }
      @media(max-width:760px){.crmSettingsFixedFlyout7{display:none!important}}
      @media(prefers-reduced-motion:reduce) and (min-width:761px){.crmSettingsFixedFlyout7{animation:none!important}}
    `}</style>
  </>;
}
