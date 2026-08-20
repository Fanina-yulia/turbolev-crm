"use client";

export function SidebarRail() {
  return <style jsx global>{`
    @media (min-width: 761px) {
      .shell {
        transition: grid-template-columns .2s ease;
      }

      .sidebar {
        overflow: visible;
        transition: padding .2s ease, background .18s ease, border-color .18s ease;
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
        transition: background .16s ease, color .16s ease, border-color .16s ease, transform .16s ease;
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

      .sidebar > button[aria-controls="crm-primary-navigation"] > span {
        font-size: 0;
      }

      .sidebar > button[aria-controls="crm-primary-navigation"] > span::before {
        content: "‹";
        display: block;
        font-size: 22px;
        font-weight: 600;
        transform: translateY(-1px);
      }

      .sidebar > button[aria-controls="crm-primary-navigation"][aria-expanded="false"] > span::before {
        content: "›";
      }

      .shell:has(.sidebar > button[aria-controls="crm-primary-navigation"][aria-expanded="false"]) {
        grid-template-columns: 72px minmax(0, 1fr);
      }

      .sidebar:has(> button[aria-controls="crm-primary-navigation"][aria-expanded="false"]) {
        padding: 16px 10px 18px;
      }

      .sidebar:has(> button[aria-controls="crm-primary-navigation"][aria-expanded="false"]) .brand {
        justify-content: center;
        padding: 0 0 12px;
      }

      .sidebar:has(> button[aria-controls="crm-primary-navigation"][aria-expanded="false"]) .brandLogoWrap {
        width: 46px;
        min-width: 46px;
        height: 52px;
        overflow: hidden;
      }

      .sidebar:has(> button[aria-controls="crm-primary-navigation"][aria-expanded="false"]) .brandLogo {
        width: 150px;
        max-width: none;
        transform: translateX(-4px);
      }

      .sidebar:has(> button[aria-controls="crm-primary-navigation"][aria-expanded="false"]) > button[aria-controls="crm-primary-navigation"] {
        top: 76px;
        right: 10px;
        width: 28px;
        height: 28px;
        border-radius: 8px;
        background: transparent;
      }

      .sidebar:has(> button[aria-controls="crm-primary-navigation"][aria-expanded="false"]) [data-global-search-host] {
        display: none !important;
      }

      .sidebar:has(> button[aria-controls="crm-primary-navigation"][aria-expanded="false"]) nav {
        align-items: center;
        overflow: visible;
        padding: 40px 0 0;
        gap: 8px;
      }

      .sidebar:has(> button[aria-controls="crm-primary-navigation"][aria-expanded="false"]) nav > section {
        position: relative;
        width: 48px;
        margin: 0;
      }

      .sidebar:has(> button[aria-controls="crm-primary-navigation"][aria-expanded="false"]) nav > section > button {
        --rail-icon: none;
        position: relative;
        z-index: 2;
        width: 44px !important;
        min-height: 44px !important;
        justify-content: center !important;
        gap: 0 !important;
        padding: 0 !important;
        border: 1px solid transparent !important;
        border-radius: 12px !important;
        background: transparent !important;
        color: var(--muted) !important;
        overflow: visible;
        transition: background .14s ease, color .14s ease, border-color .14s ease, transform .14s ease !important;
      }

      .sidebar:has(> button[aria-controls="crm-primary-navigation"][aria-expanded="false"]) nav > section > button::before {
        content: "";
        width: 21px;
        height: 21px;
        flex: 0 0 21px;
        background: currentColor;
        -webkit-mask: var(--rail-icon) center / 21px 21px no-repeat;
        mask: var(--rail-icon) center / 21px 21px no-repeat;
      }

      .sidebar:has(> button[aria-controls="crm-primary-navigation"][aria-expanded="false"]) nav > section:nth-child(1) > button {
        --rail-icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Crect x='3' y='3' width='7' height='7' rx='2' fill='black'/%3E%3Crect x='14' y='3' width='7' height='7' rx='2' fill='black'/%3E%3Crect x='3' y='14' width='7' height='7' rx='2' fill='black'/%3E%3Crect x='14' y='14' width='7' height='7' rx='2' fill='black'/%3E%3C/svg%3E");
      }

      .sidebar:has(> button[aria-controls="crm-primary-navigation"][aria-expanded="false"]) nav > section:nth-child(2) > button {
        --rail-icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm0 2v8h4.1l1.4 2h5l1.4-2H20V6H4Z' fill='black'/%3E%3C/svg%3E");
      }

      .sidebar:has(> button[aria-controls="crm-primary-navigation"][aria-expanded="false"]) nav > section:nth-child(3) > button {
        --rail-icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M7 3a4 4 0 1 1 0 8 4 4 0 0 1 0-8Zm10 1a3 3 0 1 1 0 6 3 3 0 0 1 0-6ZM1.5 20a5.5 5.5 0 0 1 11 0v1h-11v-1Zm12.2 1c.2-.7.3-1.4.3-2.1 0-1.5-.5-2.9-1.3-4a4.8 4.8 0 0 1 8.8 2.6V21h-7.8Z' fill='black'/%3E%3C/svg%3E");
      }

      .sidebar:has(> button[aria-controls="crm-primary-navigation"][aria-expanded="false"]) nav > section:nth-child(4) > button {
        --rail-icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M21.2 5.1a6 6 0 0 1-7.6 7.7l-6.8 6.8a2.5 2.5 0 1 1-3.5-3.5l6.8-6.8a6 6 0 0 1 7.7-7.6l-3.5 3.5 2.5 2.5 4.4-2.6Z' fill='black'/%3E%3C/svg%3E");
      }

      .sidebar:has(> button[aria-controls="crm-primary-navigation"][aria-expanded="false"]) nav > section:nth-child(5) > button {
        --rail-icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='m12 2 9 4.5v11L12 22l-9-4.5v-11L12 2Zm0 2.3L6.2 7.2 12 10l5.8-2.8L12 4.3ZM5 9v7.3l6 3v-7.4L5 9Zm8 10.3 6-3V9l-6 2.9v7.4Z' fill='black'/%3E%3C/svg%3E");
      }

      .sidebar:has(> button[aria-controls="crm-primary-navigation"][aria-expanded="false"]) nav > section:nth-child(6) > button {
        --rail-icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M4 4h14a3 3 0 0 1 3 3v1h-5a4 4 0 0 0 0 8h5v1a3 3 0 0 1-3 3H4a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3Zm12 6h6v4h-6a2 2 0 1 1 0-4Z' fill='black'/%3E%3C/svg%3E");
      }

      .sidebar:has(> button[aria-controls="crm-primary-navigation"][aria-expanded="false"]) nav > section:nth-child(7) > button {
        --rail-icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M3 20h18v2H3v-2Zm2-8h3v6H5v-6Zm5-5h3v11h-3V7Zm5 3h3v8h-3v-8Zm4-6h2v14h-2V4Z' fill='black'/%3E%3C/svg%3E");
      }

      .sidebar:has(> button[aria-controls="crm-primary-navigation"][aria-expanded="false"]) nav > section > button > span:first-child {
        position: absolute;
        left: 54px;
        top: 50%;
        z-index: 180;
        width: max-content;
        max-width: 230px;
        padding: 8px 10px;
        border: 1px solid var(--line);
        border-radius: 9px;
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

      .sidebar:has(> button[aria-controls="crm-primary-navigation"][aria-expanded="false"]) nav > section > button > i {
        display: none;
      }

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

      .sidebar:has(> button[aria-controls="crm-primary-navigation"][aria-expanded="false"]) nav > section:has(button[aria-current="page"]) > button {
        background: rgba(255,102,0,.09) !important;
        color: var(--orange) !important;
        border-color: rgba(255,102,0,.18) !important;
        box-shadow: inset 3px 0 0 var(--orange);
      }

      .sidebar:has(> button[aria-controls="crm-primary-navigation"][aria-expanded="false"]) nav > section > div {
        display: none !important;
      }

      .sidebar:has(> button[aria-controls="crm-primary-navigation"][aria-expanded="false"]) .sidebarFoot {
        display: flex;
        align-items: center;
        justify-content: center;
        min-height: 42px;
        padding: 12px 0 0;
        border-top: 1px solid var(--line);
        text-align: center;
        font-size: 0;
      }

      .sidebar:has(> button[aria-controls="crm-primary-navigation"][aria-expanded="false"]) .liveDot {
        width: 9px;
        height: 9px;
        margin-right: 0;
        box-shadow: 0 0 0 4px rgba(43,182,115,.08);
      }
    }
  `}</style>;
}
