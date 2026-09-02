"use client";

import { useEffect } from "react";
import {
  APPEARANCE_CACHE_KEY,
  DEFAULT_CRM_APPEARANCE,
  applyCrmAppearance,
  normalizeCrmAppearance,
  type CrmAppearance,
} from "@/src/ui/appearance";

function readCachedAppearance(): CrmAppearance | null {
  try {
    const raw = window.localStorage.getItem(APPEARANCE_CACHE_KEY);
    return raw ? normalizeCrmAppearance(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function AppearanceThemeBridge() {
  useEffect(() => {
    const cached = readCachedAppearance();
    if (cached) applyCrmAppearance(cached);
    else applyCrmAppearance(DEFAULT_CRM_APPEARANCE);

    const controller = new AbortController();
    let active = true;
    void fetch("/api/settings/appearance", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return null;
        const data = await response.json() as { ok?: boolean; appearance?: unknown };
        return data.ok && data.appearance ? normalizeCrmAppearance(data.appearance) : null;
      })
      .then((appearance) => {
        if (!active || !appearance) return;
        window.localStorage.setItem(APPEARANCE_CACHE_KEY, JSON.stringify(appearance));
        applyCrmAppearance(appearance);
      })
      .catch(() => undefined);

    const media = window.matchMedia("(prefers-color-scheme: light)");
    const syncSystemTheme = () => {
      const current = readCachedAppearance();
      if (current?.themeMode === "auto") applyCrmAppearance(current);
    };
    media.addEventListener("change", syncSystemTheme);
    return () => {
      active = false;
      controller.abort();
      media.removeEventListener("change", syncSystemTheme);
    };
  }, []);

  return null;
}

