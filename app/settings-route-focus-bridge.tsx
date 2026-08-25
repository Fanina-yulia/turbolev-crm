"use client";

import { useEffect } from "react";
import { readCrmRoute } from "./crm-route";
import type { SettingsTab } from "./settings-tabs";

const PROVIDER_TITLES: Record<string, string> = {
  BINOTEL: "Binotel",
  TELEGRAM: "Telegram",
  META: "Facebook + Instagram",
  TIKTOK: "TikTok",
  OLX: "OLX",
  VEHICLE_IMAGES: "OpenAI",
};

function normalizeText(value: string | null | undefined) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function highlight(element: HTMLElement) {
  element.scrollIntoView({ behavior: "smooth", block: "center" });
  const previousOutline = element.style.outline;
  const previousOffset = element.style.outlineOffset;
  element.style.outline = "2px solid var(--orange, #f97316)";
  element.style.outlineOffset = "3px";
  window.setTimeout(() => {
    element.style.outline = previousOutline;
    element.style.outlineOffset = previousOffset;
  }, 2600);
}

export function SettingsRouteFocusBridge({ tab }: { tab: SettingsTab }) {
  useEffect(() => {
    if (tab !== "integrations" && tab !== "suppliers") return;
    let cancelled = false;
    let observer: MutationObserver | null = null;
    let timer = 0;

    const route = readCrmRoute();

    if (tab === "integrations" && route.provider) {
      const provider = route.provider.toUpperCase();
      const wantedTitle = PROVIDER_TITLES[provider];
      if (!wantedTitle) return;

      // Keep the legacy integration reader alive while typed provider routes roll out.
      const url = new URL(window.location.href);
      if (url.searchParams.get("integration") !== provider) {
        url.searchParams.set("integration", provider);
        window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
      }

      const focusProvider = () => {
        if (cancelled) return false;
        const button = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((candidate) => {
          const strong = candidate.querySelector("strong");
          return normalizeText(strong?.textContent) === wantedTitle || normalizeText(candidate.textContent).startsWith(wantedTitle);
        });
        if (!button) return false;
        button.click();
        timer = window.setTimeout(() => {
          const clean = new URL(window.location.href);
          clean.searchParams.delete("integration");
          window.history.replaceState({}, "", `${clean.pathname}${clean.search}${clean.hash}`);
        }, 80);
        return true;
      };

      if (focusProvider()) return;
      observer = new MutationObserver(() => { if (focusProvider()) observer?.disconnect(); });
      observer.observe(document.body, { childList: true, subtree: true });
    }

    if (tab === "suppliers" && route.supplierId) {
      const supplierId = route.supplierId;
      void fetch("/api/settings/operations", { cache: "no-store" })
        .then(async (response) => {
          const payload = await response.json() as { directory?: Array<{ id: string; category: string; name: string }> };
          if (!response.ok || cancelled) return;
          const supplier = (payload.directory || []).find((item) => item.id === supplierId && item.category === "SUPPLIER");
          if (!supplier) return;
          const focusSupplier = () => {
            if (cancelled) return false;
            const strong = Array.from(document.querySelectorAll<HTMLElement>("article strong")).find((candidate) => normalizeText(candidate.textContent) === supplier.name);
            const card = strong?.closest<HTMLElement>("article");
            if (!card) return false;
            highlight(card);
            return true;
          };
          if (focusSupplier()) return;
          observer = new MutationObserver(() => { if (focusSupplier()) observer?.disconnect(); });
          observer.observe(document.body, { childList: true, subtree: true });
        })
        .catch(() => undefined);
    }

    return () => {
      cancelled = true;
      observer?.disconnect();
      window.clearTimeout(timer);
    };
  }, [tab]);

  return null;
}
