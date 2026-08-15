"use client";

import { useEffect } from "react";

function text(root: Element | null, selector: string) {
  return root?.querySelector(selector)?.textContent?.trim() || "";
}

export function NewRequestContextBridge() {
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const button = target?.closest("button");
      if (!button) return;
      const drawer = button.closest(".clientDrawer");
      if (!drawer) return;
      const label = (button.textContent || "").replace(/\s+/g, " ").trim();
      if (!label.includes("Записати на СТО")) return;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      const selectedDialog = document.querySelector(".dialogRow.selected");
      const name = text(drawer, ".clientDrawerHead h2");
      const phone = text(drawer, ".clientDrawerHead span");
      const source = text(selectedDialog, "em") || "Інше";

      window.dispatchEvent(new CustomEvent("turbolev:open-new-request", {
        detail: { name, phone, source },
      }));
      const close = drawer.querySelector<HTMLButtonElement>(".clientDrawerHead > button");
      close?.click();
    };

    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  return null;
}
