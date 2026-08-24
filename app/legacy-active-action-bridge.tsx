"use client";

import { useEffect } from "react";

const LEGACY_LABELS = new Set(["Відкрити в Активних", "+ Додати в Активні", "Додати в Активні"]);

function text(value: Element | null | undefined) {
  return String(value?.textContent || "").replace(/\s+/g, " ").trim();
}

function setNativeSelect(select: HTMLSelectElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
  setter?.call(select, value);
  select.dispatchEvent(new Event("input", { bubbles: true }));
  select.dispatchEvent(new Event("change", { bubbles: true }));
}

export function LegacyActiveActionBridge() {
  useEffect(() => {
    const rename = () => {
      for (const button of Array.from(document.querySelectorAll<HTMLButtonElement>("button"))) {
        if (LEGACY_LABELS.has(text(button))) {
          button.dataset.legacyActiveAction = "1";
          button.textContent = "Взяти в роботу";
          button.title = "Перевести діалог у статус «В роботі»";
        }
      }
    };

    const onClick = (event: Event) => {
      const button = (event.target as Element | null)?.closest<HTMLButtonElement>("button[data-legacy-active-action='1']");
      if (!button) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const status = document.querySelector<HTMLSelectElement>('[data-communications-lifecycle-host="header"] select');
      if (status) setNativeSelect(status, "IN_WORK");
      const drawer = button.closest<HTMLElement>(".clientDrawer");
      const close = drawer ? Array.from(drawer.querySelectorAll<HTMLButtonElement>("button")).find((item) => text(item) === "×") : null;
      window.setTimeout(() => close?.click(), 80);
    };

    rename();
    const observer = new MutationObserver(rename);
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener("click", onClick, true);
    return () => {
      observer.disconnect();
      document.removeEventListener("click", onClick, true);
    };
  }, []);

  return null;
}
