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
        top: 92px;
        right: -15px;
        z-index: 120;
        display: grid !important;
        width: 30px;
        height: 30px;
        place-items: center;
        padding: 0;
        border: 1px solid var(--line);
        border-radius: 999px;
        background: var(--panel);
        color: var(--muted);
        box-shadow: 0 7px 20px rgba(0,0,0,.16);
        cursor: pointer;
        line-height: 1;
        transition: background .16s ease, color .16s ease, border-color .16s ease, transform .16s ease;
      }

      .sidebar > button[aria-controls="crm-primary-navigation"]:hover {
        color: var(--orange);
        border-color: rgba(255,102,0,.4);
        transform: scale(1.04);
      }

      .sidebar > button[aria-controls="crm-primary-navigation"]:focus-visible {
        outline: none;
        box-shadow: 0 0 0 3px rgba(255,102,0,.18), 0 7px 20px rgba(0,0,0,.16);
      }

      .sidebar > button[aria-controls="crm-primary-navigation"] > span {
        font-size: 0;
      }

      .sidebar > button[aria-controls="crm-primary-navigation"] > span::before {
        content: "‹";
        display: block;
        font-size: 22px;
        font-weight: 500;
        transform: translateY(-1px);
      }

      .sidebar > button[aria-controls="crm-primary-navigation"][aria-expanded="false"] > span::before {
        content: "›";
      }

      .shell:has(.sidebar > button[aria-controls="crm-primary-navigation"][aria-expanded="false"]) {
        grid-template-columns: 76px minmax(0, 1fr);
      }

      .sidebar:has(> button[aria-controls="crm-primary-navigation"][aria-expanded="false"]) {
        padding-left: 10px;
        padding-right: 10px;
      }

      .sidebar:has(> button[aria-controls="crm-primary-navigation"][aria-expanded="false"]) .brand {
        justify-content: center;
        padding-left: 0;
        padding-right: 0;
        padding-bottom: 18px;
      }

      .sidebar:has(> button[aria-controls="crm-primary-navigation"][aria-expanded="false"]) .brandLogoWrap {
        width: 52px;
        min-width: 52px;
        height: 64px;
        overflow: hidden;
      }

      .sidebar:has(> button[aria-controls="crm-primary-navigation"][aria-expanded="false"]) .brandLogo {
        width: 160px;
        max-width: none;
        transform: translateX(-3px);
      }

      .sidebar:has(> button[aria-controls="crm-primary-navigation"][aria-expanded="false"]) nav {
        align-items: center;
        overflow: visible;
        padding-right: 0;
        gap: 4px;
      }

      .sidebar:has(> button[aria-controls="crm-primary-navigation"][aria-expanded="false"]) nav > section {
        position: relative;
        width: 46px;
        margin: 0;
      }

      .sidebar:has(> button[aria-controls="crm-primary-navigation"][aria-expanded="false"]) nav > section > button {
        position: relative;
        z-index: 2;
        width: 42px !important;
        min-height: 40px !important;
        justify-content: center !important;
        gap: 0 !important;
        padding: 0 !important;
        border: 1px solid transparent !important;
        border-radius: 11px !important;
        background: transparent !important;
        overflow: visible;
      }

      .sidebar:has(> button[aria-controls="crm-primary-navigation"][aria-expanded="false"]) nav > section > button > span:first-child {
        display: block;
        width: 1.05em;
        overflow: hidden;
        white-space: nowrap;
        font-size: 13px;
        font-weight: 800;
        letter-spacing: 0 !important;
        text-transform: uppercase;
      }

      .sidebar:has(> button[aria-controls="crm-primary-navigation"][aria-expanded="false"]) nav > section > button > i {
        display: none;
      }

      .sidebar:has(> button[aria-controls="crm-primary-navigation"][aria-expanded="false"]) nav > section:has(button[aria-current="page"]) > button {
        background: rgba(255,102,0,.09) !important;
        color: var(--orange) !important;
        border-color: rgba(255,102,0,.16) !important;
      }

      .sidebar:has(> button[aria-controls="crm-primary-navigation"][aria-expanded="false"]) nav > section > button:hover,
      .sidebar:has(> button[aria-controls="crm-primary-navigation"][aria-expanded="false"]) nav > section > button:focus-visible {
        z-index: 140;
        width: 220px !important;
        justify-content: space-between !important;
        gap: 12px !important;
        padding: 0 14px !important;
        background: var(--panel) !important;
        color: var(--text) !important;
        border-color: var(--line) !important;
        box-shadow: 0 12px 32px rgba(0,0,0,.2);
      }

      .sidebar:has(> button[aria-controls="crm-primary-navigation"][aria-expanded="false"]) nav > section > button:hover > span:first-child,
      .sidebar:has(> button[aria-controls="crm-primary-navigation"][aria-expanded="false"]) nav > section > button:focus-visible > span:first-child {
        width: auto;
        overflow: visible;
        font-size: 12px;
      }

      .sidebar:has(> button[aria-controls="crm-primary-navigation"][aria-expanded="false"]) nav > section > button:hover > i,
      .sidebar:has(> button[aria-controls="crm-primary-navigation"][aria-expanded="false"]) nav > section > button:focus-visible > i {
        display: inline-grid;
      }

      .sidebar:has(> button[aria-controls="crm-primary-navigation"][aria-expanded="false"]) nav > section > div {
        align-items: center;
        gap: 3px;
        overflow: visible;
      }

      .sidebar:has(> button[aria-controls="crm-primary-navigation"][aria-expanded="false"]) nav > section > div > div {
        position: relative;
        width: 42px;
      }

      .sidebar:has(> button[aria-controls="crm-primary-navigation"][aria-expanded="false"]) nav > section > div > div > button {
        position: relative;
        z-index: 3;
        width: 42px !important;
        min-height: 36px !important;
        justify-content: center !important;
        gap: 0 !important;
        padding: 0 !important;
        overflow: hidden;
        font-size: 0 !important;
        border-radius: 10px !important;
      }

      .sidebar:has(> button[aria-controls="crm-primary-navigation"][aria-expanded="false"]) nav > section > div > div > button > span:first-child {
        width: 9px;
        height: 9px;
      }

      .sidebar:has(> button[aria-controls="crm-primary-navigation"][aria-expanded="false"]) nav > section > div > div > button:hover,
      .sidebar:has(> button[aria-controls="crm-primary-navigation"][aria-expanded="false"]) nav > section > div > div > button:focus-visible {
        z-index: 150;
        width: 220px !important;
        justify-content: flex-start !important;
        gap: 10px !important;
        padding: 9px 14px !important;
        overflow: visible;
        font-size: 14px !important;
        background: var(--panel) !important;
        color: var(--text) !important;
        border: 1px solid var(--line) !important;
        box-shadow: 0 12px 32px rgba(0,0,0,.2);
      }

      .sidebar:has(> button[aria-controls="crm-primary-navigation"][aria-expanded="false"]) nav > section > div > div > div {
        display: none !important;
      }

      .sidebar:has(> button[aria-controls="crm-primary-navigation"][aria-expanded="false"]) .sidebarFoot {
        padding-left: 0;
        padding-right: 0;
        text-align: center;
        font-size: 0;
      }

      .sidebar:has(> button[aria-controls="crm-primary-navigation"][aria-expanded="false"]) .liveDot {
        margin-right: 0;
      }
    }
  `}</style>;
}
