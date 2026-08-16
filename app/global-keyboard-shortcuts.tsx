"use client";

import { useEffect } from "react";

const LAYER_TOKEN = /(^|[-_])(modal|dialog|popup|drawer|sheet|backdrop|overlay)([-_]|$)|(?:Modal|Dialog|Popup|Drawer|Sheet|Backdrop|Overlay)$|(?:DockPanel)$/;
const BACKDROP_TOKEN = /(^|[-_])(backdrop|overlay)([-_]|$)|(?:Backdrop|Overlay)$/;
const ACTION_CONTAINER = /(row|controls|lookup|search|input|field|action|toolbar|dial)/i;
const SEARCH_CONTEXT = /(search|filter|query|lookup|autocomplete|composer)/i;
const NEGATIVE_ACTION = /^(?:×|✕|✖)$|закрити|скасувати|назад|очистити|видалити|прибрати|відмінити|close|cancel|clear|delete|remove/i;
const POSITIVE_ACTION = /зберегти|підтвердити|застосувати|створити|записати|додати|далі|знайти|пошук|декодувати|оновити|увійти|відправити|надіслати|продовжити|готово|^ок$|в роботу|розрахувати|перевірити|обрати|вибрати|передати/i;

function classText(element: Element) {
  return typeof element.className === "string" ? element.className : "";
}

function isVisible(element: Element | null): element is HTMLElement {
  if (!(element instanceof HTMLElement) || !element.isConnected) return false;
  if (element.closest("[hidden],[inert],[aria-hidden='true']")) return false;
  const style = window.getComputedStyle(element);
  if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity || "1") < 0.02) return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function isEnabledButton(element: Element): element is HTMLButtonElement {
  return element instanceof HTMLButtonElement
    && isVisible(element)
    && !element.disabled
    && element.getAttribute("aria-disabled") !== "true";
}

function classLooksLikeLayer(element: Element) {
  if (element.getAttribute("role") === "dialog" || element.getAttribute("aria-modal") === "true") return true;
  return Array.from(element.classList).some((token) => LAYER_TOKEN.test(token));
}

function classLooksLikeBackdrop(element: Element) {
  return Array.from(element.classList).some((token) => BACKDROP_TOKEN.test(token));
}

function effectiveZIndex(element: HTMLElement) {
  let highest = 0;
  let current: HTMLElement | null = element;
  while (current && current !== document.body) {
    const value = Number.parseInt(window.getComputedStyle(current).zIndex, 10);
    if (Number.isFinite(value)) highest = Math.max(highest, value);
    current = current.parentElement;
  }
  return highest;
}

function elementDepth(element: HTMLElement) {
  let depth = 0;
  let current: HTMLElement | null = element;
  while (current?.parentElement) {
    depth += 1;
    current = current.parentElement;
  }
  return depth;
}

function domOrder(a: HTMLElement, b: HTMLElement) {
  if (a === b) return 0;
  const relation = a.compareDocumentPosition(b);
  if (relation & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
  if (relation & Node.DOCUMENT_POSITION_PRECEDING) return 1;
  return 0;
}

function isCloseLike(button: HTMLButtonElement) {
  if (button.dataset.keyboardClose === "true") return true;
  const text = (button.textContent || "").trim();
  const aria = button.getAttribute("aria-label") || "";
  const title = button.getAttribute("title") || "";
  const classes = classText(button);
  return /закрити|close/i.test(`${aria} ${title}`)
    || /(^|[-_])close([-_]|$)|Close/.test(classes)
    || /^(?:×|✕|✖|закрити|close)$/i.test(text);
}

function closeButtonScore(button: HTMLButtonElement) {
  let score = 0;
  if (button.dataset.keyboardClose === "true") score += 500;
  if (/закрити|close/i.test(button.getAttribute("aria-label") || "")) score += 400;
  if (/закрити|close/i.test(button.getAttribute("title") || "")) score += 350;
  if (/(^|[-_])close([-_]|$)|Close/.test(classText(button))) score += 300;
  if (/^(?:×|✕|✖)$/.test((button.textContent || "").trim())) score += 250;
  if (/^(?:закрити|close)$/i.test((button.textContent || "").trim())) score += 200;
  return score;
}

function fixedAncestor(element: HTMLElement) {
  let current: HTMLElement | null = element;
  while (current && current !== document.body) {
    if (window.getComputedStyle(current).position === "fixed") return current;
    current = current.parentElement;
  }
  return null;
}

function topVisibleLayer() {
  const candidates = new Set<HTMLElement>();
  document.querySelectorAll<HTMLElement>("[role='dialog'],[aria-modal='true'],[class]").forEach((element) => {
    if (classLooksLikeLayer(element) && isVisible(element)) candidates.add(element);
  });

  document.querySelectorAll<HTMLButtonElement>("button").forEach((button) => {
    if (!isVisible(button) || !isCloseLike(button)) return;
    const fixed = fixedAncestor(button);
    if (fixed && isVisible(fixed)) candidates.add(fixed);
  });

  return Array.from(candidates).sort((a, b) => {
    const z = effectiveZIndex(a) - effectiveZIndex(b);
    if (z) return z;
    const fixed = Number(window.getComputedStyle(a).position === "fixed") - Number(window.getComputedStyle(b).position === "fixed");
    if (fixed) return fixed;
    const depth = elementDepth(a) - elementDepth(b);
    if (depth) return depth;
    return domOrder(a, b);
  }).at(-1) || null;
}

function findCloseButton(layer: HTMLElement) {
  const buttons = Array.from(layer.querySelectorAll<HTMLButtonElement>("button"))
    .filter((button) => isVisible(button) && isCloseLike(button))
    .sort((a, b) => closeButtonScore(a) - closeButtonScore(b) || domOrder(a, b));
  const enabled = buttons.filter(isEnabledButton);
  return { button: enabled.at(-1) || null, blocked: buttons.length > 0 && enabled.length === 0 };
}

function findBackdrop(layer: HTMLElement) {
  let current: HTMLElement | null = layer;
  while (current && current !== document.body) {
    if (classLooksLikeBackdrop(current) && isVisible(current)) return current;
    current = current.parentElement;
  }
  return null;
}

function closeKnownTransient() {
  const emojiPicker = document.querySelector<HTMLElement>(".communicationsEmojiPicker");
  if (isVisible(emojiPicker)) {
    const root = emojiPicker.closest(".communicationsComposer") || emojiPicker.parentElement;
    const toggle = root?.querySelector<HTMLButtonElement>('button[title="Emoji"]');
    if (toggle && isEnabledButton(toggle)) {
      toggle.click();
      return true;
    }
  }
  return false;
}

function controlOwnsEscape(target: HTMLElement) {
  if (target instanceof HTMLSelectElement) return true;
  const expanded = target.closest<HTMLElement>("[aria-expanded='true']");
  if (expanded) return true;
  return Boolean(target.closest("[role='listbox'],[role='menu'],[role='tree']"));
}

function handleEscape(event: KeyboardEvent, target: HTMLElement) {
  if (target.closest("[data-keyboard-escape='ignore']") || controlOwnsEscape(target)) return;
  if (closeKnownTransient()) {
    event.preventDefault();
    return;
  }

  const layer = topVisibleLayer();
  if (!layer) return;
  const { button, blocked } = findCloseButton(layer);
  if (blocked) return;

  if (button) {
    event.preventDefault();
    event.stopPropagation();
    button.click();
    return;
  }

  const backdrop = findBackdrop(layer);
  if (!backdrop) return;
  event.preventDefault();
  event.stopPropagation();
  backdrop.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
  window.setTimeout(() => {
    if (backdrop.isConnected && isVisible(backdrop)) backdrop.click();
  }, 0);
}

function buttonLabel(button: HTMLButtonElement) {
  return `${button.textContent || ""} ${button.getAttribute("aria-label") || ""} ${button.getAttribute("title") || ""}`.replace(/\s+/g, " ").trim();
}

function actionScore(button: HTMLButtonElement) {
  if (!isEnabledButton(button) || isCloseLike(button)) return -1;
  const label = buttonLabel(button);
  if (NEGATIVE_ACTION.test(label)) return -1;

  let score = 0;
  const classes = classText(button);
  if (button.dataset.keyboardPrimary === "true") score += 1000;
  if (button.type === "submit") score += 700;
  if (/primary/i.test(classes)) score += 500;
  if (/confirm|submit|save/i.test(classes)) score += 450;
  if (POSITIVE_ACTION.test(label)) score += 300;
  if (button.closest("[class*='footer' i],[class*='foot' i],[class*='actions' i]")) score += 40;
  return score;
}

function bestAction(root: Element, minimumScore = 200) {
  const candidates = Array.from(root.querySelectorAll<HTMLButtonElement>("button"))
    .map((button) => ({ button, score: actionScore(button) }))
    .filter((item) => item.score >= minimumScore)
    .sort((a, b) => a.score - b.score || domOrder(a.button, b.button));
  return candidates.at(-1)?.button || null;
}

function localAction(target: HTMLElement, scope: HTMLElement) {
  let current = target.parentElement;
  let hops = 0;
  while (current && current !== scope && hops < 4) {
    const actionContainer = current.tagName === "LABEL" || ACTION_CONTAINER.test(classText(current));
    if (actionContainer) {
      const action = bestAction(current, 200);
      if (action) return action;
    }
    current = current.parentElement;
    hops += 1;
  }
  return null;
}

function interactionScope(target: HTMLElement) {
  let current: HTMLElement | null = target;
  while (current && current !== document.body) {
    if (classLooksLikeLayer(current)) return current;
    current = current.parentElement;
  }
  return target.closest<HTMLElement>("form");
}

function inSearchContext(target: HTMLInputElement, scope: HTMLElement) {
  if (target.type === "search" || /пошук|search/i.test(target.placeholder || "")) return true;
  let current: HTMLElement | null = target.parentElement;
  while (current && current !== scope) {
    if (SEARCH_CONTEXT.test(classText(current))) return true;
    current = current.parentElement;
  }
  return false;
}

function inputOwnsEnter(target: HTMLElement) {
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  if (target.isContentEditable || target.closest("[contenteditable='true']")) return true;
  if (target.closest("[data-keyboard-enter='ignore']")) return true;
  if (target.closest(".tlDial,.communicationsComposeRow")) return true;
  if (target.getAttribute("aria-expanded") === "true" || target.closest("[aria-expanded='true']")) return true;
  if (!(target instanceof HTMLInputElement)) return true;
  return ["button", "submit", "reset", "checkbox", "radio", "file", "range", "color", "hidden"].includes(target.type);
}

function handleEnter(event: KeyboardEvent, target: HTMLElement) {
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || inputOwnsEnter(target)) return;
  const input = target as HTMLInputElement;
  const scope = interactionScope(input);
  if (!scope || !isVisible(scope)) return;

  const local = localAction(input, scope);
  if (local) {
    event.preventDefault();
    event.stopPropagation();
    local.click();
    return;
  }

  const form = input.closest<HTMLFormElement>("form");
  if (form) {
    const nativeSubmit = Array.from(form.querySelectorAll<HTMLButtonElement | HTMLInputElement>('button[type="submit"],input[type="submit"]'))
      .find((control) => isVisible(control) && !control.hasAttribute("disabled") && control.getAttribute("aria-disabled") !== "true");
    if (nativeSubmit) return;
  }

  if (inSearchContext(input, scope)) return;
  const action = bestAction(scope, 200);
  if (!action) return;

  event.preventDefault();
  event.stopPropagation();
  action.click();
}

export function GlobalKeyboardShortcuts() {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.repeat) return;
      const target = event.target instanceof HTMLElement ? event.target : document.activeElement instanceof HTMLElement ? document.activeElement : null;
      if (!target) return;

      if (event.key === "Escape") {
        handleEscape(event, target);
        return;
      }
      if (event.key === "Enter") handleEnter(event, target);
    };

    // Window bubble phase runs after component-level React handlers. This lets
    // local controls keep their own keyboard behavior and prevents double actions.
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return null;
}
