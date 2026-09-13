"use client";

import { useEffect } from "react";
import { normalizePhone } from "./new-request-wizard-v5.model";

const DEBOUNCE_MS = 380;
const AUTO_HINT = "Пошук запускається автоматично після введення повного номера. Якщо клієнт є в CRM — його картка підставляється без додаткового підтвердження.";

function stepNumber(root: HTMLElement) {
  const text = root.querySelector(".requestStepTitle small")?.textContent || "";
  return Number(/(\d+)/.exec(text)?.[1] || 0);
}

function phoneInput(root: HTMLElement) {
  return root.querySelector(".inlinePhoneLookup input") as HTMLInputElement | null;
}

function lookupButton(root: HTMLElement) {
  return root.querySelector(".inlinePhoneLookup button") as HTMLButtonElement | null;
}

function phoneLookupResult(root: HTMLElement) {
  return root.querySelector(".phoneLookupHint + .clientLookupCompact.fastClientResult") as HTMLElement | null;
}

function resultPhone(result: HTMLElement | null) {
  const text = result?.querySelector("span")?.textContent || "";
  return normalizePhone(text);
}

function setHint(root: HTMLElement) {
  const hint = root.querySelector(".phoneLookupHint") as HTMLElement | null;
  if (!hint || hint.textContent === AUTO_HINT) return;
  hint.textContent = AUTO_HINT;
}

function setIdleButtonPresentation(button: HTMLButtonElement, complete: boolean) {
  if (!button.classList.contains("lookupState-idle")) {
    if (button.style.pointerEvents) button.style.pointerEvents = "";
    return;
  }
  const label = complete ? "Перевіряю…" : "Автопошук";
  const ariaLabel = complete ? "Автоматично перевіряю номер у CRM" : "Автопошук запуститься після введення повного номера";
  if (button.textContent !== label) button.textContent = label;
  if (button.style.pointerEvents !== "none") button.style.pointerEvents = "none";
  if (button.getAttribute("aria-label") !== ariaLabel) button.setAttribute("aria-label", ariaLabel);
}

function markApplied(button: HTMLButtonElement) {
  if (button.textContent !== "✓ Підставлено") button.textContent = "✓ Підставлено";
  if (!button.disabled) button.disabled = true;
  const ariaLabel = "Клієнта автоматично підставлено за номером телефону";
  if (button.getAttribute("aria-label") !== ariaLabel) button.setAttribute("aria-label", ariaLabel);
}

export function NewRequestPhoneAutoMatchEnhancer() {
  useEffect(() => {
    let debounceTimer: number | null = null;
    let scheduledPhone = "";
    let appliedPhone = "";
    let rerunPhone = "";
    let stopped = false;

    const clearDebounce = () => {
      if (debounceTimer !== null) window.clearTimeout(debounceTimer);
      debounceTimer = null;
      scheduledPhone = "";
    };

    const tick = () => {
      if (stopped) return;
      const modal = (document.querySelector('[data-page="new-request"]') || document.querySelector(".requestModal")) as HTMLElement | null;
      if (!modal || stepNumber(modal) !== 2) {
        clearDebounce();
        appliedPhone = "";
        rerunPhone = "";
        return;
      }

      setHint(modal);
      const input = phoneInput(modal);
      const button = lookupButton(modal);
      if (!input || !button) return;

      const phone = normalizePhone(input.value);
      const complete = phone.length === 12;
      setIdleButtonPresentation(button, complete);

      if (!complete) {
        clearDebounce();
        appliedPhone = "";
        rerunPhone = "";
        return;
      }

      const result = phoneLookupResult(modal);
      const matchedPhone = resultPhone(result);

      // A slower response for an older number must never be applied to the new number.
      if (result && matchedPhone && matchedPhone !== phone) {
        clearDebounce();
        appliedPhone = "";
        if (rerunPhone !== phone) {
          rerunPhone = phone;
          window.setTimeout(() => {
            if (normalizePhone(phoneInput(modal)?.value || "") !== phone) return;
            lookupButton(modal)?.click();
          }, 0);
        }
        return;
      }
      rerunPhone = "";

      if (result && matchedPhone === phone) {
        clearDebounce();
        const useButton = result.querySelector("button") as HTMLButtonElement | null;
        if (useButton && appliedPhone !== phone) {
          appliedPhone = phone;
          useButton.click();
          window.setTimeout(tick, 0);
          return;
        }
        if (useButton) markApplied(useButton);
        return;
      }

      if (button.classList.contains("lookupState-searching")) return;
      if (button.classList.contains("lookupState-not-found")) return;
      if (button.classList.contains("lookupState-unavailable")) return;
      if (!button.classList.contains("lookupState-idle")) return;
      if (scheduledPhone === phone && debounceTimer !== null) return;

      clearDebounce();
      scheduledPhone = phone;
      debounceTimer = window.setTimeout(() => {
        debounceTimer = null;
        const currentInput = phoneInput(modal);
        const currentButton = lookupButton(modal);
        if (!currentInput || !currentButton) return;
        if (normalizePhone(currentInput.value) !== phone) return;
        scheduledPhone = "";
        if (currentButton.style.pointerEvents) currentButton.style.pointerEvents = "";
        currentButton.click();
      }, DEBOUNCE_MS);
    };

    const onInput = (event: Event) => {
      const target = event.target as HTMLElement;
      if (!target.matches(".inlinePhoneLookup input")) return;
      const nextPhone = normalizePhone((target as HTMLInputElement).value);
      if (nextPhone !== appliedPhone) appliedPhone = "";
      if (nextPhone !== scheduledPhone) clearDebounce();
      rerunPhone = "";
      window.setTimeout(tick, 0);
    };

    document.addEventListener("input", onInput, true);
    const observer = new MutationObserver(() => tick());
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["class", "disabled"] });
    const fallbackTimer = window.setInterval(tick, 250);
    tick();

    return () => {
      stopped = true;
      clearDebounce();
      document.removeEventListener("input", onInput, true);
      observer.disconnect();
      window.clearInterval(fallbackTimer);
    };
  }, []);

  return null;
}
