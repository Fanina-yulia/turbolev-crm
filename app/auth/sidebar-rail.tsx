"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CRM_NAV_GROUPS, sectionFromSlug, type CrmSectionLabel } from "../crm-navigation";
import { navigateCrm } from "../crm-route";
import { useCrmAccess } from "../use-crm-access";

const DESKTOP_QUERY = "(min-width: 761px)";
const LABEL_DELAY_MS = 420;
const DOCK_RADIUS_PX = 104;
const DOCK_MAX_SCALE = 2.2;
const DOCK_MAX_X_PX = 10;
const DOCK_MAX_Y_PX = 11;

function smoothstep(value: number) {
  const clamped = Math.max(0, Math.min(1, value));
  return clamped * clamped * (3 - 2 * clamped);
}

function displayLabel(label: string) {
  return label === "Мої задачі" ? "Центр уваги" : label;
}

function DockIcon({ slug }: { slug: string }) {
  const common = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.9,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };

  switch (slug) {
    case "overview":
      return <svg {...common}><rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/></svg>;
    case "tasks":
      return <svg {...common}><path d="M9 5h10a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V9"/><path d="m3 5 2 2 4-4"/><path d="M9 12h8M9 16h6"/></svg>;
    case "communications":
      return <svg {...common}><path d="M21 12a8 8 0 0 1-8 8H6l-4 2 1.4-4.2A8 8 0 1 1 21 12Z"/><path d="M8 10h8M8 14h5"/></svg>;
    case "planner":
      return <svg {...common}><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/><path d="M8 14h3v3H8z"/></svg>;
    case "clients":
      return <svg {...common}><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>;
    case "vehicles":
      return <svg {...common}><path d="m5 17-2-1v-5l2-5h14l2 5v5l-2 1"/><path d="M5 17h14M7 17v2M17 17v2M6 11h12"/><circle cx="7" cy="14" r="1"/><circle cx="17" cy="14" r="1"/></svg>;
    case "diagnostics":
      return <svg {...common}><path d="M9 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4"/><path d="M9 3h6v4H9zM7 12l2 2 4-4"/><circle cx="18" cy="9" r="3"/><path d="m20.2 11.2 2.3 2.3"/></svg>;
    case "parts":
      return <svg {...common}><circle cx="10" cy="10" r="5"/><path d="m14 14 6 6M10 7v6M7 10h6"/><path d="M18 3h3v3"/></svg>;
    case "work-orders":
      return <svg {...common}><path d="M14.7 6.3a4 4 0 0 0-5 5L3 18l3 3 6.7-6.7a4 4 0 0 0 5-5l-2.5 2.5-3-3L14.7 6.3Z"/><path d="M14 18h7M17.5 14.5V21"/></svg>;
    case "warranties":
      return <svg {...common}><path d="M12 3 20 6v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3Z"/><path d="m8.5 12 2.2 2.2 4.8-5"/></svg>;
    case "procurement":
      return <svg {...common}><path d="m12 2 8 4-8 4-8-4 8-4Z"/><path d="m4 10 8 4 8-4M4 14l8 4 8-4M4 18l8 4 8-4"/></svg>;
    case "finance":
      return <svg {...common}><path d="M4 5h14a3 3 0 0 1 3 3v9a3 3 0 0 1-3 3H4a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3Z"/><path d="M16 10h6v5h-6a2.5 2.5 0 0 1 0-5Z"/><circle cx="16" cy="12.5" r=".6"/></svg>;
    case "payments":
      return <svg {...common}><rect x="2" y="5" width="20" height="14" rx="3"/><path d="M2 10h20M6 15h4"/></svg>;
    case "analytics":
      return <svg {...common}><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/><path d="m4 7 5-4 6 5 5-4"/></svg>;
    case "settings":
      return <svg {...common}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21h-4v-.1A1.7 1.7 0 0 0 8.6 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.2 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H2.4v-4h.1A1.7 1.7 0 0 0 4.2 8.6a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 8.6 4.2a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V2.4h4v.1a1.7 1.7 0 0 0 1 1.7 1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 8.6a1.7 1.7 0 0 0 .6 1 1.7 1.7 0 0 0 1.1.4h.1v4h-.1a1.7 1.7 0 0 0-1.7 1Z"/></svg>;
    default:
      return <svg {...common}><circle cx="12" cy="12" r="8"/></svg>;
  }
}

export function SidebarRail() {
  const access = useCrmAccess();
  const dockRef = useRef<HTMLDivElement>(null);
  const labelTimer = useRef<number | null>(null);
  const [active, setActive] = useState<CrmSectionLabel>("Огляд станції");
  const [visibleLabelSlug, setVisibleLabelSlug] = useState<string | null>(null);

  const items = useMemo(() => CRM_NAV_GROUPS.flatMap((group) => group.items.map((item, index) => ({
    ...item,
    group: group.label,
    groupStart: index === 0,
  }))).filter((item) => access.canOpenCabinet(item.slug)), [access.snapshot, access.loaded]);

  useEffect(() => {
    const sync = () => {
      const url = new URL(window.location.href);
      setActive(sectionFromSlug(url.searchParams.get("section")));
    };
    sync();
    window.addEventListener("popstate", sync);
    window.addEventListener("turbolev:navigate", sync as EventListener);
    return () => {
      window.removeEventListener("popstate", sync);
      window.removeEventListener("turbolev:navigate", sync as EventListener);
    };
  }, []);

  useEffect(() => () => {
    if (labelTimer.current) window.clearTimeout(labelTimer.current);
  }, []);

  const clearLabelTimer = () => {
    if (!labelTimer.current) return;
    window.clearTimeout(labelTimer.current);
    labelTimer.current = null;
  };

  const resetWave = () => {
    if (!dockRef.current) return;
    for (const node of dockRef.current.querySelectorAll<HTMLElement>("[data-dock-item]")) {
      node.style.removeProperty("--dock-scale");
      node.style.removeProperty("--dock-x");
      node.style.removeProperty("--dock-y");
    }
  };

  const updateWave = (clientY: number) => {
    if (!dockRef.current || !window.matchMedia(DESKTOP_QUERY).matches) return;
    for (const node of dockRef.current.querySelectorAll<HTMLElement>("[data-dock-item]")) {
      const rect = node.getBoundingClientRect();
      const centerY = rect.top + rect.height / 2;
      const delta = centerY - clientY;
      const proximity = smoothstep(1 - Math.abs(delta) / DOCK_RADIUS_PX);
      const scale = 1 + (DOCK_MAX_SCALE - 1) * proximity;
      const shiftX = DOCK_MAX_X_PX * proximity;
      const shiftY = Math.sign(delta) * DOCK_MAX_Y_PX * proximity;
      node.style.setProperty("--dock-scale", scale.toFixed(3));
      node.style.setProperty("--dock-x", `${shiftX.toFixed(2)}px`);
      node.style.setProperty("--dock-y", `${shiftY.toFixed(2)}px`);
    }
  };

  const scheduleLabel = (slug: string) => {
    clearLabelTimer();
    setVisibleLabelSlug(null);
    labelTimer.current = window.setTimeout(() => {
      labelTimer.current = null;
      setVisibleLabelSlug(slug);
    }, LABEL_DELAY_MS);
  };

  const hideLabel = (slug?: string) => {
    clearLabelTimer();
    if (!slug || visibleLabelSlug === slug) setVisibleLabelSlug(null);
  };

  return <>
    <div
      ref={dockRef}
      className="crmMacDock"
      aria-label="Основне меню Turbo LEV"
      onPointerMove={(event) => event.pointerType !== "touch" && updateWave(event.clientY)}
      onPointerLeave={() => { resetWave(); hideLabel(); }}
    >
      <div className="crmMacDockBrand" aria-hidden="true"><span/></div>
      <nav className="crmMacDockItems" aria-label="Розділи CRM">
        {items.map((item) => {
          const isActive = active === item.label || (item.slug === "work-orders" && ["Комерційна пропозиція", "Виробництво", "Контроль якості"].includes(active));
          const label = displayLabel(item.label);
          return <div className={`crmMacDockSlot ${item.groupStart ? "crmMacDockGroupStart" : ""}`} key={item.slug}>
            <button
              type="button"
              data-dock-item
              data-slug={item.slug}
              className={`crmMacDockButton ${isActive ? "crmMacDockButtonActive" : ""}`}
              aria-label={label}
              aria-current={isActive ? "page" : undefined}
              onPointerEnter={(event) => {
                if (event.pointerType === "touch") return;
                updateWave(event.clientY);
                scheduleLabel(item.slug);
              }}
              onPointerLeave={() => hideLabel(item.slug)}
              onFocus={() => setVisibleLabelSlug(item.slug)}
              onBlur={() => hideLabel(item.slug)}
              onClick={() => navigateCrm(item.label)}
            >
              <span className="crmMacDockGlyph"><DockIcon slug={item.slug}/></span>
              <span className={`crmMacDockTooltip ${visibleLabelSlug === item.slug ? "crmMacDockTooltipVisible" : ""}`} role="tooltip">{label}</span>
            </button>
          </div>;
        })}
      </nav>
      <div className="crmMacDockStatus" aria-label="Станція онлайн"><span/></div>
    </div>

    <style jsx global>{`
      @media (min-width: 761px) {
        .shell:has(> .sidebar) {
          --crm-sidebar-width: 68px !important;
          grid-template-columns: 68px minmax(0,1fr) !important;
        }

        .sidebar {
          width: 68px !important;
          min-width: 68px !important;
          max-width: 68px !important;
          padding: 0 !important;
          background: transparent !important;
          border-right: 0 !important;
          box-shadow: none !important;
          overflow: visible !important;
        }

        .sidebar > * {
          visibility: hidden !important;
          pointer-events: none !important;
        }

        .crmMacDock {
          position: fixed;
          inset: 0 auto 0 0;
          z-index: 2450;
          width: 68px;
          display: flex;
          flex-direction: column;
          align-items: center;
          padding: 8px 7px 10px;
          background: color-mix(in srgb, var(--sidebar) 96%, transparent);
          border-right: 1px solid var(--line);
          box-shadow: 8px 0 24px rgba(0,0,0,.06);
          overflow: visible;
          user-select: none;
        }

        .crmMacDockBrand {
          width: 48px;
          height: 42px;
          flex: 0 0 42px;
          display: grid;
          place-items: center;
          margin-bottom: 4px;
        }

        .crmMacDockBrand span {
          display: block;
          width: 36px;
          height: 36px;
          background: url("/brand/turbo-lev-rail-light.png") center / contain no-repeat;
          filter: drop-shadow(0 1px 1px rgba(17,21,26,.08));
        }

        :root[data-theme="dark"] .crmMacDockBrand span {
          background-image: url("/brand/turbo-lev-rail-dark.png");
          filter: drop-shadow(0 1px 1px rgba(0,0,0,.28));
        }

        .crmMacDockItems {
          width: 100%;
          min-height: 0;
          flex: 1 1 auto;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 1px;
          overflow: visible;
        }

        .crmMacDockSlot {
          position: relative;
          width: 52px;
          height: 37px;
          flex: 0 0 37px;
          display: grid;
          place-items: center;
          overflow: visible;
        }

        .crmMacDockGroupStart:not(:first-child)::before {
          content: "";
          position: absolute;
          top: -1px;
          left: 14px;
          right: 14px;
          height: 1px;
          background: color-mix(in srgb, var(--line) 65%, transparent);
          opacity: .72;
        }

        .crmMacDockButton {
          --dock-scale: 1;
          --dock-x: 0px;
          --dock-y: 0px;
          position: relative;
          z-index: 1;
          width: 38px !important;
          min-width: 38px !important;
          max-width: 38px !important;
          height: 36px !important;
          min-height: 36px !important;
          display: grid !important;
          place-items: center !important;
          padding: 0 !important;
          margin: 0 !important;
          border: 0 !important;
          border-radius: 11px !important;
          background: transparent !important;
          color: var(--muted) !important;
          overflow: visible !important;
          cursor: pointer;
          outline: none !important;
        }

        .crmMacDockGlyph {
          position: relative;
          z-index: 3;
          width: 23px;
          height: 23px;
          display: grid;
          place-items: center;
          transform:
            translate3d(var(--dock-x), var(--dock-y), 0)
            scale(var(--dock-scale));
          transform-origin: center;
          transition: transform 115ms cubic-bezier(.16,1,.3,1), color 120ms ease, filter 120ms ease;
          will-change: transform;
          pointer-events: none;
        }

        .crmMacDockGlyph svg {
          width: 23px;
          height: 23px;
          display: block;
          overflow: visible;
          vector-effect: non-scaling-stroke;
        }

        .crmMacDockButton:hover,
        .crmMacDockButton:focus-visible {
          color: var(--text) !important;
        }

        .crmMacDockButtonActive {
          color: var(--orange) !important;
        }

        .crmMacDockButtonActive::before {
          content: "";
          position: absolute;
          left: -9px;
          top: 50%;
          width: 4px;
          height: 4px;
          border-radius: 50%;
          background: var(--orange);
          box-shadow: 0 0 0 3px rgba(255,102,0,.10);
          transform: translateY(-50%);
        }

        .crmMacDockButton:hover .crmMacDockGlyph,
        .crmMacDockButton:focus-visible .crmMacDockGlyph {
          filter: drop-shadow(0 5px 8px rgba(0,0,0,.18));
        }

        .crmMacDockTooltip {
          position: absolute;
          left: 58px;
          top: 50%;
          z-index: 2600;
          width: max-content;
          max-width: 260px;
          padding: 7px 10px;
          border: 1px solid var(--line);
          border-radius: 9px;
          background: var(--panel);
          color: var(--text);
          box-shadow: 0 12px 30px rgba(0,0,0,.18);
          font-size: 12px;
          font-weight: 700;
          line-height: 1.2;
          white-space: nowrap;
          opacity: 0;
          visibility: hidden;
          pointer-events: none;
          transform: translate(-5px,-50%) scale(.97);
          transform-origin: left center;
          transition: opacity 120ms ease, transform 150ms cubic-bezier(.16,1,.3,1), visibility 120ms ease;
        }

        .crmMacDockTooltipVisible {
          opacity: 1;
          visibility: visible;
          transform: translate(0,-50%) scale(1);
        }

        .crmMacDockStatus {
          width: 48px;
          height: 30px;
          flex: 0 0 30px;
          display: grid;
          place-items: center;
          margin-top: 4px;
          border-top: 1px solid var(--line);
        }

        .crmMacDockStatus span {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: var(--green);
          box-shadow: 0 0 0 4px color-mix(in srgb, var(--green) 12%, transparent);
        }
      }

      @media (max-height: 720px) and (min-width: 761px) {
        .crmMacDock {
          padding-top: 5px;
          padding-bottom: 6px;
        }
        .crmMacDockBrand {
          height: 34px;
          flex-basis: 34px;
          margin-bottom: 1px;
        }
        .crmMacDockBrand span {
          width: 30px;
          height: 30px;
        }
        .crmMacDockSlot {
          height: 32px;
          flex-basis: 32px;
        }
        .crmMacDockButton {
          height: 31px !important;
          min-height: 31px !important;
        }
        .crmMacDockGlyph,
        .crmMacDockGlyph svg {
          width: 21px;
          height: 21px;
        }
      }

      @media (max-width: 760px) {
        .crmMacDock { display: none !important; }
      }

      @media (prefers-reduced-motion: reduce) and (min-width: 761px) {
        .crmMacDockGlyph,
        .crmMacDockTooltip {
          transition: none !important;
        }
        .crmMacDockGlyph {
          transform: none !important;
        }
      }
    `}</style>
  </>;
}
