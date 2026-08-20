"use client";

import { useEffect } from "react";

const GROUP_ICON_KEY: Record<string, string> = {
  "Робочий стіл": "dashboard",
  "Звернення": "inbox",
  "Клієнти та авто": "clients",
  "Сервіс": "service",
  "Запчастини": "parts",
  "Фінанси": "finance",
  "Управління": "management",
};

export function SidebarRailIcons() {
  useEffect(() => {
    const decorate = () => {
      document.querySelectorAll('.sidebar nav > section > button[aria-expanded]').forEach((node) => {
        if (!(node instanceof HTMLButtonElement)) return;
        const label = node.querySelector("span")?.textContent?.trim() ?? "";
        const iconKey = GROUP_ICON_KEY[label];
        if (iconKey) node.dataset.railIcon = iconKey;
        else delete node.dataset.railIcon;
        if (label) node.setAttribute("aria-label", label);
      });
    };

    decorate();
    const frame = requestAnimationFrame(decorate);
    const sidebar = document.querySelector(".sidebar");
    const observer = new MutationObserver(decorate);
    if (sidebar) observer.observe(sidebar, { childList: true, subtree: true });
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

  return null;
}
