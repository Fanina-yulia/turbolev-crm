"use client";

import { useEffect, useRef, useState } from "react";
import { extractPhoneCandidates, normalizePhoneForClipboard, phoneCandidateAtOffset } from "./phone-copy";

type Feedback = { ok: boolean; value: string };
type Pulse = { id: number; x: number; y: number };
type ResolvedPhone = { element: HTMLElement; value: string };

type CaretDocument = Document & {
  caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  caretRangeFromPoint?: (x: number, y: number) => Range | null;
};

function phoneInputValue(element: HTMLElement) {
  if (!(element instanceof HTMLInputElement)) return null;
  if (element.type !== "tel" && element.inputMode !== "tel") return null;
  const value = normalizePhoneForClipboard(element.value);
  return value ? { element, value } : null;
}

function phoneFromDataset(element: HTMLElement) {
  const marked = element.closest<HTMLElement>("[data-phone-copy-value],[data-phone-number],[data-phone]");
  if (!marked) return null;
  const raw = marked.dataset.phoneCopyValue || marked.dataset.phoneNumber || marked.dataset.phone || "";
  const value = normalizePhoneForClipboard(raw);
  return value ? { element: marked, value } : null;
}

function caretTextAtPoint(x: number, y: number) {
  const caretDocument = document as CaretDocument;
  const position = caretDocument.caretPositionFromPoint?.(x, y);
  if (position?.offsetNode.nodeType === Node.TEXT_NODE) return { node: position.offsetNode, offset: position.offset };

  const range = caretDocument.caretRangeFromPoint?.(x, y);
  if (range?.startContainer.nodeType === Node.TEXT_NODE) return { node: range.startContainer, offset: range.startOffset };
  return null;
}

function phoneAtPoint(x: number, y: number) {
  const caret = caretTextAtPoint(x, y);
  if (!caret) return null;
  const candidate = phoneCandidateAtOffset(caret.node.textContent || "", caret.offset);
  const element = caret.node.parentElement;
  return candidate && element ? { element, value: candidate.value } : null;
}

function phoneFromPhoneAnchor(element: HTMLElement) {
  const anchor = element.closest<HTMLAnchorElement>('a[href^="tel:"]');
  if (!anchor || extractPhoneCandidates(anchor.textContent || "").length === 0) return null;
  const value = normalizePhoneForClipboard(anchor.getAttribute("href") || "");
  return value ? { element: anchor, value } : null;
}

function phoneFromVisibleTarget(element: HTMLElement) {
  const isLeaf = element.childElementCount === 0;
  if (!isLeaf) return null;
  const candidates = extractPhoneCandidates(element.textContent || "");
  if (candidates.length !== 1) return null;
  return { element, value: candidates[0].value };
}

function resolvePhone(target: EventTarget | null, x: number, y: number): ResolvedPhone | null {
  if (!(target instanceof Element)) return null;
  const element = target instanceof HTMLElement ? target : target.parentElement;
  if (!element || element.closest('[data-phone-copy="ignore"]')) return null;
  return phoneInputValue(element)
    || phoneFromDataset(element)
    || phoneFromPhoneAnchor(element)
    || phoneAtPoint(x, y)
    || phoneFromVisibleTarget(element);
}

function preservesEditing(element: HTMLElement) {
  return element instanceof HTMLInputElement
    || element instanceof HTMLTextAreaElement
    || element.isContentEditable
    || Boolean(element.closest('[contenteditable="true"]'));
}

async function writePhoneToClipboard(value: string) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // Use the legacy copy path below when Clipboard API permission is unavailable.
  }

  const field = document.createElement("textarea");
  field.value = value;
  field.setAttribute("readonly", "");
  field.style.position = "fixed";
  field.style.left = "-9999px";
  document.body.appendChild(field);
  field.select();
  try {
    return document.execCommand("copy");
  } finally {
    field.remove();
  }
}

function markCopyTarget(element: HTMLElement, timers: Set<number>) {
  const token = String(Date.now());
  element.dataset.phoneCopyActive = "true";
  element.dataset.phoneCopyAnimation = token;
  const timer = window.setTimeout(() => {
    if (element.dataset.phoneCopyAnimation === token) {
      delete element.dataset.phoneCopyActive;
      delete element.dataset.phoneCopyAnimation;
    }
    timers.delete(timer);
  }, 560);
  timers.add(timer);
}

export function GlobalPhoneCopy() {
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [pulse, setPulse] = useState<Pulse | null>(null);
  const feedbackTimer = useRef<number | null>(null);
  const pulseTimer = useRef<number | null>(null);

  useEffect(() => {
    const animationTimers = new Set<number>();
    let readyElement: HTMLElement | null = null;

    const clearReady = () => {
      if (readyElement) delete readyElement.dataset.phoneCopyReady;
      readyElement = null;
    };

    const handlePointerOver = (event: PointerEvent) => {
      const resolved = resolvePhone(event.target, event.clientX, event.clientY);
      if (resolved?.element === readyElement) return;
      clearReady();
      if (resolved) {
        resolved.element.dataset.phoneCopyReady = "true";
        readyElement = resolved.element;
      }
    };

    const handleClick = (event: MouseEvent) => {
      const resolved = resolvePhone(event.target, event.clientX, event.clientY);
      if (!resolved) return;

      if (!preservesEditing(resolved.element)) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }

      markCopyTarget(resolved.element, animationTimers);
      setPulse({ id: Date.now(), x: event.clientX, y: event.clientY });
      if (pulseTimer.current) window.clearTimeout(pulseTimer.current);
      pulseTimer.current = window.setTimeout(() => setPulse(null), 560);

      void writePhoneToClipboard(resolved.value).then((ok) => {
        setFeedback({ ok, value: resolved.value });
        if (feedbackTimer.current) window.clearTimeout(feedbackTimer.current);
        feedbackTimer.current = window.setTimeout(() => setFeedback(null), ok ? 2200 : 3200);
      });
    };

    document.addEventListener("pointerover", handlePointerOver, true);
    document.addEventListener("click", handleClick, true);
    return () => {
      document.removeEventListener("pointerover", handlePointerOver, true);
      document.removeEventListener("click", handleClick, true);
      clearReady();
      animationTimers.forEach((timer) => window.clearTimeout(timer));
      if (feedbackTimer.current) window.clearTimeout(feedbackTimer.current);
      if (pulseTimer.current) window.clearTimeout(pulseTimer.current);
    };
  }, []);

  return <>
    {pulse && <span key={pulse.id} className="globalPhoneCopyRipple" style={{ left: pulse.x, top: pulse.y }} aria-hidden="true"/>}
    {feedback && <div className={`globalPhoneCopyToast ${feedback.ok ? "" : "globalPhoneCopyToastError"}`} role="status" aria-live="polite">
      <span className="globalPhoneCopyToastMark" aria-hidden="true">{feedback.ok ? "✓" : "!"}</span>
      <span className="globalPhoneCopyToastText">
        <span>{feedback.ok ? "Номер скопійовано" : "Не вдалося скопіювати номер"}</span>
        <small>{feedback.value}</small>
      </span>
    </div>}
  </>;
}
