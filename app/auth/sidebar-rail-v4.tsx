"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { PERMISSIONS } from "@/src/security/permissions";
import { CRM_NAV_GROUPS, sectionFromSlug, type CrmSectionLabel } from "../crm-navigation";
import { navigateCrm, readCrmRoute } from "../crm-route";
import { useCrmAccess } from "../use-crm-access";

const DESKTOP_QUERY = "(min-width: 761px)";
const LABEL_DELAY_MS = 360;
const DOCK_MAX_SCALE = 2.35;
const DOCK_SIGMA_PX = 50;
const DOCK_ICON_PX = 28;
const DOCK_BASE_STEP_PX = 40;
const DOCK_ICON_GAP_PX = 7;
const DOCK_MAX_X_PX = 16;
const POINTER_STIFFNESS = 0.24;
const POINTER_DAMPING = 0.68;
const ENGAGEMENT_STIFFNESS = 0.22;
const ENGAGEMENT_DAMPING = 0.70;

type DockEngine = {
  targetY: number;
  y: number;
  velocityY: number;
  targetEngagement: number;
  engagement: number;
  velocityEngagement: number;
  inside: boolean;
  lastFrame: number | null;
};

type RouteContext = {
  filter: string;
  settingsTab: string;
  status: string;
  workOrderTab: string;
};

type FlyoutItem = {
  key: string;
  label: string;
  active?: boolean;
  onSelect: () => void;
};

const SETTINGS_SUBMENU = [
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

function displayLabel(label: string) {
  return label === "Мої задачі" ? "Центр уваги" : label;
}

function spring(value: number, velocity: number, target: number, stiffness: number, damping: number, dt: number) {
  let nextVelocity = velocity + (target - value) * stiffness * dt;
  nextVelocity *= Math.pow(damping, dt);
  return [value + nextVelocity * dt, nextVelocity] as const;
}

function DockIcon({ slug }: { slug: string }) {
  const common = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.85,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };

  switch (slug) {
    case "overview": return <svg {...common}><rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/></svg>;
    case "tasks": return <svg {...common}><path d="M9 5h10a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V9"/><path d="m3 5 2 2 4-4"/><path d="M9 12h8M9 16h6"/></svg>;
    case "communications": return <svg {...common}><path d="M21 12a8 8 0 0 1-8 8H6l-4 2 1.4-4.2A8 8 0 1 1 21 12Z"/><path d="M8 10h8M8 14h5"/></svg>;
    case "planner": return <svg {...common}><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/><path d="M8 14h3v3H8z"/></svg>;
    case "clients": return <svg {...common}><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>;
    case "vehicles": return <svg {...common}><path d="m5 17-2-1v-5l2-5h14l2 5v5l-2 1"/><path d="M5 17h14M7 17v2M17 17v2M6 11h12"/><circle cx="7" cy="14" r="1"/><circle cx="17" cy="14" r="1"/></svg>;
    case "diagnostics": return <svg {...common}><path d="M9 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4"/><path d="M9 3h6v4H9zM7 12l2 2 4-4"/><circle cx="18" cy="9" r="3"/><path d="m20.2 11.2 2.3 2.3"/></svg>;
    case "parts": return <svg {...common}><circle cx="10" cy="10" r="5"/><path d="m14 14 6 6M10 7v6M7 10h6"/><path d="M18 3h3v3"/></svg>;
    case "work-orders": return <svg {...common}><path d="M14.7 6.3a4 4 0 0 0-5 5L3 18l3 3 6.7-6.7a4 4 0 0 0 5-5l-2.5 2.5-3-3L14.7 6.3Z"/><path d="M14 18h7M17.5 14.5V21"/></svg>;
    case "warranties": return <svg {...common}><path d="M12 3 20 6v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3Z"/><path d="m8.5 12 2.2 2.2 4.8-5"/></svg>;
    case "procurement": return <svg {...common}><path d="m12 2 8 4-8 4-8-4 8-4Z"/><path d="m4 10 8 4 8-4M4 14l8 4 8-4M4 18l8 4 8-4"/></svg>;
    case "finance": return <svg {...common}><path d="M4 5h14a3 3 0 0 1 3 3v9a3 3 0 0 1-3 3H4a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3Z"/><path d="M16 10h6v5h-6a2.5 2.5 0 0 1 0-5Z"/><circle cx="16" cy="12.5" r=".6"/></svg>;
    case "payments": return <svg {...common}><rect x="2" y="5" width="20" height="14" rx="3"/><path d="M2 10h20M6 15h4"/></svg>;
    case "analytics": return <svg {...common}><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/><path d="m4 7 5-4 6 5 5-4"/></svg>;
    case "settings": return <svg {...common}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21h-4v-.1A1.7 1.7 0 0 0 8.6 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.2 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H2.4v-4h.1A1.7 1.7 0 0 0 4.2 8.6a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 8.6 4.2a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V2.4h4v.1a1.7 1.7 0 0 0 1 1.7 1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 8.6a1.7 1.7 0 0 0 .6 1 1.7 1.7 0 0 0 1.1.4h.1v4h-.1a1.7 1.7 0 0 0-1.7 1Z"/></svg>;
    default: return <svg {...common}><circle cx="12" cy="12" r="8"/></svg>;
  }
}

export function SidebarRailV4() {
  const access = useCrmAccess();
  const dockRef = useRef<HTMLDivElement>(null);
  const labelTimer = useRef<number | null>(null);
  const labelCandidate = useRef<string | null>(null);
  const frame = useRef<number | null>(null);
  const reducedMotion = useRef(false);
  const engine = useRef<DockEngine>({
    targetY: 0,
    y: 0,
    velocityY: 0,
    targetEngagement: 0,
    engagement: 0,
    velocityEngagement: 0,
    inside: false,
    lastFrame: null,
  });

  const [active, setActive] = useState<CrmSectionLabel>("Огляд станції");
  const [visibleLabelSlug, setVisibleLabelSlug] = useState<string | null>(null);
  const [routeContext, setRouteContext] = useState<RouteContext>({ filter: "", settingsTab: "", status: "", workOrderTab: "" });

  const items = useMemo(() => CRM_NAV_GROUPS.flatMap((group) => group.items.map((item, index) => ({
    ...item,
    group: group.label,
    groupStart: index === 0,
  }))).filter((item) => access.canOpenCabinet(item.slug)), [access.snapshot, access.loaded]);

  const visibleSettings = useMemo(() => SETTINGS_SUBMENU.filter((item) => {
    if (!access.enforced) return true;
    if (item.id === "personnel") return access.can(PERMISSIONS.PERSONNEL_READ);
    if (item.id === "cash") return access.can(PERMISSIONS.FINANCE_READ);
    if (item.id === "integrations") return access.can(PERMISSIONS.SETTINGS_INTEGRATIONS);
    if (item.id === "security") return access.can(PERMISSIONS.SECURITY_ACCESS_MANAGE);
    return access.can(PERMISSIONS.SETTINGS_READ);
  }), [access.enforced, access.snapshot, access.loaded]);

  useEffect(() => {
    const sync = () => {
      const url = new URL(window.location.href);
      setActive(sectionFromSlug(url.searchParams.get("section")));
      setRouteContext({
        filter: url.searchParams.get("filter") || "",
        settingsTab: url.searchParams.get("settingsTab") || "",
        status: url.searchParams.get("status") || "",
        workOrderTab: url.searchParams.get("workOrderTab") || "",
      });
    };
    sync();
    window.addEventListener("popstate", sync);
    window.addEventListener("turbolev:navigate", sync as EventListener);
    return () => {
      window.removeEventListener("popstate", sync);
      window.removeEventListener("turbolev:navigate", sync as EventListener);
    };
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => { reducedMotion.current = media.matches; };
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  useEffect(() => () => {
    if (labelTimer.current) window.clearTimeout(labelTimer.current);
    if (frame.current) cancelAnimationFrame(frame.current);
  }, []);

  const clearLabelTimer = () => {
    if (!labelTimer.current) return;
    window.clearTimeout(labelTimer.current);
    labelTimer.current = null;
  };

  const scheduleLabel = (slug: string) => {
    if (labelCandidate.current === slug && (labelTimer.current || visibleLabelSlug === slug)) return;
    clearLabelTimer();
    labelCandidate.current = slug;
    setVisibleLabelSlug(null);
    labelTimer.current = window.setTimeout(() => {
      labelTimer.current = null;
      if (labelCandidate.current === slug) setVisibleLabelSlug(slug);
    }, LABEL_DELAY_MS);
  };

  const hideLabel = () => {
    clearLabelTimer();
    labelCandidate.current = null;
    setVisibleLabelSlug(null);
  };

  const writeGeometry = () => {
    if (!dockRef.current) return;
    const slots = Array.from(dockRef.current.querySelectorAll<HTMLElement>("[data-dock-slot]"));
    if (!slots.length) return;

    const state = engine.current;
    const centers = slots.map((slot) => {
      const rect = slot.getBoundingClientRect();
      return rect.top + rect.height / 2;
    });
    const engagement = Math.max(0, Math.min(1, state.engagement));
    const scales = centers.map((center) => {
      const distance = Math.abs(center - state.y);
      const gaussian = Math.exp(-0.5 * Math.pow(distance / DOCK_SIGMA_PX, 2));
      return 1 + (DOCK_MAX_SCALE - 1) * gaussian * engagement;
    });
    const radii = scales.map((scale) => (DOCK_ICON_PX * scale) / 2);

    let pivot = 0;
    let pivotDistance = Number.POSITIVE_INFINITY;
    centers.forEach((center, index) => {
      const distance = Math.abs(center - state.y);
      if (distance < pivotDistance) {
        pivotDistance = distance;
        pivot = index;
      }
    });

    const desired = centers.slice();
    if (engagement > 0.001) {
      desired[pivot] = centers[pivot];
      for (let index = pivot - 1; index >= 0; index -= 1) {
        const required = Math.max(DOCK_BASE_STEP_PX, radii[index] + radii[index + 1] + DOCK_ICON_GAP_PX);
        desired[index] = Math.min(centers[index], desired[index + 1] - required);
      }
      for (let index = pivot + 1; index < desired.length; index += 1) {
        const required = Math.max(DOCK_BASE_STEP_PX, radii[index - 1] + radii[index] + DOCK_ICON_GAP_PX);
        desired[index] = Math.max(centers[index], desired[index - 1] + required);
      }
    }

    slots.forEach((slot, index) => {
      const button = slot.querySelector<HTMLElement>("[data-dock-item]");
      if (!button) return;
      const influence = (scales[index] - 1) / (DOCK_MAX_SCALE - 1 || 1);
      button.style.setProperty("--dock-scale", scales[index].toFixed(4));
      button.style.setProperty("--dock-y", `${(desired[index] - centers[index]).toFixed(2)}px`);
      button.style.setProperty("--dock-x", `${(DOCK_MAX_X_PX * influence).toFixed(2)}px`);
    });
  };

  const animate = (now: number) => {
    frame.current = null;
    const state = engine.current;
    const previous = state.lastFrame ?? now;
    const dt = Math.max(0.35, Math.min(2, (now - previous) / 16.667));
    state.lastFrame = now;

    if (reducedMotion.current) {
      state.y = state.targetY;
      state.engagement = state.targetEngagement;
      state.velocityY = 0;
      state.velocityEngagement = 0;
    } else {
      [state.y, state.velocityY] = spring(state.y, state.velocityY, state.targetY, POINTER_STIFFNESS, POINTER_DAMPING, dt);
      [state.engagement, state.velocityEngagement] = spring(state.engagement, state.velocityEngagement, state.targetEngagement, ENGAGEMENT_STIFFNESS, ENGAGEMENT_DAMPING, dt);
    }

    writeGeometry();

    const moving = Math.abs(state.targetY - state.y) > 0.05
      || Math.abs(state.velocityY) > 0.04
      || Math.abs(state.targetEngagement - state.engagement) > 0.002
      || Math.abs(state.velocityEngagement) > 0.002;

    if (moving && !reducedMotion.current) frame.current = requestAnimationFrame(animate);
    else state.lastFrame = null;
  };

  const kick = () => {
    if (frame.current) return;
    engine.current.lastFrame = null;
    frame.current = requestAnimationFrame(animate);
  };

  const updatePointer = (clientY: number) => {
    if (!dockRef.current || !window.matchMedia(DESKTOP_QUERY).matches) return;
    const state = engine.current;
    state.inside = true;
    state.targetY = clientY;
    if (state.engagement < 0.01 && state.y === 0) state.y = clientY;
    state.targetEngagement = 1;

    const slots = Array.from(dockRef.current.querySelectorAll<HTMLElement>("[data-dock-slot]"));
    let nearestSlug: string | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const slot of slots) {
      const rect = slot.getBoundingClientRect();
      const distance = Math.abs(rect.top + rect.height / 2 - clientY);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestSlug = slot.dataset.slug || null;
      }
    }
    if (nearestSlug && nearestDistance <= 30) scheduleLabel(nearestSlug);
    else if (labelCandidate.current) hideLabel();
    kick();
  };

  const leaveDock = () => {
    engine.current.inside = false;
    engine.current.targetEngagement = 0;
    hideLabel();
    kick();
  };

  const selectAndClose = (action: () => void) => {
    hideLabel();
    engine.current.targetEngagement = 0;
    action();
    kick();
  };

  const flyoutFor = (slug: string): FlyoutItem[] => {
    if (slug === "communications") {
      return [
        { key: "communications-all", label: "Всі комунікації", active: !routeContext.filter, onSelect: () => navigateCrm("Комунікації") },
        { key: "communications-new", label: "Нові звернення", active: routeContext.filter === "NEW", onSelect: () => navigateCrm("Комунікації", { filter: "NEW", filterLabel: "Нові" }) },
        { key: "communications-active", label: "Активні", active: routeContext.filter === "ACTIVE", onSelect: () => navigateCrm("Комунікації", { filter: "ACTIVE", filterLabel: "Активні" }) },
      ];
    }
    if (slug === "work-orders") {
      return [
        { key: "orders-all", label: "Наряди та ремонт", active: !routeContext.status && !routeContext.workOrderTab, onSelect: () => navigateCrm("Наряди та ремонт") },
        { key: "orders-estimate", label: "Комерційна пропозиція", active: routeContext.workOrderTab === "estimate", onSelect: () => navigateCrm("Комерційна пропозиція", { workOrderTab: "estimate" }) },
        { key: "orders-production", label: "Виробництво", active: routeContext.status === "IN_REPAIR", onSelect: () => navigateCrm("Виробництво", { status: "IN_REPAIR" }) },
        { key: "orders-qc", label: "Контроль якості", active: routeContext.workOrderTab === "qc" || routeContext.status === "WAITING_QC", onSelect: () => navigateCrm("Контроль якості") },
      ];
    }
    if (slug === "settings") {
      return visibleSettings.map((item) => ({
        key: `settings-${item.id}`,
        label: item.label,
        active: routeContext.settingsTab === item.id || (!routeContext.settingsTab && item.id === "schedule"),
        onSelect: () => navigateCrm("Налаштування", { settingsTab: item.id }),
      }));
    }
    return [];
  };

  return <>
    <div
      ref={dockRef}
      className="crmMacDockV4"
      aria-label="Основне меню Turbo LEV"
      onPointerMove={(event) => {
        if (event.pointerType === "touch") return;
        const target = event.target;
        if (target instanceof Element && target.closest(".crmMacDockFlyoutV4")) return;
        updatePointer(event.clientY);
      }}
      onPointerLeave={leaveDock}
    >
      <div className="crmMacDockBrandV4" aria-hidden="true"><span/></div>
      <nav className="crmMacDockItemsV4" aria-label="Розділи CRM">
        {items.map((item) => {
          const isActive = active === item.label || (item.slug === "work-orders" && ["Комерційна пропозиція", "Виробництво", "Контроль якості"].includes(active));
          const label = displayLabel(item.label);
          const flyout = flyoutFor(item.slug);
          const isVisible = visibleLabelSlug === item.slug;
          return <div
            className={`crmMacDockSlotV4 ${item.groupStart ? "crmMacDockGroupStartV4" : ""}`}
            key={item.slug}
            data-dock-slot
            data-slug={item.slug}
          >
            <button
              type="button"
              data-dock-item
              data-slug={item.slug}
              className={`crmMacDockButtonV4 ${isActive ? "crmMacDockButtonActiveV4" : ""}`}
              aria-label={label}
              aria-current={isActive ? "page" : undefined}
              aria-haspopup={flyout.length ? "menu" : undefined}
              aria-expanded={flyout.length ? isVisible : undefined}
              onFocus={() => setVisibleLabelSlug(item.slug)}
              onBlur={(event) => {
                const next = event.relatedTarget;
                if (!(next instanceof Node) || !event.currentTarget.parentElement?.contains(next)) hideLabel();
              }}
              onClick={() => selectAndClose(() => navigateCrm(item.label))}
            >
              <span className="crmMacDockGlyphV4"><DockIcon slug={item.slug}/></span>
            </button>

            {flyout.length ? <div
              className={`crmMacDockFlyoutV4 ${isVisible ? "crmMacDockFlyoutVisibleV4" : ""}`}
              role="menu"
              aria-label={label}
              onPointerEnter={() => {
                clearLabelTimer();
                labelCandidate.current = item.slug;
                setVisibleLabelSlug(item.slug);
              }}
            >
              <div className="crmMacDockFlyoutHeadV4"><small>{item.group}</small><strong>{label}</strong></div>
              <div className="crmMacDockFlyoutListV4">
                {flyout.map((subitem) => <button
                  type="button"
                  role="menuitem"
                  key={subitem.key}
                  className={subitem.active ? "crmMacDockFlyoutActiveV4" : ""}
                  onClick={() => selectAndClose(subitem.onSelect)}
                >{subitem.label}</button>)}
              </div>
            </div> : <span className={`crmMacDockTooltipV4 ${isVisible ? "crmMacDockTooltipVisibleV4" : ""}`} role="tooltip">{label}</span>}
          </div>;
        })}
      </nav>
      <div className="crmMacDockStatusV4" aria-label="Станція онлайн"><span/></div>
    </div>

    <style jsx global>{`
      @media (min-width: 761px) {
        .shell:has(> .sidebar) {
          --crm-sidebar-width: 68px !important;
          grid-template-columns: 68px minmax(0,1fr) !important;
        }

        .shell:has(> .sidebar) > .workspace {
          grid-column: 2 !important;
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

        .crmMacDockV4 {
          position: fixed;
          inset: 4px auto 4px 4px;
          z-index: 2450;
          box-sizing: border-box;
          width: 64px;
          display: flex;
          flex-direction: column;
          align-items: center;
          padding: 7px 5px 9px;
          background: color-mix(in srgb, var(--sidebar) 82%, transparent);
          border: 1px solid color-mix(in srgb, var(--line) 72%, transparent);
          border-radius: 18px;
          box-shadow: 0 14px 34px rgba(0,0,0,.12), inset 0 1px rgba(255,255,255,.05);
          backdrop-filter: blur(18px) saturate(1.16);
          -webkit-backdrop-filter: blur(18px) saturate(1.16);
          overflow: visible;
          user-select: none;
        }

        .crmMacDockBrandV4 {
          width: 50px;
          height: 42px;
          flex: 0 0 42px;
          display: grid;
          place-items: center;
          margin-bottom: 4px;
        }

        .crmMacDockBrandV4 span {
          display: block;
          width: 36px;
          height: 36px;
          background: url("/brand/turbo-lev-rail-light.png") center / contain no-repeat;
          filter: drop-shadow(0 1px 1px rgba(17,21,26,.08));
        }

        :root[data-theme="dark"] .crmMacDockBrandV4 span {
          background-image: url("/brand/turbo-lev-rail-dark.png");
          filter: drop-shadow(0 1px 1px rgba(0,0,0,.28));
        }

        .crmMacDockItemsV4 {
          width: 100%;
          min-height: 0;
          flex: 1 1 auto;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          overflow: visible;
        }

        .crmMacDockSlotV4 {
          position: relative;
          width: 54px;
          height: 40px;
          flex: 0 0 40px;
          display: grid;
          place-items: center;
          overflow: visible;
        }

        .crmMacDockGroupStartV4:not(:first-child)::before {
          content: "";
          position: absolute;
          top: -1px;
          left: 18px;
          right: 18px;
          height: 1px;
          background: color-mix(in srgb, var(--line) 48%, transparent);
          opacity: .45;
        }

        .crmMacDockButtonV4 {
          --dock-scale: 1;
          --dock-x: 0px;
          --dock-y: 0px;
          position: relative;
          z-index: 3;
          width: 40px !important;
          min-width: 40px !important;
          max-width: 40px !important;
          height: 40px !important;
          min-height: 40px !important;
          display: grid !important;
          place-items: center !important;
          padding: 0 !important;
          margin: 0 !important;
          border: 0 !important;
          border-radius: 12px !important;
          background: transparent !important;
          color: var(--muted) !important;
          overflow: visible !important;
          cursor: pointer;
          outline: none !important;
          transform: translate3d(var(--dock-x), var(--dock-y), 0);
          transform-origin: center;
          will-change: transform;
        }

        .crmMacDockGlyphV4 {
          width: 28px;
          height: 28px;
          display: grid;
          place-items: center;
          transform: scale(var(--dock-scale));
          transform-origin: center;
          will-change: transform;
          pointer-events: none;
        }

        .crmMacDockGlyphV4 svg {
          width: 28px;
          height: 28px;
          display: block;
          overflow: visible;
          vector-effect: non-scaling-stroke;
        }

        .crmMacDockButtonV4:hover,
        .crmMacDockButtonV4:focus-visible {
          color: var(--text) !important;
        }

        .crmMacDockButtonV4:hover .crmMacDockGlyphV4,
        .crmMacDockButtonV4:focus-visible .crmMacDockGlyphV4 {
          filter: drop-shadow(0 8px 14px rgba(0,0,0,.20));
        }

        .crmMacDockButtonActiveV4 {
          color: var(--orange) !important;
        }

        .crmMacDockButtonActiveV4::before {
          content: "";
          position: absolute;
          left: -8px;
          top: 50%;
          width: 5px;
          height: 5px;
          border-radius: 50%;
          background: var(--orange);
          box-shadow: 0 0 0 3px rgba(255,102,0,.11);
          transform: translateY(-50%);
        }

        .crmMacDockTooltipV4,
        .crmMacDockFlyoutV4 {
          position: absolute;
          left: 64px;
          top: 50%;
          z-index: 2700;
          color: var(--text);
          border: 1px solid color-mix(in srgb, var(--line) 76%, transparent);
          background: color-mix(in srgb, var(--panel) 94%, transparent);
          box-shadow: 0 16px 38px rgba(0,0,0,.20);
          backdrop-filter: blur(16px) saturate(1.1);
          -webkit-backdrop-filter: blur(16px) saturate(1.1);
          opacity: 0;
          visibility: hidden;
          transform: translate(-7px,-50%) scale(.97);
          transform-origin: left center;
          transition: opacity 110ms ease, transform 150ms cubic-bezier(.16,1,.3,1), visibility 110ms ease;
        }

        .crmMacDockTooltipV4 {
          width: max-content;
          max-width: 280px;
          padding: 7px 11px;
          border-radius: 10px;
          font-size: 12px;
          font-weight: 700;
          line-height: 1.2;
          white-space: nowrap;
          pointer-events: none;
        }

        .crmMacDockTooltipVisibleV4,
        .crmMacDockFlyoutVisibleV4 {
          opacity: 1;
          visibility: visible;
          transform: translate(0,-50%) scale(1);
        }

        .crmMacDockFlyoutV4 {
          width: 246px;
          max-height: min(72vh, 560px);
          padding: 8px;
          border-radius: 14px;
          overflow: auto;
          pointer-events: none;
        }

        .crmMacDockFlyoutVisibleV4 {
          pointer-events: auto;
        }

        .crmMacDockSlotV4[data-slug="settings"] .crmMacDockFlyoutV4 {
          top: auto;
          bottom: -30px;
          transform: translate(-7px,0) scale(.97);
          transform-origin: left bottom;
        }

        .crmMacDockSlotV4[data-slug="settings"] .crmMacDockFlyoutVisibleV4 {
          transform: translate(0,0) scale(1);
        }

        .crmMacDockFlyoutHeadV4 {
          display: grid;
          gap: 2px;
          padding: 5px 7px 8px;
          border-bottom: 1px solid color-mix(in srgb, var(--line) 70%, transparent);
          margin-bottom: 5px;
        }

        .crmMacDockFlyoutHeadV4 small {
          color: var(--muted);
          font-size: 10px;
          font-weight: 700;
          letter-spacing: .08em;
          text-transform: uppercase;
        }

        .crmMacDockFlyoutHeadV4 strong {
          font-size: 13px;
          line-height: 1.25;
        }

        .crmMacDockFlyoutListV4 {
          display: grid;
          gap: 2px;
        }

        .crmMacDockFlyoutListV4 button {
          width: 100%;
          min-height: 34px;
          padding: 7px 9px !important;
          border: 0 !important;
          border-radius: 9px !important;
          background: transparent !important;
          color: var(--soft-text) !important;
          text-align: left !important;
          font-size: 12px !important;
          font-weight: 550 !important;
          cursor: pointer;
        }

        .crmMacDockFlyoutListV4 button:hover,
        .crmMacDockFlyoutListV4 button:focus-visible {
          background: var(--panel-2) !important;
          color: var(--text) !important;
          outline: none;
        }

        .crmMacDockFlyoutListV4 .crmMacDockFlyoutActiveV4 {
          background: rgba(255,102,0,.09) !important;
          color: var(--orange) !important;
          font-weight: 700 !important;
        }

        .crmMacDockStatusV4 {
          width: 48px;
          height: 29px;
          flex: 0 0 29px;
          display: grid;
          place-items: center;
          margin-top: 3px;
          border-top: 1px solid color-mix(in srgb, var(--line) 60%, transparent);
        }

        .crmMacDockStatusV4 span {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: var(--green);
          box-shadow: 0 0 0 4px color-mix(in srgb, var(--green) 12%, transparent);
        }
      }

      @media (max-width: 760px) {
        .crmMacDockV4 { display: none !important; }
      }

      @media (prefers-reduced-motion: reduce) and (min-width: 761px) {
        .crmMacDockTooltipV4,
        .crmMacDockFlyoutV4 { transition: none !important; }
      }
    `}</style>
  </>;
}
