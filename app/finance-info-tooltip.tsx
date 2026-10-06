"use client";

import { createPortal } from "react-dom";
import { useCallback, useEffect, useId, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { FINANCE_GLOSSARY, type FinanceGlossaryEntry, type FinanceGlossaryKey } from "@/src/domain/finance-glossary";
import styles from "./finance-info-tooltip.module.css";

type FinanceInfoTooltipProps = {
  term: FinanceGlossaryKey;
  label?: ReactNode;
  className?: string;
  compact?: boolean;
};

type OpenMode = "hover" | "focus" | "pinned" | null;
const OPEN_EVENT = "finance-info-tooltip-open";

export function FinanceInfoTooltip({ term, label, className = "", compact = false }: FinanceInfoTooltipProps) {
  const entry: FinanceGlossaryEntry = FINANCE_GLOSSARY[term];
  const tooltipId = useId();
  const instanceId = useId();
  const rootRef = useRef<HTMLSpanElement>(null);
  const hoverTimerRef = useRef<number | null>(null);
  const [mode, setMode] = useState<OpenMode>(null);
  const [mounted, setMounted] = useState(false);
  const [position, setPosition] = useState<CSSProperties>({});
  const open = mode !== null;

  useEffect(() => setMounted(true), []);

  const updatePosition = useCallback(() => {
    const anchor = rootRef.current;
    if (!anchor || typeof window === "undefined") return;

    const rect = anchor.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    if (viewportWidth <= 720) {
      setPosition({
        left: 12,
        right: 12,
        bottom: 12,
        top: "auto",
        width: "auto",
        transform: "none",
      });
      return;
    }

    const width = Math.min(320, viewportWidth - 24);
    const left = Math.min(Math.max(12, rect.left), Math.max(12, viewportWidth - width - 12));
    const roomBelow = viewportHeight - rect.bottom;
    const openAbove = roomBelow < 230 && rect.top > 230;

    setPosition({
      left,
      top: openAbove ? Math.max(12, rect.top - 8) : Math.min(viewportHeight - 12, rect.bottom + 8),
      width,
      right: "auto",
      bottom: "auto",
      transform: openAbove ? "translateY(-100%)" : "none",
    });
  }, []);

  const activate = useCallback((nextMode: Exclude<OpenMode, null>) => {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent<string>(OPEN_EVENT, { detail: instanceId }));
    }
    setMode(nextMode);
    window.requestAnimationFrame(updatePosition);
  }, [instanceId, updatePosition]);

  useEffect(() => {
    const closeWhenAnotherOpens = (event: Event) => {
      const detail = (event as CustomEvent<string>).detail;
      if (detail !== instanceId) setMode(null);
    };
    window.addEventListener(OPEN_EVENT, closeWhenAnotherOpens);
    return () => window.removeEventListener(OPEN_EVENT, closeWhenAnotherOpens);
  }, [instanceId]);

  useEffect(() => {
    if (!open) return;
    updatePosition();
    const sync = () => updatePosition();
    window.addEventListener("resize", sync);
    window.addEventListener("scroll", sync, true);
    return () => {
      window.removeEventListener("resize", sync);
      window.removeEventListener("scroll", sync, true);
    };
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMode(null);
    };
    const closePinned = (event: PointerEvent) => {
      if (mode !== "pinned") return;
      const target = event.target as Node;
      const tooltip = document.getElementById(tooltipId);
      if (!rootRef.current?.contains(target) && !tooltip?.contains(target)) setMode(null);
    };
    window.addEventListener("keydown", escape);
    window.addEventListener("pointerdown", closePinned);
    return () => {
      window.removeEventListener("keydown", escape);
      window.removeEventListener("pointerdown", closePinned);
    };
  }, [mode, open, tooltipId]);

  useEffect(() => () => {
    if (hoverTimerRef.current != null) window.clearTimeout(hoverTimerRef.current);
  }, []);

  function scheduleHoverOpen() {
    if (mode === "pinned") return;
    if (hoverTimerRef.current != null) window.clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = window.setTimeout(() => activate("hover"), 180);
  }

  function cancelHoverOpen() {
    if (hoverTimerRef.current != null) {
      window.clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    setMode((current) => current === "hover" ? null : current);
  }

  function toggle(event: ReactMouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    if (mode === "pinned") {
      setMode(null);
      return;
    }
    activate("pinned");
  }

  const tooltip = open && mounted ? createPortal(
    <div id={tooltipId} role="tooltip" className={styles.tooltip} style={position}>
      <strong>{entry.title}</strong>
      <span className={styles.summary}>{entry.summary}</span>
      {entry.formula && <span><b>Як рахується:</b> {entry.formula}</span>}
      <span><b>Для СТО:</b> {entry.meaning}</span>
      <span className={styles.source}><b>Джерело:</b> {entry.source}</span>
    </div>,
    document.body,
  ) : null;

  return (
    <>
      <span
        ref={rootRef}
        className={`${styles.term} ${compact ? styles.compact : ""} ${className}`}
        onMouseEnter={scheduleHoverOpen}
        onMouseLeave={cancelHoverOpen}
        onFocusCapture={() => activate("focus")}
        onBlurCapture={(event) => {
          const next = event.relatedTarget as Node | null;
          if (!next || !rootRef.current?.contains(next)) setMode((current) => current === "focus" ? null : current);
        }}
      >
        <span className={styles.label} aria-describedby={open ? tooltipId : undefined}>{label ?? entry.title}</span>
        <button
          type="button"
          className={styles.infoButton}
          aria-label={`Пояснення: ${entry.title}`}
          aria-expanded={open}
          aria-describedby={open ? tooltipId : undefined}
          onClick={toggle}
        >
          i
        </button>
      </span>
      {tooltip}
    </>
  );
}
