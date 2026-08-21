"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CRM_NAV_GROUPS, sectionFromSlug, type CrmSectionLabel } from "../crm-navigation";
import { CRM_ROUTE_KEYS } from "../crm-route";
import { type SettingsTab, isSettingsTab } from "../settings-tabs";
import { useCrmAccess } from "../use-crm-access";
import { PERMISSIONS } from "@/src/security/permissions";

type RailFlyout = {
  groupLabel: string;
  top: number;
  left: number;
} | null;

type SettingsNavItem = { id: SettingsTab; label: string };

const DESKTOP_QUERY = "(min-width: 761px)";
const DESKTOP_EXPANDED_KEY = "turbolev:desktop-sidebar-expanded:v1";
const SIDEBAR_TOGGLE_SELECTOR = '.sidebar > button[aria-controls="crm-primary-navigation"]';
const GROUP_BUTTON_SELECTOR = '.sidebar nav > section > button[aria-expanded]';

const SETTINGS_NAV_ITEMS: SettingsNavItem[] = [
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
];

function isDesktop() {
  return window.matchMedia(DESKTOP_QUERY).matches;
}

function sidebarToggle() {
  const node = document.querySelector(SIDEBAR_TOGGLE_SELECTOR);
  return node instanceof HTMLButtonElement ? node : null;
}

function readDesktopExpandedPreference() {
  try {
    return window.localStorage.getItem(DESKTOP_EXPANDED_KEY) === "1";
  } catch {
    return false;
  }
}

function writeDesktopExpandedPreference(expanded: boolean) {
  try {
    window.localStorage.setItem(DESKTOP_EXPANDED_KEY, expanded ? "1" : "0");
  } catch {
    // Keep the in-memory preference if storage is unavailable.
  }
}

function blurActiveElement() {
  requestAnimationFrame(() => {
    const active = document.activeElement;
    if (active instanceof HTMLElement) active.blur();
  });
}

export function SidebarRail() {
  const access = useCrmAccess();
  const [flyout, setFlyout] = useState<RailFlyout>(null);
  const [activeLabel, setActiveLabel] = useState<CrmSectionLabel | null>(null);
  const [activeSettingsTab, setActiveSettingsTab] = useState<SettingsTab>("schedule");
  const desiredDesktopExpanded = useRef(false);
  const reconcilingDesktopState = useRef(false);

  const canSettingsTab = useCallback((tab: SettingsTab) => {
    if (!access.enforced) return true;
    if (tab === "personnel") return access.can(PERMISSIONS.PERSONNEL_READ);
    if (tab === "cash") return access.can(PERMISSIONS.FINANCE_READ);
    if (tab === "integrations") return access.can(PERMISSIONS.SETTINGS_INTEGRATIONS);
    if (tab === "security") return access.can(PERMISSIONS.SECURITY_ACCESS_MANAGE);
    return access.can(PERMISSIONS.SETTINGS_READ);
  }, [access]);

  const visibleSettingsItems = SETTINGS_NAV_ITEMS.filter((item) => canSettingsTab(item.id));
  const canOpenSettings = visibleSettingsItems.length > 0;

  const selectedGroup = flyout
    ? CRM_NAV_GROUPS.find((group) => group.label === flyout.groupLabel) ?? null
    : null;
  const flyoutItems = selectedGroup?.items.filter((item) => {
    if (!access.enforced) return true;
    if (item.slug === "settings") return canOpenSettings;
    return access.canOpenCabinet(item.slug);
  }) ?? [];

  const syncLocationState = useCallback(() => {
    const url = new URL(window.location.href);
    setActiveLabel(sectionFromSlug(url.searchParams.get("section")));
    const settingsTab = url.searchParams.get("settingsTab");
    setActiveSettingsTab(isSettingsTab(settingsTab) ? settingsTab : "schedule");
  }, []);

  const reconcileDesktopExpansion = useCallback(() => {
    if (!isDesktop() || reconcilingDesktopState.current) return;
    const button = sidebarToggle();
    if (!button) return;
    const actualExpanded = button.getAttribute("aria-expanded") === "true";
    const desiredExpanded = desiredDesktopExpanded.current;
    if (actualExpanded === desiredExpanded) return;

    reconcilingDesktopState.current = true;
    button.click();
    requestAnimationFrame(() => {
      reconcilingDesktopState.current = false;
    });
  }, []);

  const queueDesktopReconcile = useCallback(() => {
    requestAnimationFrame(() => requestAnimationFrame(reconcileDesktopExpansion));
  }, [reconcileDesktopExpansion]);

  useEffect(() => {
    desiredDesktopExpanded.current = readDesktopExpandedPreference();

    const isDesktopCompact = () => isDesktop()
      && sidebarToggle()?.getAttribute("aria-expanded") === "false";

    const groupLabelFromButton = (button: HTMLButtonElement) => {
      const semantic = button.dataset.railGroupLabel?.trim();
      if (semantic && CRM_NAV_GROUPS.some((group) => group.label === semantic)) return semantic;
      const fallback = button.querySelector("span")?.textContent?.trim() ?? "";
      return CRM_NAV_GROUPS.some((group) => group.label === fallback) ? fallback : "";
    };

    const onClickCapture = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;

      const toggle = target.closest(SIDEBAR_TOGGLE_SELECTOR);
      if (toggle instanceof HTMLButtonElement && isDesktop()) {
        if (!reconcilingDesktopState.current) {
          const nextExpanded = toggle.getAttribute("aria-expanded") !== "true";
          desiredDesktopExpanded.current = nextExpanded;
          writeDesktopExpandedPreference(nextExpanded);
          setFlyout(null);
        }
        return;
      }

      if (!isDesktopCompact()) return;
      const button = target.closest(GROUP_BUTTON_SELECTOR);
      if (!(button instanceof HTMLButtonElement)) return;
      const label = groupLabelFromButton(button);
      if (!label) return;

      event.preventDefault();
      event.stopPropagation();
      syncLocationState();
      const rect = button.getBoundingClientRect();
      const top = Math.max(8, Math.min(rect.top - 6, window.innerHeight - 180));
      const left = Math.max(8, Math.min(rect.right + 8, window.innerWidth - 292));
      setFlyout((current) => current?.groupLabel === label ? null : { groupLabel: label, top, left });
    };

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest(".crmRailFlyout")) return;
      if (target.closest(GROUP_BUTTON_SELECTOR)) return;
      setFlyout(null);
    };

    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFlyout(null);
    };

    const onScroll = (event: Event) => {
      const target = event.target;
      if (target instanceof Element && target.closest(".crmRailFlyout")) return;
      setFlyout(null);
    };

    const onRouteChanged = () => {
      syncLocationState();
      setFlyout(null);
      queueDesktopReconcile();
    };

    const onResize = () => {
      setFlyout(null);
      queueDesktopReconcile();
    };

    syncLocationState();
    queueDesktopReconcile();

    const sidebar = document.querySelector(".sidebar");
    const observer = new MutationObserver(() => queueDesktopReconcile());
    if (sidebar) {
      observer.observe(sidebar, {
        attributes: true,
        attributeFilter: ["aria-expanded"],
        childList: true,
        subtree: true,
      });
    }

    document.addEventListener("click", onClickCapture, true);
    document.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onEscape);
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("popstate", onRouteChanged);
    window.addEventListener("turbolev:navigate", onRouteChanged as EventListener);

    return () => {
      observer.disconnect();
      document.removeEventListener("click", onClickCapture, true);
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onEscape);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("popstate", onRouteChanged);
      window.removeEventListener("turbolev:navigate", onRouteChanged as EventListener);
    };
  }, [queueDesktopReconcile, syncLocationState]);

  useEffect(() => {
    document.body.classList.toggle("crm-rail-flyout-open", Boolean(flyout));
    return () => document.body.classList.remove("crm-rail-flyout-open");
  }, [flyout]);

  const openSection = (label: CrmSectionLabel) => {
    setActiveLabel(label);
    setFlyout(null);
    window.dispatchEvent(new CustomEvent("turbolev:navigate", { detail: label }));
    blurActiveElement();
  };

  const openSettings = (tab: SettingsTab) => {
    const url = new URL(window.location.href);
    url.searchParams.set("section", "settings");
    url.searchParams.set("settingsTab", tab);
    url.searchParams.delete("filter");
    url.searchParams.delete("filterLabel");
    for (const key of CRM_ROUTE_KEYS) url.searchParams.delete(key);

    setActiveLabel("Налаштування");
    setActiveSettingsTab(tab);
    setFlyout(null);
    window.history.pushState({}, "", `${url.pathname}${url.search}${url.hash}`);
    window.dispatchEvent(new PopStateEvent("popstate"));
    blurActiveElement();
  };

  const preferredSettingsTab = visibleSettingsItems.some((item) => item.id === activeSettingsTab)
    ? activeSettingsTab
    : visibleSettingsItems[0]?.id;

  return <>
    {flyout && selectedGroup && flyoutItems.length > 0 && <div
      className="crmRailFlyout"
      role="menu"
      aria-label={selectedGroup.label}
      style={{ top: flyout.top, left: flyout.left }}
    >
      <div className="crmRailFlyoutTitle">{selectedGroup.label}</div>
      {flyoutItems.map((item) => <div className="crmRailFlyoutEntry" key={item.slug}>
        <button
          type="button"
          role="menuitem"
          className={activeLabel === item.label ? "crmRailFlyoutItem crmRailFlyoutItemActive" : "crmRailFlyoutItem"}
          onClick={() => item.slug === "settings" && preferredSettingsTab
            ? openSettings(preferredSettingsTab)
            : openSection(item.label)}
        >
          <span className="crmRailFlyoutDot" aria-hidden="true"/>
          <span>{item.label === "Планувальник" ? "Записи на СТО" : item.label}</span>
          {item.label === "Нові звернення" && <small>NEW</small>}
        </button>
        {item.slug === "settings" && visibleSettingsItems.length > 0 && <div
          className="crmRailSettingsList"
          role="group"
          aria-label="Підпункти налаштувань"
        >
          {visibleSettingsItems.map((settingsItem) => <button
            key={settingsItem.id}
            type="button"
            className={activeLabel === "Налаштування" && activeSettingsTab === settingsItem.id
              ? "crmRailSettingsItem crmRailSettingsItemActive"
              : "crmRailSettingsItem"}
            onClick={() => openSettings(settingsItem.id)}
          >{settingsItem.label}</button>)}
        </div>}
      </div>)}
    </div>}
    <style jsx global>{`
      .crmRailFlyout {
        position: fixed;
        z-index: 2600;
        width: max-content;
        min-width: 220px;
        max-width: 284px;
        max-height: calc(100vh - 16px);
        overflow-y: auto;
        overscroll-behavior: contain;
        padding: 7px;
        border: 1px solid var(--line);
        border-radius: 12px;
        background: var(--panel);
        box-shadow: 0 18px 46px rgba(0,0,0,.24);
        animation: crmRailFlyoutIn .12s ease-out;
      }

      @keyframes crmRailFlyoutIn {
        from { opacity: 0; transform: translateX(-4px); }
        to { opacity: 1; transform: translateX(0); }
      }

      .crmRailFlyoutTitle {
        padding: 8px 10px 7px;
        color: var(--muted);
        font-size: 11px;
        font-weight: 700;
        letter-spacing: .08em;
        text-transform: uppercase;
      }

      .crmRailFlyoutEntry { display: block; }

      .crmRailFlyoutItem {
        width: 100%;
        min-height: 40px;
        display: flex;
        align-items: center;
        gap: 9px;
        padding: 9px 10px;
        border: 1px solid transparent;
        border-radius: 9px;
        background: transparent;
        color: var(--text);
        cursor: pointer;
        text-align: left;
        font-size: 13px;
        font-weight: 600;
      }

      .crmRailFlyoutItem:hover,
      .crmRailFlyoutItem:focus-visible {
        outline: none;
        background: var(--panel-2);
        border-color: var(--line);
      }

      .crmRailFlyoutItemActive {
        color: var(--orange);
        background: rgba(255,102,0,.08);
        border-color: rgba(255,102,0,.18);
      }

      .crmRailFlyoutDot {
        width: 7px;
        height: 7px;
        flex: 0 0 7px;
        border-radius: 50%;
        background: currentColor;
        opacity: .55;
      }

      .crmRailFlyoutItemActive .crmRailFlyoutDot {
        opacity: 1;
        box-shadow: 0 0 0 4px rgba(255,102,0,.10);
      }

      .crmRailFlyoutItem small {
        margin-left: auto;
        color: var(--orange);
        font-size: 9px;
        font-weight: 800;
        letter-spacing: .06em;
      }

      .crmRailSettingsList {
        display: grid;
        gap: 2px;
        margin: 2px 0 6px 16px;
        padding: 3px 0 3px 9px;
        border-left: 1px solid var(--line);
      }

      .crmRailSettingsItem {
        width: 100%;
        min-height: 32px;
        padding: 6px 8px;
        border: 1px solid transparent;
        border-radius: 7px;
        background: transparent;
        color: var(--muted);
        cursor: pointer;
        text-align: left;
        font-size: 12px;
        font-weight: 550;
      }

      .crmRailSettingsItem:hover,
      .crmRailSettingsItem:focus-visible {
        outline: none;
        color: var(--text);
        background: var(--panel-2);
        border-color: var(--line);
      }

      .crmRailSettingsItemActive {
        color: var(--orange);
        background: rgba(255,102,0,.07);
      }

      @media (min-width: 761px) {
        .shell { transition: grid-template-columns .18s ease; }
        .sidebar {
          overflow: visible;
          transition: padding .18s ease, background .18s ease, border-color .18s ease;
        }

        .sidebar > button[aria-controls="crm-primary-navigation"] {
          position: absolute;
          top: 22px;
          right: 14px;
          z-index: 120;
          display: grid !important;
          width: 30px;
          height: 30px;
          place-items: center;
          padding: 0;
          border: 1px solid var(--line);
          border-radius: 9px;
          background: var(--panel-2);
          color: var(--muted);
          box-shadow: none;
          cursor: pointer;
          line-height: 1;
          transition: background .16s ease, color .16s ease, border-color .16s ease;
        }

        .sidebar > button[aria-controls="crm-primary-navigation"]:hover {
          color: var(--orange);
          border-color: rgba(255,102,0,.4);
          background: var(--panel);
        }

        .sidebar > button[aria-controls="crm-primary-navigation"]:focus-visible {
          outline: none;
          box-shadow: 0 0 0 3px rgba(255,102,0,.18);
        }

        .sidebar > button[aria-controls="crm-primary-navigation"] > span { font-size: 0; }
        .sidebar > button[aria-controls="crm-primary-navigation"] > span::before {
          content: "‹";
          display: block;
          font-size: 20px;
          font-weight: 600;
          transform: translateY(-1px);
        }
        .sidebar > button[aria-controls="crm-primary-navigation"][aria-expanded="false"] > span::before { content: "›"; }

        .sidebar:has(> button[aria-controls="crm-primary-navigation"][aria-expanded="false"]) nav > section {
          position: relative;
        }

        .sidebar:has(> button[aria-controls="crm-primary-navigation"][aria-expanded="false"]) nav > section > button {
          --rail-icon: none;
          position: relative;
          z-index: 2;
          gap: 0 !important;
          border: 1px solid transparent !important;
          background: transparent !important;
          color: var(--muted) !important;
          overflow: visible;
          transition: background .14s ease, color .14s ease, border-color .14s ease, transform .14s ease !important;
        }

        .sidebar:has(> button[aria-controls="crm-primary-navigation"][aria-expanded="false"]) nav > section > button::before {
          content: "";
          width: 18px;
          height: 18px;
          flex: 0 0 18px;
          background: currentColor;
          -webkit-mask: var(--rail-icon) center / 18px 18px no-repeat;
          mask: var(--rail-icon) center / 18px 18px no-repeat;
        }

        .sidebar:has(> button[aria-controls="crm-primary-navigation"][aria-expanded="false"]) nav > section > button > span:first-child {
          position: absolute;
          left: 44px;
          top: 50%;
          z-index: 180;
          width: max-content;
          max-width: 230px;
          padding: 7px 9px;
          border: 1px solid var(--line);
          border-radius: 8px;
          background: var(--panel);
          color: var(--text);
          box-shadow: 0 10px 28px rgba(0,0,0,.20);
          font-size: 12px;
          font-weight: 650;
          letter-spacing: 0;
          line-height: 1.2;
          text-transform: none;
          white-space: nowrap;
          opacity: 0;
          visibility: hidden;
          pointer-events: none;
          transform: translate(-4px,-50%);
          transition: opacity .12s ease, transform .12s ease, visibility .12s ease;
        }

        .sidebar:has(> button[aria-controls="crm-primary-navigation"][aria-expanded="false"]) nav > section > button > i { display: none; }

        .sidebar:has(> button[aria-controls="crm-primary-navigation"][aria-expanded="false"]) nav > section > button:hover,
        .sidebar:has(> button[aria-controls="crm-primary-navigation"][aria-expanded="false"]) nav > section > button:focus-visible {
          background: var(--panel-2) !important;
          color: var(--text) !important;
          border-color: var(--line) !important;
          transform: translateY(-1px);
        }

        .sidebar:has(> button[aria-controls="crm-primary-navigation"][aria-expanded="false"]) nav > section > button:hover > span:first-child,
        .sidebar:has(> button[aria-controls="crm-primary-navigation"][aria-expanded="false"]) nav > section > button:focus-visible > span:first-child {
          opacity: 1;
          visibility: visible;
          transform: translate(0,-50%);
        }

        .crm-rail-flyout-open .sidebar:has(> button[aria-controls="crm-primary-navigation"][aria-expanded="false"]) nav > section > button > span:first-child {
          opacity: 0 !important;
          visibility: hidden !important;
        }

        .sidebar:has(> button[aria-controls="crm-primary-navigation"][aria-expanded="false"]) nav > section > div { display: none !important; }

        .sidebar:has(> button[aria-controls="crm-primary-navigation"][aria-expanded="false"]) .sidebarFoot {
          display: flex;
          align-items: center;
          justify-content: center;
          border-top: 1px solid var(--line);
          text-align: center;
          font-size: 0;
        }

        .sidebar:has(> button[aria-controls="crm-primary-navigation"][aria-expanded="false"]) .liveDot {
          margin-right: 0;
          box-shadow: 0 0 0 4px rgba(43,182,115,.08);
        }
      }

      @media (max-width: 760px) {
        .crmRailFlyout { display: none !important; }
      }
    `}</style>
  </>;
}
