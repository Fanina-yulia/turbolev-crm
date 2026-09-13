"use client";

import { useEffect } from "react";

const DESKTOP_QUERY = "(min-width: 761px)";
const GROUP_BUTTON_SELECTOR = '.sidebar nav > section > button[aria-expanded]';
const CLOSE_DELAY_MS = 240;
const DOCK_RADIUS_PX = 118;
const DOCK_MAX_SCALE = 1.42;
const DOCK_MAX_X_PX = 9;
const DOCK_MAX_Y_PX = 8;

function smoothstep(value: number) {
  const clamped = Math.max(0, Math.min(1, value));
  return clamped * clamped * (3 - 2 * clamped);
}

export function SidebarRail() {
  useEffect(() => {
    const sidebar = document.querySelector(".sidebar");
    if (!(sidebar instanceof HTMLElement)) return;

    const media = window.matchMedia(DESKTOP_QUERY);
    let closeTimer = 0;
    let frame = 0;
    let pointerInside = false;
    let lastPointerY = 0;

    const groupButtons = () => Array.from(
      sidebar.querySelectorAll<HTMLButtonElement>(GROUP_BUTTON_SELECTOR),
    );

    const clearCloseTimer = () => {
      if (!closeTimer) return;
      window.clearTimeout(closeTimer);
      closeTimer = 0;
    };

    const resetDock = () => {
      if (frame) {
        cancelAnimationFrame(frame);
        frame = 0;
      }
      for (const button of groupButtons()) {
        button.style.removeProperty("--crm-dock-scale");
        button.style.removeProperty("--crm-dock-x");
        button.style.removeProperty("--crm-dock-y");
      }
    };

    const setOpen = (open: boolean) => {
      if (!media.matches) {
        sidebar.removeAttribute("data-rail-hover-open");
        return;
      }
      sidebar.toggleAttribute("data-rail-hover-open", open);
    };

    const scheduleClose = () => {
      clearCloseTimer();
      closeTimer = window.setTimeout(() => {
        closeTimer = 0;
        if (pointerInside || sidebar.contains(document.activeElement)) return;
        setOpen(false);
        resetDock();
      }, CLOSE_DELAY_MS);
    };

    const updateDock = () => {
      frame = 0;
      if (!media.matches || !pointerInside) return;

      for (const button of groupButtons()) {
        const rect = button.getBoundingClientRect();
        const centerY = rect.top + rect.height / 2;
        const delta = centerY - lastPointerY;
        const distance = Math.abs(delta);
        const proximity = smoothstep(1 - distance / DOCK_RADIUS_PX);
        const scale = 1 + (DOCK_MAX_SCALE - 1) * proximity;
        const shiftX = DOCK_MAX_X_PX * proximity;
        const direction = delta === 0 ? 0 : Math.sign(delta);
        const shiftY = direction * DOCK_MAX_Y_PX * proximity;

        button.style.setProperty("--crm-dock-scale", scale.toFixed(3));
        button.style.setProperty("--crm-dock-x", `${shiftX.toFixed(2)}px`);
        button.style.setProperty("--crm-dock-y", `${shiftY.toFixed(2)}px`);
      }
    };

    const queueDockUpdate = (clientY: number) => {
      lastPointerY = clientY;
      if (frame) return;
      frame = requestAnimationFrame(updateDock);
    };

    const onPointerEnter = (event: PointerEvent) => {
      if (!media.matches || event.pointerType === "touch") return;
      pointerInside = true;
      clearCloseTimer();
      setOpen(true);
      queueDockUpdate(event.clientY);
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!media.matches || event.pointerType === "touch") return;
      pointerInside = true;
      clearCloseTimer();
      setOpen(true);
      queueDockUpdate(event.clientY);
    };

    const onPointerLeave = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      pointerInside = false;
      scheduleClose();
    };

    const onFocusIn = () => {
      if (!media.matches) return;
      clearCloseTimer();
      setOpen(true);
    };

    const onFocusOut = () => {
      requestAnimationFrame(() => {
        if (!pointerInside && !sidebar.contains(document.activeElement)) scheduleClose();
      });
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !media.matches) return;
      pointerInside = false;
      clearCloseTimer();
      setOpen(false);
      resetDock();
      const active = document.activeElement;
      if (active instanceof HTMLElement && sidebar.contains(active)) active.blur();
    };

    const onMediaChange = () => {
      clearCloseTimer();
      pointerInside = false;
      setOpen(false);
      resetDock();
    };

    sidebar.addEventListener("pointerenter", onPointerEnter);
    sidebar.addEventListener("pointermove", onPointerMove);
    sidebar.addEventListener("pointerleave", onPointerLeave);
    sidebar.addEventListener("focusin", onFocusIn);
    sidebar.addEventListener("focusout", onFocusOut);
    window.addEventListener("keydown", onKeyDown);
    media.addEventListener("change", onMediaChange);

    setOpen(false);

    return () => {
      clearCloseTimer();
      resetDock();
      sidebar.removeAttribute("data-rail-hover-open");
      sidebar.removeEventListener("pointerenter", onPointerEnter);
      sidebar.removeEventListener("pointermove", onPointerMove);
      sidebar.removeEventListener("pointerleave", onPointerLeave);
      sidebar.removeEventListener("focusin", onFocusIn);
      sidebar.removeEventListener("focusout", onFocusOut);
      window.removeEventListener("keydown", onKeyDown);
      media.removeEventListener("change", onMediaChange);
    };
  }, []);

  return <style jsx global>{`
    @media (min-width: 761px) {
      .shell:has(> .sidebar) {
        --crm-sidebar-width: 56px !important;
        grid-template-columns: 56px minmax(0, 1fr) !important;
      }

      .sidebar {
        z-index: 2200;
        width: 56px !important;
        min-width: 56px !important;
        max-width: 56px !important;
        overflow: visible !important;
        isolation: isolate;
        will-change: width, box-shadow;
        transition:
          width 220ms cubic-bezier(.2,.8,.2,1),
          min-width 220ms cubic-bezier(.2,.8,.2,1),
          max-width 220ms cubic-bezier(.2,.8,.2,1),
          padding 220ms cubic-bezier(.2,.8,.2,1),
          box-shadow 180ms ease,
          background 180ms ease,
          border-color 180ms ease !important;
      }

      .sidebar[data-rail-hover-open] {
        width: 284px !important;
        min-width: 284px !important;
        max-width: 284px !important;
        padding: 10px 14px 14px !important;
        box-shadow: 18px 0 44px rgba(0,0,0,.24);
      }

      .sidebar > button[aria-controls="crm-primary-navigation"] {
        display: none !important;
      }

      .sidebar:has(> button[aria-controls="crm-primary-navigation"][aria-expanded="false"]) nav {
        width: 36px !important;
        max-width: 36px !important;
        align-items: center !important;
        gap: 6px !important;
        padding-top: 8px !important;
        overflow: visible !important;
        transition: width 190ms cubic-bezier(.2,.8,.2,1), max-width 190ms cubic-bezier(.2,.8,.2,1) !important;
      }

      .sidebar[data-rail-hover-open]:has(> button[aria-controls="crm-primary-navigation"][aria-expanded="false"]) nav {
        width: 100% !important;
        max-width: none !important;
        align-items: stretch !important;
        gap: 5px !important;
        padding-top: 4px !important;
        overflow-x: visible !important;
        overflow-y: auto !important;
      }

      .sidebar:has(> button[aria-controls="crm-primary-navigation"][aria-expanded="false"]) nav > section {
        position: relative;
        width: 36px !important;
        max-width: 36px !important;
        margin: 0 !important;
        transition: width 190ms cubic-bezier(.2,.8,.2,1), max-width 190ms cubic-bezier(.2,.8,.2,1) !important;
      }

      .sidebar[data-rail-hover-open]:has(> button[aria-controls="crm-primary-navigation"][aria-expanded="false"]) nav > section {
        width: 100% !important;
        max-width: none !important;
      }

      .sidebar:has(> button[aria-controls="crm-primary-navigation"][aria-expanded="false"]) nav > section > button {
        --rail-icon: none;
        --crm-dock-scale: 1;
        --crm-dock-x: 0px;
        --crm-dock-y: 0px;
        position: relative;
        z-index: 2;
        width: 36px !important;
        min-width: 36px !important;
        max-width: 36px !important;
        min-height: 36px !important;
        height: 36px !important;
        padding: 0 !important;
        justify-content: center !important;
        gap: 0 !important;
        border: 1px solid transparent !important;
        border-radius: 10px !important;
        background: transparent !important;
        color: var(--muted) !important;
        overflow: visible !important;
        transition:
          width 190ms cubic-bezier(.2,.8,.2,1),
          max-width 190ms cubic-bezier(.2,.8,.2,1),
          padding 190ms cubic-bezier(.2,.8,.2,1),
          gap 190ms cubic-bezier(.2,.8,.2,1),
          background 130ms ease,
          color 130ms ease,
          border-color 130ms ease !important;
      }

      .sidebar:has(> button[aria-controls="crm-primary-navigation"][aria-expanded="false"]) nav > section > button::before {
        content: "";
        width: 18px;
        height: 18px;
        flex: 0 0 18px;
        background: currentColor;
        -webkit-mask: var(--rail-icon) center / 18px 18px no-repeat;
        mask: var(--rail-icon) center / 18px 18px no-repeat;
        transform:
          translate3d(var(--crm-dock-x), var(--crm-dock-y), 0)
          scale(var(--crm-dock-scale));
        transform-origin: center;
        will-change: transform;
        transition: transform 115ms cubic-bezier(.16,1,.3,1), background 130ms ease;
      }

      .sidebar:has(> button[aria-controls="crm-primary-navigation"][aria-expanded="false"]) nav > section > button > span:first-child {
        display: block;
        width: 0;
        max-width: 0;
        overflow: hidden;
        opacity: 0;
        white-space: nowrap;
        pointer-events: none;
        transform: translateX(-6px);
        transition:
          opacity 125ms ease,
          transform 190ms cubic-bezier(.2,.8,.2,1),
          max-width 190ms cubic-bezier(.2,.8,.2,1) !important;
      }

      .sidebar:has(> button[aria-controls="crm-primary-navigation"][aria-expanded="false"]) nav > section > button > i {
        display: none !important;
      }

      .sidebar[data-rail-hover-open]:has(> button[aria-controls="crm-primary-navigation"][aria-expanded="false"]) nav > section > button {
        width: 100% !important;
        min-width: 0 !important;
        max-width: none !important;
        min-height: 38px !important;
        height: 38px !important;
        padding: 0 10px !important;
        justify-content: flex-start !important;
        gap: 11px !important;
      }

      .sidebar[data-rail-hover-open]:has(> button[aria-controls="crm-primary-navigation"][aria-expanded="false"]) nav > section > button > span:first-child {
        width: auto;
        max-width: 196px;
        overflow: hidden;
        opacity: 1;
        pointer-events: auto;
        text-overflow: ellipsis;
        transform: translateX(0);
      }

      .sidebar[data-rail-hover-open]:has(> button[aria-controls="crm-primary-navigation"][aria-expanded="false"]) nav > section > button > i {
        display: inline-grid !important;
        margin-left: auto;
      }

      .sidebar:has(> button[aria-controls="crm-primary-navigation"][aria-expanded="false"]) nav > section > button:hover,
      .sidebar:has(> button[aria-controls="crm-primary-navigation"][aria-expanded="false"]) nav > section > button:focus-visible {
        background: var(--panel-2) !important;
        color: var(--text) !important;
        border-color: var(--line) !important;
      }

      .sidebar:has(> button[aria-controls="crm-primary-navigation"][aria-expanded="false"]) nav > section:has(button[aria-current="page"]) > button {
        background: rgba(255,102,0,.085) !important;
        color: var(--orange) !important;
        border-color: rgba(255,102,0,.22) !important;
      }

      .sidebar:has(> button[aria-controls="crm-primary-navigation"][aria-expanded="false"]) nav > section:has(button[aria-current="page"]) > button::after {
        content: "";
        position: absolute;
        left: -6px;
        top: 50%;
        width: 3px;
        height: 18px;
        border-radius: 999px;
        background: var(--orange);
        transform: translateY(-50%);
      }

      .sidebar:has(> button[aria-controls="crm-primary-navigation"][aria-expanded="false"]) nav > section > div {
        display: none !important;
      }

      .sidebar[data-rail-hover-open]:has(> button[aria-controls="crm-primary-navigation"][aria-expanded="false"]) nav > section > div {
        display: flex !important;
        min-width: 0;
      }

      .sidebar[data-rail-hover-open]:has(> button[aria-controls="crm-primary-navigation"][aria-expanded="false"]) nav > section > div button {
        min-width: 0;
      }

      .sidebar:has(> button[aria-controls="crm-primary-navigation"][aria-expanded="false"]) [data-global-search-host] {
        display: none !important;
      }

      .sidebar[data-rail-hover-open]:has(> button[aria-controls="crm-primary-navigation"][aria-expanded="false"]) [data-global-search-host] {
        display: block !important;
      }

      .sidebar[data-rail-hover-open]:has(> button[aria-controls="crm-primary-navigation"][aria-expanded="false"]) .brand {
        width: 100% !important;
        min-width: 0 !important;
        height: 52px !important;
        padding: 0 8px !important;
        margin: 0 0 6px !important;
        justify-content: flex-start !important;
        overflow: hidden !important;
        background-image: none !important;
        filter: none !important;
      }

      .sidebar[data-rail-hover-open]:has(> button[aria-controls="crm-primary-navigation"][aria-expanded="false"]) .brandLogoWrap {
        display: flex !important;
        width: 196px !important;
        min-width: 196px !important;
        height: 52px !important;
        opacity: 1 !important;
        pointer-events: none !important;
      }

      .sidebar[data-rail-hover-open]:has(> button[aria-controls="crm-primary-navigation"][aria-expanded="false"]) .brandLogo {
        display: block !important;
        width: 164px !important;
        height: auto !important;
      }

      .sidebar:has(> button[aria-controls="crm-primary-navigation"][aria-expanded="false"]) .sidebarFoot {
        width: 36px !important;
        min-width: 36px !important;
        min-height: 38px !important;
        padding: 10px 0 0 !important;
        margin-top: auto !important;
        justify-content: center !important;
        font-size: 0 !important;
        line-height: 0 !important;
        overflow: hidden !important;
        white-space: nowrap !important;
        transition: width 190ms cubic-bezier(.2,.8,.2,1), font-size 120ms ease !important;
      }

      .sidebar[data-rail-hover-open]:has(> button[aria-controls="crm-primary-navigation"][aria-expanded="false"]) .sidebarFoot {
        width: 100% !important;
        min-width: 0 !important;
        justify-content: flex-start !important;
        gap: 8px !important;
        padding: 10px 8px 0 !important;
        font-size: 12px !important;
        line-height: 1.35 !important;
      }

      .sidebar:has(> button[aria-controls="crm-primary-navigation"][aria-expanded="false"]) .sidebarFoot .liveDot {
        width: 8px !important;
        height: 8px !important;
        flex: 0 0 8px !important;
        margin: 0 !important;
      }
    }

    @media (prefers-reduced-motion: reduce) and (min-width: 761px) {
      .sidebar,
      .sidebar nav,
      .sidebar nav > section,
      .sidebar nav > section > button,
      .sidebar nav > section > button::before,
      .sidebar nav > section > button > span:first-child,
      .sidebar .sidebarFoot {
        transition: none !important;
      }

      .sidebar nav > section > button::before {
        transform: none !important;
      }
    }
  `}</style>;
}
