"use client";

import { useEffect } from "react";

const GROUP_ICON_KEY: Record<string, string> = {
  "Робочий стіл": "dashboard",
  "Звернення": "inbox",
  "Клієнти та авто": "clients",
  "Сервіс": "service",
  "Запчастини": "parts",
  "Фінанси": "finance",
  "Управління": "management",
};

export function SidebarFinalPolish() {
  useEffect(() => {
    const decorate = () => {
      document.querySelectorAll('.sidebar nav > section > button[aria-expanded]').forEach((node) => {
        if (!(node instanceof HTMLButtonElement)) return;
        const label = node.querySelector("span")?.textContent?.trim() ?? "";
        const icon = GROUP_ICON_KEY[label];
        if (icon) node.dataset.railIcon = icon;
        if (label) node.setAttribute("aria-label", label);
      });
    };

    decorate();
    const frame = requestAnimationFrame(decorate);
    const observer = new MutationObserver(decorate);
    const sidebar = document.querySelector(".sidebar");
    if (sidebar) observer.observe(sidebar, { childList: true, subtree: true });
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

  return <style jsx global>{`
    @media (min-width: 761px) {
      .shell:has(.sidebar > button[aria-controls="crm-primary-navigation"][aria-expanded="false"]) {
        --crm-sidebar-width: 64px;
        grid-template-columns: 64px minmax(0,1fr) !important;
      }

      .sidebar:has(> button[aria-controls="crm-primary-navigation"][aria-expanded="false"]) {
        width: 64px !important;
        min-width: 64px !important;
        max-width: 64px !important;
        padding: 12px 8px 14px !important;
        overflow: visible !important;
      }

      .sidebar:has(> button[aria-controls="crm-primary-navigation"][aria-expanded="false"]) .brand {
        width: 48px !important;
        height: 52px !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        padding: 0 !important;
        margin: 0 auto 2px !important;
      }

      .sidebar:has(> button[aria-controls="crm-primary-navigation"][aria-expanded="false"]) .brandLogoWrap {
        width: 48px !important;
        min-width: 48px !important;
        height: 48px !important;
        display: block !important;
        overflow: visible !important;
        background: transparent url("/brand/turbo-lev-rail-dark.png") center / 46px 46px no-repeat !important;
      }

      :root[data-theme="light"] .sidebar:has(> button[aria-controls="crm-primary-navigation"][aria-expanded="false"]) .brandLogoWrap {
        background-image: url("/brand/turbo-lev-rail-light.png") !important;
      }

      .sidebar:has(> button[aria-controls="crm-primary-navigation"][aria-expanded="false"]) .brandLogo {
        display: none !important;
      }

      .sidebar:has(> button[aria-controls="crm-primary-navigation"][aria-expanded="false"]) > button[aria-controls="crm-primary-navigation"] {
        position: relative !important;
        inset: auto !important;
        align-self: center !important;
        flex: 0 0 auto !important;
        width: 40px !important;
        height: 40px !important;
        margin: 2px auto 12px !important;
        padding: 0 !important;
        display: grid !important;
        place-items: center !important;
        border: 1px solid var(--line) !important;
        border-radius: 11px !important;
        background: transparent !important;
        color: var(--muted) !important;
        box-shadow: none !important;
      }

      .sidebar:has(> button[aria-controls="crm-primary-navigation"][aria-expanded="false"]) > button[aria-controls="crm-primary-navigation"]:hover,
      .sidebar:has(> button[aria-controls="crm-primary-navigation"][aria-expanded="false"]) > button[aria-controls="crm-primary-navigation"]:focus-visible {
        color: var(--orange) !important;
        border-color: rgba(255,102,0,.32) !important;
        background: var(--panel-2) !important;
        outline: none !important;
      }

      .sidebar:has(> button[aria-controls="crm-primary-navigation"][aria-expanded="false"]) > button[aria-controls="crm-primary-navigation"] > span {
        display: block !important;
        width: 9px !important;
        height: 9px !important;
        font-size: 0 !important;
        border-right: 2px solid currentColor !important;
        border-bottom: 2px solid currentColor !important;
        transform: rotate(-45deg) !important;
      }

      .sidebar:has(> button[aria-controls="crm-primary-navigation"][aria-expanded="false"]) [data-global-search-host] {
        display: none !important;
      }

      .sidebar:has(> button[aria-controls="crm-primary-navigation"][aria-expanded="false"]) nav {
        width: 48px !important;
        max-width: 48px !important;
        align-items: center !important;
        gap: 8px !important;
        padding: 0 !important;
        overflow-x: visible !important;
        overflow-y: auto !important;
        scrollbar-width: none;
      }

      .sidebar:has(> button[aria-controls="crm-primary-navigation"][aria-expanded="false"]) nav::-webkit-scrollbar {
        display: none;
      }

      .sidebar:has(> button[aria-controls="crm-primary-navigation"][aria-expanded="false"]) nav > section {
        width: 48px !important;
        max-width: 48px !important;
        margin: 0 !important;
        gap: 0 !important;
      }

      .sidebar:has(> button[aria-controls="crm-primary-navigation"][aria-expanded="false"]) nav > section > button {
        --rail-icon: none;
        width: 44px !important;
        min-width: 44px !important;
        max-width: 44px !important;
        height: 44px !important;
        min-height: 44px !important;
        margin: 0 auto !important;
        padding: 0 !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        gap: 0 !important;
        border: 1px solid transparent !important;
        border-radius: 12px !important;
        background: transparent !important;
        color: var(--muted) !important;
        box-shadow: none !important;
      }

      .sidebar:has(> button[aria-controls="crm-primary-navigation"][aria-expanded="false"]) nav > section > button::before {
        content: "" !important;
        width: 21px !important;
        height: 21px !important;
        flex: 0 0 21px !important;
        background: currentColor !important;
        -webkit-mask: var(--rail-icon) center / 21px 21px no-repeat !important;
        mask: var(--rail-icon) center / 21px 21px no-repeat !important;
      }

      .sidebar nav > section > button[data-rail-icon="dashboard"] { --rail-icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Crect x='3' y='3' width='7' height='7' rx='2' fill='black'/%3E%3Crect x='14' y='3' width='7' height='7' rx='2' fill='black'/%3E%3Crect x='3' y='14' width='7' height='7' rx='2' fill='black'/%3E%3Crect x='14' y='14' width='7' height='7' rx='2' fill='black'/%3E%3C/svg%3E"); }
      .sidebar nav > section > button[data-rail-icon="inbox"] { --rail-icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm0 2v8h4.1l1.4 2h5l1.4-2H20V6H4Z' fill='black'/%3E%3C/svg%3E"); }
      .sidebar nav > section > button[data-rail-icon="clients"] { --rail-icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M7 3a4 4 0 1 1 0 8 4 4 0 0 1 0-8Zm10 1a3 3 0 1 1 0 6 3 3 0 0 1 0-6ZM1.5 20a5.5 5.5 0 0 1 11 0v1h-11v-1Zm12.2 1c.2-.7.3-1.4.3-2.1 0-1.5-.5-2.9-1.3-4a4.8 4.8 0 0 1 8.8 2.6V21h-7.8Z' fill='black'/%3E%3C/svg%3E"); }
      .sidebar nav > section > button[data-rail-icon="service"] { --rail-icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M21.2 5.1a6 6 0 0 1-7.6 7.7l-6.8 6.8a2.5 2.5 0 1 1-3.5-3.5l6.8-6.8a6 6 0 0 1 7.7-7.6l-3.5 3.5 2.5 2.5 4.4-2.6Z' fill='black'/%3E%3C/svg%3E"); }
      .sidebar nav > section > button[data-rail-icon="parts"] { --rail-icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='m12 2 9 4.5v11L12 22l-9-4.5v-11L12 2Zm0 2.3L6.2 7.2 12 10l5.8-2.8L12 4.3ZM5 9v7.3l6 3v-7.4L5 9Zm8 10.3 6-3V9l-6 2.9v7.4Z' fill='black'/%3E%3C/svg%3E"); }
      .sidebar nav > section > button[data-rail-icon="finance"] { --rail-icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M4 4h14a3 3 0 0 1 3 3v1h-5a4 4 0 0 0 0 8h5v1a3 3 0 0 1-3 3H4a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3Zm12 6h6v4h-6a2 2 0 1 1 0-4Z' fill='black'/%3E%3C/svg%3E"); }
      .sidebar nav > section > button[data-rail-icon="management"] { --rail-icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M3 20h18v2H3v-2Zm2-8h3v6H5v-6Zm5-5h3v11h-3V7Zm5 3h3v8h-3v-8Zm4-6h2v14h-2V4Z' fill='black'/%3E%3C/svg%3E"); }

      .sidebar:has(> button[aria-controls="crm-primary-navigation"][aria-expanded="false"]) nav > section > button:hover,
      .sidebar:has(> button[aria-controls="crm-primary-navigation"][aria-expanded="false"]) nav > section > button:focus-visible {
        color: var(--text) !important;
        background: var(--panel-2) !important;
        border-color: var(--line) !important;
        transform: translateY(-1px) !important;
        outline: none !important;
      }

      .sidebar:has(> button[aria-controls="crm-primary-navigation"][aria-expanded="false"]) nav > section:has(button[aria-current="page"]) > button {
        color: var(--orange) !important;
        background: rgba(255,102,0,.10) !important;
        border-color: rgba(255,102,0,.24) !important;
        box-shadow: inset 0 0 0 1px rgba(255,102,0,.035) !important;
      }

      .sidebar:has(> button[aria-controls="crm-primary-navigation"][aria-expanded="false"]) nav > section > button > i,
      .sidebar:has(> button[aria-controls="crm-primary-navigation"][aria-expanded="false"]) nav > section > div {
        display: none !important;
      }

      .sidebar:has(> button[aria-controls="crm-primary-navigation"][aria-expanded="false"]) nav > section > button > span:first-child {
        left: 54px !important;
        padding: 7px 10px !important;
        border-radius: 9px !important;
        background: var(--panel) !important;
        border: 1px solid var(--line) !important;
        box-shadow: 0 10px 30px rgba(0,0,0,.18) !important;
      }

      .sidebar:has(> button[aria-controls="crm-primary-navigation"][aria-expanded="false"]) .sidebarFoot {
        width: 48px !important;
        min-width: 48px !important;
        min-height: 44px !important;
        margin-top: auto !important;
        padding: 12px 0 2px !important;
        display: flex !important;
        align-items: flex-end !important;
        justify-content: center !important;
        border-top: 1px solid var(--line) !important;
        font-size: 0 !important;
        line-height: 0 !important;
        overflow: hidden !important;
      }

      .sidebar:has(> button[aria-controls="crm-primary-navigation"][aria-expanded="false"]) .liveDot {
        width: 9px !important;
        height: 9px !important;
        margin: 0 !important;
        box-shadow: 0 0 0 4px rgba(43,182,115,.10) !important;
      }

      .crmRailFlyout {
        min-width: 220px !important;
        max-width: 260px !important;
        padding: 8px !important;
        border-radius: 14px !important;
        background: var(--panel) !important;
        box-shadow: 0 18px 52px rgba(0,0,0,.22) !important;
      }

      .crmRailFlyoutItem {
        min-height: 42px !important;
        border-radius: 10px !important;
      }
    }
  `}</style>;
}
