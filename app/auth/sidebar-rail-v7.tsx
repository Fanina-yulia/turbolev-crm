"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { PERMISSIONS } from "@/src/security/permissions";
import { turboLevLogoDark, turboLevLogoLight } from "@/src/brand/logos";
import { CRM_NAV_GROUPS, sectionFromSlug, type CrmSectionLabel } from "../crm-navigation";
import { navigateCrm } from "../crm-route";
import { useCrmAccess } from "../use-crm-access";

const DESKTOP_QUERY = "(min-width: 761px)";
const EFFECT_RADIUS = 108;
const MAX_SCALE = 1.95;
const MAX_X = 25;
const POINTER_STIFFNESS = .27;
const POINTER_DAMPING = .7;
const ENGAGE_STIFFNESS = .23;
const ENGAGE_DAMPING = .72;
const WIDE_CLOSE_DELAY = 150;

const DARK = "#202a34";
const DARK_2 = "#3a4652";
const ORANGE = "#ff7417";
const LIGHT = "#f8fafc";

type Engine = {
  targetY: number;
  y: number;
  velocityY: number;
  targetEngagement: number;
  engagement: number;
  velocityEngagement: number;
  lastFrame: number | null;
};

function labelOf(label: string) {
  return label === "Мої задачі" ? "Центр уваги" : label;
}

function step(value: number, velocity: number, target: number, stiffness: number, damping: number, dt: number) {
  let v = velocity + (target - value) * stiffness * dt;
  v *= Math.pow(damping, dt);
  return [value + v * dt, v] as const;
}

function lensInfluence(distance: number) {
  const normalized = Math.min(1, Math.max(0, distance / EFFECT_RADIUS));
  const cosine = Math.cos(normalized * Math.PI / 2);
  return Math.pow(cosine, 4);
}

function GroupIcon({ group }: { group: string }) {
  const p = { viewBox: "0 0 32 32", fill: "none", "aria-hidden": true };

  switch (group) {
    case "Робочий стіл":
      return <svg {...p}><rect x="4" y="4" width="10" height="10" rx="2.6" fill={DARK}/><rect x="18" y="4" width="10" height="10" rx="2.6" fill={DARK_2}/><rect x="4" y="18" width="10" height="10" rx="2.6" fill={DARK_2}/><rect x="18" y="18" width="10" height="10" rx="2.6" fill={ORANGE}/></svg>;
    case "Робота з клієнтами":
      return <svg {...p}><path d="M13 8.5h9.5a6.5 6.5 0 0 1 0 13H20l-4 3 .7-3H13a6.5 6.5 0 1 1 0-13Z" fill={ORANGE}/><path d="M5.5 6h12a7 7 0 0 1 0 14H12l-5 3.7 1-4.1A7 7 0 0 1 5.5 6Z" fill={DARK}/><circle cx="10.5" cy="13" r="1.3" fill={LIGHT}/><circle cx="15.5" cy="13" r="1.3" fill={ORANGE}/><circle cx="20.5" cy="13" r="1.3" fill={LIGHT}/></svg>;
    case "Клієнти та авто":
      return <svg {...p}><circle cx="10" cy="9.5" r="4" fill={ORANGE}/><path d="M3.5 21.5c.5-5.1 2.9-7.6 6.5-7.6 3.5 0 5.8 2.4 6.4 7.6H3.5Z" fill={DARK}/><path d="m18 14 2.5-4.5h6l2.5 4.5 1.7 1.8v6.7a2.7 2.7 0 0 1-2.7 2.7h-8.5a2.7 2.7 0 0 1-2.7-2.7v-6.7L18 14Z" fill={DARK_2}/><rect x="18.5" y="17" width="4" height="2.5" rx="1.2" fill={ORANGE}/><rect x="25.5" y="17" width="4" height="2.5" rx="1.2" fill={ORANGE}/></svg>;
    case "Сервіс":
      return <svg {...p}><path d="M7 7h5l2-3h7l2 3h3a3 3 0 0 1 3 3v14a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V10a3 3 0 0 1 3-3h1Z" fill={DARK}/><path d="M6 17h5l2.2-5 3.1 10 2.4-7 2 3H26" stroke={ORANGE} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"/></svg>;
    case "Запчастини":
      return <svg {...p}><path d="M4 13 16 5l12 8v14H4V13Z" fill={DARK}/><path d="M8 14h16v13H8V14Z" fill={DARK_2}/><rect x="12" y="17" width="8" height="7" rx="1.5" fill={ORANGE}/><path d="M16 17v7M12 20.5h8" stroke="#b94e09" strokeWidth="1"/></svg>;
    case "Фінанси":
      return <svg {...p}><ellipse cx="11" cy="23" rx="7" ry="3.2" fill="#10161c"/><rect x="4" y="15" width="14" height="8" fill={DARK}/><ellipse cx="11" cy="15" rx="7" ry="3.2" fill={DARK_2}/><ellipse cx="21" cy="20" rx="7" ry="3.2" fill="#c95308"/><rect x="14" y="9" width="14" height="11" fill={ORANGE}/><ellipse cx="21" cy="9" rx="7" ry="3.2" fill="#ff9a42"/></svg>;
    case "Управління":
      return <svg {...p}><rect x="4" y="18" width="6" height="10" rx="2" fill={DARK_2}/><rect x="13" y="11" width="6" height="17" rx="2" fill={DARK}/><rect x="22" y="5" width="6" height="23" rx="2" fill={ORANGE}/><path d="M3 8 9 4l7 5 7-4" stroke="#c5cbd2" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></svg>;
    default:
      return <svg {...p}><circle cx="16" cy="16" r="11" fill={DARK}/><circle cx="16" cy="16" r="4" fill={ORANGE}/></svg>;
  }
}

export function SidebarRailV7() {
  const access = useCrmAccess();
  const dockRef = useRef<HTMLDivElement>(null);
  const raf = useRef<number | null>(null);
  const reduced = useRef(false);
  const wideCloseTimer = useRef<number | null>(null);
  const engine = useRef<Engine>({ targetY: 0, y: 0, velocityY: 0, targetEngagement: 0, engagement: 0, velocityEngagement: 0, lastFrame: null });

  const [active, setActive] = useState<CrmSectionLabel>("Огляд станції");
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [wideOpen, setWideOpen] = useState(false);
  const [widePinned, setWidePinned] = useState(false);

  const canSettings = !access.enforced || access.can(PERMISSIONS.SETTINGS_READ) || access.can(PERMISSIONS.SETTINGS_INTEGRATIONS) || access.can(PERMISSIONS.SECURITY_ACCESS_MANAGE);
  const groups = useMemo(() => CRM_NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => item.slug === "settings" ? canSettings : (!access.enforced || access.canOpenCabinet(item.slug))),
  })).filter((group) => group.items.length > 0), [access, canSettings]);

  const activeGroup = groups.find((group) => group.items.some((item) => item.label === active))?.label ?? null;

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

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => { reduced.current = media.matches; };
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setWidePinned(false);
      setWideOpen(false);
      setOpenGroup(null);
    };
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, []);

  useEffect(() => () => {
    if (raf.current) cancelAnimationFrame(raf.current);
    if (wideCloseTimer.current) window.clearTimeout(wideCloseTimer.current);
  }, []);

  const geometry = () => {
    const root = dockRef.current;
    if (!root) return;
    const slots = Array.from(root.querySelectorAll<HTMLElement>("[data-dock-slot]"));
    if (!slots.length) return;
    const e = engine.current;
    const engage = Math.max(0, Math.min(1, e.engagement));
    for (const slot of slots) {
      const rect = slot.getBoundingClientRect();
      const center = rect.top + rect.height / 2;
      const influence = lensInfluence(Math.abs(center - e.y)) * engage;
      const scale = 1 + (MAX_SCALE - 1) * influence;
      const x = MAX_X * Math.pow(influence, 1.35);
      slot.style.setProperty("--dock-scale", scale.toFixed(4));
      slot.style.setProperty("--dock-x", `${x.toFixed(2)}px`);
      const button = slot.querySelector<HTMLElement>("[data-dock-item]");
      if (button) button.style.zIndex = String(20 + Math.round(influence * 180));
    }
  };

  const animate = (now: number) => {
    raf.current = null;
    const e = engine.current;
    const previous = e.lastFrame ?? now;
    const dt = Math.max(.35, Math.min(2, (now - previous) / 16.667));
    e.lastFrame = now;
    if (reduced.current) {
      e.y = e.targetY;
      e.engagement = e.targetEngagement;
      e.velocityY = 0;
      e.velocityEngagement = 0;
    } else {
      [e.y, e.velocityY] = step(e.y, e.velocityY, e.targetY, POINTER_STIFFNESS, POINTER_DAMPING, dt);
      [e.engagement, e.velocityEngagement] = step(e.engagement, e.velocityEngagement, e.targetEngagement, ENGAGE_STIFFNESS, ENGAGE_DAMPING, dt);
    }
    geometry();
    const moving = Math.abs(e.targetY - e.y) > .05 || Math.abs(e.velocityY) > .04 || Math.abs(e.targetEngagement - e.engagement) > .002 || Math.abs(e.velocityEngagement) > .002;
    if (moving && !reduced.current) raf.current = requestAnimationFrame(animate);
    else e.lastFrame = null;
  };

  const kick = () => {
    if (raf.current) return;
    engine.current.lastFrame = null;
    raf.current = requestAnimationFrame(animate);
  };

  const onPointerMove = (y: number) => {
    if (!window.matchMedia(DESKTOP_QUERY).matches || wideOpen) return;
    const e = engine.current;
    e.targetY = y;
    if (e.engagement < .01 && e.y === 0) e.y = y;
    e.targetEngagement = 1;
    kick();
  };

  const resetDock = () => {
    engine.current.targetEngagement = 0;
    if (!wideOpen) setOpenGroup(null);
    kick();
  };

  const clearWideClose = () => {
    if (wideCloseTimer.current) {
      window.clearTimeout(wideCloseTimer.current);
      wideCloseTimer.current = null;
    }
  };

  const openWide = () => {
    clearWideClose();
    setOpenGroup(null);
    setWideOpen(true);
    engine.current.targetEngagement = 0;
    kick();
  };

  const scheduleWideClose = () => {
    clearWideClose();
    if (widePinned) return;
    wideCloseTimer.current = window.setTimeout(() => {
      wideCloseTimer.current = null;
      setWideOpen(false);
    }, WIDE_CLOSE_DELAY);
  };

  const toggleWidePinned = () => {
    clearWideClose();
    setWidePinned((current) => {
      const next = !current;
      setWideOpen(next || wideOpen);
      if (!next && wideOpen) setWideOpen(false);
      return next;
    });
  };

  const closeWide = () => {
    clearWideClose();
    setWidePinned(false);
    setWideOpen(false);
  };

  const openSection = (label: CrmSectionLabel) => {
    closeWide();
    setOpenGroup(null);
    navigateCrm(label);
  };

  return <>
    <div
      ref={dockRef}
      className="crmDock7"
      aria-label="Основне меню Turbo LEV"
      onPointerMove={(event) => { if (event.pointerType !== "touch") onPointerMove(event.clientY); }}
      onPointerLeave={resetDock}
    >
      <button
        type="button"
        className={`crmDockBrand7 ${wideOpen ? "crmDockBrandOpen7" : ""}`}
        aria-label="Відкрити повне меню"
        aria-expanded={wideOpen}
        onPointerEnter={openWide}
        onPointerLeave={scheduleWideClose}
        onClick={toggleWidePinned}
      ><span/></button>

      <nav className="crmDockItems7" aria-label="Групи меню CRM">
        {groups.map((group, index) => {
          const show = openGroup === group.label && !wideOpen;
          const isActive = activeGroup === group.label;
          return <div
            key={group.label}
            className={`crmDockSlot7 ${index > 0 ? "crmDockGroupStart7" : ""}`}
            data-dock-slot
          >
            <button
              type="button"
              data-dock-item
              className={`crmDockButton7 ${isActive ? "crmDockActive7" : ""}`}
              aria-label={group.label}
              aria-haspopup="menu"
              aria-expanded={show}
              onPointerEnter={() => { if (!wideOpen) setOpenGroup(group.label); }}
              onFocus={() => setOpenGroup(group.label)}
              onClick={() => setOpenGroup((current) => current === group.label ? null : group.label)}
            ><span className="crmDockGlyph7"><GroupIcon group={group.label}/></span></button>

            <div
              className={`crmDockFlyout7 ${show ? "crmDockFlyoutShow7" : ""}`}
              role="menu"
              aria-label={group.label}
              onPointerEnter={() => setOpenGroup(group.label)}
              onPointerLeave={() => setOpenGroup(null)}
            >
              <header>{group.label}</header>
              <div>
                {group.items.map((item) => <button
                  type="button"
                  role="menuitem"
                  key={item.slug}
                  className={active === item.label ? "crmDockSubActive7" : ""}
                  onClick={() => openSection(item.label)}
                >{labelOf(item.label)}</button>)}
              </div>
            </div>
          </div>;
        })}
      </nav>

      <div className="crmDockStatus7" aria-label="Станція онлайн"><span/></div>
    </div>

    {wideOpen && <div className="crmWideBackdrop7" onPointerDown={(event) => { if (event.target === event.currentTarget) closeWide(); }}>
      <aside
        className="crmWideMenu7"
        aria-label="Повне меню Turbo LEV"
        onPointerEnter={clearWideClose}
        onPointerLeave={scheduleWideClose}
      >
        <header className="crmWideHeader7">
          <div className="crmWideBrand7">
            <img className="crmWideBrandLight7" src={turboLevLogoLight} alt="Turbo LEV"/>
            <img className="crmWideBrandDark7" src={turboLevLogoDark} alt="Turbo LEV"/>
          </div>
          <button type="button" className="crmWideClose7" aria-label="Закрити меню" onClick={closeWide}>×</button>
        </header>

        <nav className="crmWideGroups7" aria-label="Розділи CRM">
          {groups.map((group) => <section key={group.label} className={`crmWideGroup7 ${activeGroup === group.label ? "crmWideGroupActive7" : ""}`}>
            <div className="crmWideGroupTitle7"><span className="crmWideGroupIcon7"><GroupIcon group={group.label}/></span><strong>{group.label}</strong></div>
            <div className="crmWideGroupItems7">
              {group.items.map((item) => <button
                type="button"
                key={item.slug}
                aria-current={active === item.label ? "page" : undefined}
                className={active === item.label ? "crmWideItemActive7" : ""}
                onClick={() => openSection(item.label)}
              >{labelOf(item.label)}</button>)}
            </div>
          </section>)}
        </nav>
      </aside>
    </div>}

    <style jsx global>{`
      @media(min-width:761px){
        .shell:has(>.sidebar){--crm-sidebar-width:72px!important;grid-template-columns:72px minmax(0,1fr)!important}
        .shell:has(>.sidebar)>.workspace{grid-column:2!important;margin-left:0!important;border-left:0!important}
        .sidebar{width:72px!important;min-width:72px!important;max-width:72px!important;padding:0!important;background:transparent!important;border:0!important;box-shadow:none!important;overflow:visible!important}
        .sidebar>*{visibility:hidden!important;pointer-events:none!important}

        .crmDock7{position:fixed;inset:4px auto 4px 4px;z-index:2470;box-sizing:border-box;width:68px;display:flex;flex-direction:column;align-items:center;padding:7px 5px 9px;background:color-mix(in srgb,var(--sidebar) 84%,transparent);border:0;border-radius:18px;box-shadow:0 14px 34px rgba(0,0,0,.13);backdrop-filter:blur(18px) saturate(1.16);-webkit-backdrop-filter:blur(18px) saturate(1.16);overflow:visible;user-select:none}
        .crmDockBrand7{width:52px!important;height:42px!important;min-height:42px!important;flex:0 0 42px!important;display:grid!important;place-items:center!important;margin:0 0 4px!important;padding:0!important;border:0!important;border-radius:13px!important;background:transparent!important;cursor:pointer!important;outline:none!important}
        .crmDockBrand7 span{display:block;width:36px;height:36px;background:url("/brand/turbo-lev-rail-light.png") center/contain no-repeat;filter:drop-shadow(0 1px 1px rgba(17,21,26,.08));transition:transform 150ms ease,filter 150ms ease}.crmDockBrand7:hover span,.crmDockBrandOpen7 span{transform:scale(1.08);filter:drop-shadow(0 6px 10px rgba(255,116,23,.18))}:root[data-theme="dark"] .crmDockBrand7 span{background-image:url("/brand/turbo-lev-rail-dark.png")}
        .crmDockItems7{width:100%;min-height:0;flex:1 1 auto;display:flex;flex-direction:column;align-items:center;justify-content:center;overflow:visible}.crmDockSlot7{--dock-scale:1;--dock-x:0px;position:relative;width:56px;height:48px;flex:0 0 48px;display:grid;place-items:center;overflow:visible}.crmDockGroupStart7::before{content:"";position:absolute;top:0;left:20px;right:20px;height:1px;background:color-mix(in srgb,var(--line) 42%,transparent);opacity:.23}
        .crmDockButton7{position:relative;width:40px!important;min-width:40px!important;max-width:40px!important;height:40px!important;min-height:40px!important;display:grid!important;place-items:center!important;padding:0!important;margin:0!important;border:0!important;border-radius:12px!important;background:transparent!important;overflow:visible!important;cursor:pointer!important;outline:none!important;transform:translate3d(var(--dock-x),0,0);will-change:transform}.crmDockGlyph7{position:relative;width:30px;height:30px;display:grid;place-items:center;transform:scale(var(--dock-scale));transform-origin:center;will-change:transform;pointer-events:none;filter:drop-shadow(0 2px 3px rgba(10,17,24,.12))}.crmDockGlyph7::before{content:"";position:absolute;inset:0;border-radius:9px;background:linear-gradient(145deg,#fff 0%,#f2f4f7 62%,#e6e9ed 100%);border:1px solid rgba(176,185,194,.42);box-shadow:inset 0 1px 1px rgba(255,255,255,.95),inset 0 -1px 2px rgba(129,140,151,.14),0 2px 5px rgba(29,39,49,.13);z-index:0}.crmDockGlyph7 svg{position:relative;z-index:1;width:24px;height:24px;display:block}.crmDockButton7:hover .crmDockGlyph7,.crmDockButton7:focus-visible .crmDockGlyph7{filter:drop-shadow(0 8px 14px rgba(0,0,0,.20))}.crmDockActive7 .crmDockGlyph7::before{border-color:rgba(255,116,23,.62);box-shadow:inset 0 1px 1px rgba(255,255,255,.95),0 0 0 2px rgba(255,116,23,.10),0 3px 8px rgba(255,116,23,.18)}.crmDockActive7::before{content:"";position:absolute;left:-8px;top:50%;width:5px;height:5px;border-radius:50%;background:var(--orange);box-shadow:0 0 0 3px rgba(255,102,0,.11);transform:translateY(-50%)}
        .crmDockFlyout7{position:absolute;left:calc(62px + var(--dock-x));top:50%;z-index:2810;width:252px;padding:8px;border-radius:14px;color:var(--text);border:1px solid color-mix(in srgb,var(--line) 76%,transparent);background:color-mix(in srgb,var(--panel) 96%,transparent);box-shadow:0 16px 38px rgba(0,0,0,.20);backdrop-filter:blur(16px);opacity:0;visibility:hidden;pointer-events:none;transform:translate(-7px,-50%) scale(.97);transform-origin:left center;transition:opacity 110ms ease,transform 150ms cubic-bezier(.16,1,.3,1),visibility 110ms ease}.crmDockFlyoutShow7{opacity:1;visibility:visible;pointer-events:auto;transform:translate(0,-50%) scale(1)}.crmDockFlyout7 header{padding:6px 8px 9px;margin-bottom:5px;border-bottom:1px solid color-mix(in srgb,var(--line) 70%,transparent);font-size:12px;font-weight:800;letter-spacing:.03em}.crmDockFlyout7>div{display:grid;gap:2px}.crmDockFlyout7 button{width:100%;min-height:36px;padding:8px 10px!important;border:0!important;border-radius:9px!important;background:transparent!important;color:var(--soft-text)!important;text-align:left!important;font-size:12px!important;font-weight:600!important;cursor:pointer!important}.crmDockFlyout7 button:hover,.crmDockFlyout7 button:focus-visible{background:var(--panel-2)!important;color:var(--text)!important}.crmDockFlyout7 .crmDockSubActive7{background:rgba(255,102,0,.09)!important;color:var(--orange)!important;font-weight:800!important}
        .crmDockStatus7{width:50px;height:29px;flex:0 0 29px;display:grid;place-items:center;margin-top:3px;border-top:1px solid color-mix(in srgb,var(--line) 55%,transparent)}.crmDockStatus7 span{width:8px;height:8px;border-radius:50%;background:var(--green);box-shadow:0 0 0 4px color-mix(in srgb,var(--green) 12%,transparent)}

        .crmWideBackdrop7{position:fixed;inset:0;z-index:2460;background:rgba(7,10,14,.22);backdrop-filter:blur(2px);-webkit-backdrop-filter:blur(2px)}
        .crmWideMenu7{position:fixed;left:76px;top:4px;bottom:4px;width:min(330px,calc(100vw - 92px));z-index:2465;display:flex;flex-direction:column;overflow:hidden;border:1px solid color-mix(in srgb,var(--line) 72%,transparent);border-radius:20px;background:color-mix(in srgb,var(--panel) 97%,transparent);box-shadow:0 20px 70px rgba(0,0,0,.30);backdrop-filter:blur(20px) saturate(1.08);animation:crmWideIn7 160ms cubic-bezier(.16,1,.3,1)}
        @keyframes crmWideIn7{from{opacity:0;transform:translateX(-14px) scale(.985)}to{opacity:1;transform:translateX(0) scale(1)}}
        .crmWideHeader7{height:74px;flex:0 0 74px;display:flex;align-items:center;justify-content:space-between;padding:12px 14px 10px;border-bottom:1px solid color-mix(in srgb,var(--line) 65%,transparent)}.crmWideBrand7{position:relative;width:176px;height:42px}.crmWideBrand7 img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;object-position:left center}.crmWideBrandDark7{display:none}:root[data-theme="dark"] .crmWideBrandLight7{display:none}:root[data-theme="dark"] .crmWideBrandDark7{display:block}.crmWideClose7{width:34px!important;height:34px!important;min-height:34px!important;padding:0!important;border:0!important;border-radius:10px!important;background:var(--panel-2)!important;color:var(--muted)!important;font-size:22px!important;line-height:1!important;cursor:pointer!important}.crmWideClose7:hover{color:var(--text)!important;background:color-mix(in srgb,var(--panel-2) 70%,var(--orange) 8%)!important}
        .crmWideGroups7{min-height:0;overflow:auto;padding:10px 10px 18px;display:grid;gap:8px}.crmWideGroup7{padding:7px;border:1px solid transparent;border-radius:14px}.crmWideGroupActive7{border-color:color-mix(in srgb,var(--orange) 24%,var(--line));background:color-mix(in srgb,var(--orange) 5%,transparent)}.crmWideGroupTitle7{height:34px;display:flex;align-items:center;gap:10px;padding:0 5px 5px}.crmWideGroupIcon7{width:26px;height:26px;display:grid;place-items:center;border-radius:8px;background:linear-gradient(145deg,#fff,#edf0f4);border:1px solid rgba(176,185,194,.42);box-shadow:0 2px 5px rgba(29,39,49,.10)}.crmWideGroupIcon7 svg{width:21px;height:21px}.crmWideGroupTitle7 strong{font-size:12px;letter-spacing:.025em}.crmWideGroupItems7{display:grid;gap:2px}.crmWideGroupItems7 button{width:100%;min-height:36px;padding:8px 11px 8px 42px!important;border:0!important;border-radius:9px!important;background:transparent!important;color:var(--soft-text)!important;text-align:left!important;font-size:12px!important;font-weight:600!important;cursor:pointer!important}.crmWideGroupItems7 button:hover,.crmWideGroupItems7 button:focus-visible{background:var(--panel-2)!important;color:var(--text)!important}.crmWideGroupItems7 .crmWideItemActive7{background:rgba(255,102,0,.10)!important;color:var(--orange)!important;font-weight:800!important;box-shadow:inset 3px 0 0 var(--orange)}
      }
      @media(max-width:760px){.crmDock7,.crmWideBackdrop7{display:none!important}}
      @media(prefers-reduced-motion:reduce) and (min-width:761px){.crmWideMenu7,.crmDockFlyout7{animation:none!important;transition:none!important}}
    `}</style>
  </>;
}
