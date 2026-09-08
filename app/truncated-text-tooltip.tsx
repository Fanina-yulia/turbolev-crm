"use client";

import { createPortal } from "react-dom";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import styles from "./truncated-text-tooltip.module.css";

type TooltipPosition = { top: number; left: number; width: number };

type TruncatedTextTooltipProps = {
  text: string;
  children?: ReactNode;
  className?: string;
  tooltipClassName?: string;
  focusable?: boolean;
};

/** Keeps compact CRM rows stable while making the complete value available on hover, focus and touch. */
export function TruncatedTextTooltip({ text, children, className, tooltipClassName, focusable = true }: TruncatedTextTooltipProps) {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLSpanElement>(null);
  const tooltipId = `crm-tooltip-${useId().replace(/:/g, "")}`;
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<TooltipPosition>({ top: 0, left: 12, width: 320 });

  const updatePosition = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const width = Math.min(420, Math.max(220, window.innerWidth - 24));
    setPosition(() => ({
      width,
      left: Math.min(Math.max(12, rect.left), Math.max(12, window.innerWidth - width - 12)),
      top: rect.bottom + 8,
    }));
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    updatePosition();
    const tooltip = tooltipRef.current;
    const anchor = anchorRef.current;
    if (!tooltip || !anchor) return;
    const anchorRect = anchor.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();
    const width = Math.min(420, Math.max(220, window.innerWidth - 24));
    const left = Math.min(Math.max(12, anchorRect.left), Math.max(12, window.innerWidth - width - 12));
    const belowTop = anchorRect.bottom + 8;
    const top = belowTop + tooltipRect.height <= window.innerHeight - 12
      ? belowTop
      : Math.max(12, anchorRect.top - tooltipRect.height - 8);
    setPosition({ top, left, width });
  }, [open, text, updatePosition]);

  useEffect(() => {
    if (!open) return;
    const reposition = () => updatePosition();
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [open, updatePosition]);

  function onKeyDown(event: KeyboardEvent<HTMLSpanElement>) {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    setOpen((value) => !value);
  }

  const tooltip = open && typeof document !== "undefined"
    ? createPortal(
      <span
        ref={tooltipRef}
        id={tooltipId}
        role="tooltip"
        className={`${styles.tooltip} ${tooltipClassName || ""}`}
        style={{ top: position.top, left: position.left, width: position.width }}
      >
        {text}
      </span>,
      document.body,
    )
    : null;

  return <>
    <span
      ref={anchorRef}
      className={`${styles.anchor} ${className || ""}`}
      tabIndex={focusable ? 0 : undefined}
      aria-describedby={open ? tooltipId : undefined}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={focusable ? () => setOpen(true) : undefined}
      onBlur={focusable ? () => setOpen(false) : undefined}
      onClick={() => setOpen(true)}
      onKeyDown={focusable ? onKeyDown : undefined}
    >
      <span className={styles.value}>{children ?? text}</span>
    </span>
    {tooltip}
  </>;
}
