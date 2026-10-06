"use client";

import { useEffect, useId, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { FINANCE_GLOSSARY, type FinanceGlossaryKey } from "@/src/domain/finance-glossary";
import styles from "./finance-info-tooltip.module.css";

type FinanceInfoTooltipProps = {
  term: FinanceGlossaryKey;
  label?: ReactNode;
  className?: string;
  compact?: boolean;
};

export function FinanceInfoTooltip({ term, label, className = "", compact = false }: FinanceInfoTooltipProps) {
  const entry = FINANCE_GLOSSARY[term];
  const tooltipId = useId();
  const rootRef = useRef<HTMLSpanElement>(null);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [pinned, setPinned] = useState(false);
  const open = hovered || focused || pinned;

  useEffect(() => {
    if (!pinned) return;
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setPinned(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPinned(false);
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", escape);
    };
  }, [pinned]);

  function toggle(event: ReactMouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    setPinned((value) => !value);
  }

  return (
    <span
      ref={rootRef}
      className={`${styles.term} ${compact ? styles.compact : ""} ${className}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={(event) => {
        const next = event.relatedTarget as Node | null;
        if (!next || !rootRef.current?.contains(next)) setFocused(false);
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
      {open && (
        <span id={tooltipId} role="tooltip" className={styles.tooltip}>
          <strong>{entry.title}</strong>
          <span className={styles.summary}>{entry.summary}</span>
          {entry.formula && <span><b>Як рахується:</b> {entry.formula}</span>}
          <span><b>Що це означає для СТО:</b> {entry.meaning}</span>
          <span className={styles.source}><b>Джерело:</b> {entry.source}</span>
        </span>
      )}
    </span>
  );
}
