"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import styles from "./mechanic-cabinet-preferences.module.css";

type ThemePreference = "system" | "light" | "dark";
type FontPreference = "compact" | "standard" | "large";
type DensityPreference = "compact" | "standard" | "comfortable";
type AccentPreference = "orange" | "blue" | "green" | "graphite";

type MechanicCabinetPreferences = {
  theme: ThemePreference;
  font: FontPreference;
  density: DensityPreference;
  accent: AccentPreference;
};

const STORAGE_KEY = "turbolev:mechanic-ui-preferences-v1";
const LEGACY_THEME_KEY = "turbolev:mechanic-theme";
const PREFERENCES_EVENT = "turbolev:mechanic-ui-preferences";

const DEFAULT_PREFERENCES: MechanicCabinetPreferences = {
  theme: "system",
  font: "standard",
  density: "standard",
  accent: "orange",
};

const ACCENTS: Record<AccentPreference, { label: string; color: string }> = {
  orange: { label: "Фірмова", color: "#FF6500" },
  blue: { label: "Синя", color: "#1E73E8" },
  green: { label: "Зелена", color: "#168A68" },
  graphite: { label: "Графіт", color: "#65717E" },
};

const LIGHT_THEME = {
  "--m-bg": "#F3F5F8",
  "--m-surface": "#FFFFFF",
  "--m-surface-2": "#F7F9FB",
  "--m-border": "#DDE3EA",
  "--m-text": "#111923",
  "--m-muted": "#667586",
  "--m-soft": "#8793A0",
  "--m-header": "#101922",
  "--m-header-2": "#182532",
  "--m-green": "#08794A",
  "--m-green-soft": "#E8F7EF",
  "--m-blue": "#096BC9",
  "--m-blue-soft": "#EAF4FF",
  "--m-warn": "#A94A06",
  "--m-warn-soft": "#FFF2E8",
  "--m-danger": "#B53A45",
  "--m-danger-soft": "#FFF0F2",
} as const;

const DARK_THEME = {
  "--m-bg": "#0D1116",
  "--m-surface": "#151A20",
  "--m-surface-2": "#1B222A",
  "--m-border": "#29323C",
  "--m-text": "#F6F8FA",
  "--m-muted": "#A2ADB8",
  "--m-soft": "#7F8B97",
  "--m-header": "#090D12",
  "--m-header-2": "#151C24",
  "--m-green": "#5AD29B",
  "--m-green-soft": "#173126",
  "--m-blue": "#72B7FF",
  "--m-blue-soft": "#172C40",
  "--m-warn": "#FFAD6F",
  "--m-warn-soft": "#36251B",
  "--m-danger": "#FF8B96",
  "--m-danger-soft": "#3A2025",
} as const;

const DENSITY_VARS: Record<DensityPreference, { edge: string; gap: string }> = {
  compact: { edge: "10px", gap: "8px" },
  standard: { edge: "12px", gap: "10px" },
  comfortable: { edge: "16px", gap: "14px" },
};

function parsePreferences(value: string | null): MechanicCabinetPreferences {
  if (!value) return DEFAULT_PREFERENCES;
  try {
    const parsed = JSON.parse(value) as Partial<MechanicCabinetPreferences>;
    return {
      theme: parsed.theme === "light" || parsed.theme === "dark" || parsed.theme === "system" ? parsed.theme : DEFAULT_PREFERENCES.theme,
      font: parsed.font === "compact" || parsed.font === "large" || parsed.font === "standard" ? parsed.font : DEFAULT_PREFERENCES.font,
      density: parsed.density === "compact" || parsed.density === "comfortable" || parsed.density === "standard" ? parsed.density : DEFAULT_PREFERENCES.density,
      accent: parsed.accent && parsed.accent in ACCENTS ? parsed.accent : DEFAULT_PREFERENCES.accent,
    };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

function getCabinetRoot() {
  return document.querySelector<HTMLElement>('[data-mechanic-cabinet="true"]');
}

function applyPreferences(root: HTMLElement, preferences: MechanicCabinetPreferences) {
  const systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const dark = preferences.theme === "dark" || (preferences.theme === "system" && systemDark);
  const palette = dark ? DARK_THEME : LIGHT_THEME;
  const accent = ACCENTS[preferences.accent].color;
  const density = DENSITY_VARS[preferences.density];

  root.dataset.themeChoice = preferences.theme;
  root.dataset.mechanicPrefTheme = preferences.theme;
  root.dataset.mechanicFontScale = preferences.font;
  root.dataset.mechanicDensity = preferences.density;
  root.dataset.mechanicAccent = preferences.accent;

  for (const [name, value] of Object.entries(palette)) root.style.setProperty(name, value, "important");
  root.style.setProperty("--m-orange", accent, "important");
  root.style.setProperty(
    "--m-orange-soft",
    `color-mix(in srgb, ${accent} ${dark ? "22%" : "13%"}, ${dark ? "#151A20" : "#FFFFFF"})`,
    "important",
  );
  root.style.setProperty("--mechanic-mobile-edge", density.edge, "important");
  root.style.setProperty("--mechanic-mobile-gap", density.gap, "important");
  root.style.background = dark ? "#070A0E" : "#E9EDF2";
}

function applyAndPersistPreferences(preferences: MechanicCabinetPreferences) {
  const root = getCabinetRoot();
  if (root) applyPreferences(root, preferences);
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
  window.localStorage.setItem(LEGACY_THEME_KEY, preferences.theme);
  window.dispatchEvent(new CustomEvent(PREFERENCES_EVENT, { detail: preferences }));
}

function GearIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 8.2a3.8 3.8 0 1 0 0 7.6 3.8 3.8 0 0 0 0-7.6Zm8.2 4.8v-2l-2.1-.7a7.1 7.1 0 0 0-.7-1.7l1-2-1.4-1.4-2 1a7.1 7.1 0 0 0-1.7-.7L12.6 3h-2l-.7 2.1a7.1 7.1 0 0 0-1.7.7l-2-1L4.8 6.2l1 2a7.1 7.1 0 0 0-.7 1.7L3 10.6v2l2.1.7c.2.6.4 1.2.7 1.7l-1 2 1.4 1.4 2-1c.5.3 1.1.5 1.7.7l.7 2.1h2l.7-2.1c.6-.2 1.2-.4 1.7-.7l2 1 1.4-1.4-1-2c.3-.5.5-1.1.7-1.7l2.1-.7Z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>;
}

export function MechanicCabinetPreferences() {
  const [preferences, setPreferences] = useState<MechanicCabinetPreferences>(DEFAULT_PREFERENCES);
  const [open, setOpen] = useState(false);
  const [header, setHeader] = useState<HTMLElement | null>(null);
  const [sourceButton, setSourceButton] = useState<HTMLButtonElement | null>(null);
  const [notificationCount, setNotificationCount] = useState(0);
  const accentEntries = useMemo(() => Object.entries(ACCENTS) as Array<[AccentPreference, { label: string; color: string }]>, []);

  useEffect(() => {
    document.body.classList.add(styles.preferencesActive);
    return () => document.body.classList.remove(styles.preferencesActive);
  }, []);

  useEffect(() => {
    const stored = parsePreferences(window.localStorage.getItem(STORAGE_KEY));
    setPreferences(stored);
    applyAndPersistPreferences(stored);
  }, []);

  useEffect(() => {
    let notificationObserver: MutationObserver | null = null;
    let rootObserver: MutationObserver | null = null;

    const bind = () => {
      const root = getCabinetRoot();
      const button = root?.querySelector<HTMLButtonElement>('button[aria-label="Сповіщення"]') ?? null;
      if (!root || !button) return;

      const saved = parsePreferences(window.localStorage.getItem(STORAGE_KEY));
      applyPreferences(root, saved);

      button.dataset.mechanicSettingsSource = "true";
      setSourceButton(button);
      setHeader(button.closest("header"));

      const updateCount = () => setNotificationCount(Number(button.querySelector("em")?.textContent || 0) || 0);
      updateCount();
      notificationObserver?.disconnect();
      notificationObserver = new MutationObserver(updateCount);
      notificationObserver.observe(button, { childList: true, subtree: true, characterData: true });

      rootObserver?.disconnect();
      rootObserver = new MutationObserver(() => {
        const current = parsePreferences(window.localStorage.getItem(STORAGE_KEY));
        if (root.dataset.themeChoice !== current.theme) applyPreferences(root, current);
      });
      rootObserver.observe(root, { attributes: true, attributeFilter: ["data-theme-choice"] });
    };

    bind();
    const observer = new MutationObserver(bind);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      notificationObserver?.disconnect();
      rootObserver?.disconnect();
    };
  }, []);

  useEffect(() => {
    if (preferences.theme !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      const root = getCabinetRoot();
      if (root) applyPreferences(root, preferences);
    };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [preferences]);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function commit(next: MechanicCabinetPreferences) {
    applyAndPersistPreferences(next);
    setPreferences(next);
  }

  function update<K extends keyof MechanicCabinetPreferences>(key: K, value: MechanicCabinetPreferences[K]) {
    commit({ ...preferences, [key]: value });
  }

  function reset() {
    commit(DEFAULT_PREFERENCES);
  }

  function openNotifications() {
    setOpen(false);
    window.requestAnimationFrame(() => sourceButton?.click());
  }

  const trigger = header ? createPortal(
    <button type="button" className={styles.settingsTrigger} aria-label="Налаштування кабінету" onClick={() => setOpen(true)}>
      <GearIcon />
      {notificationCount > 0 && <em className={styles.badge}>{notificationCount}</em>}
    </button>,
    header,
  ) : null;

  const sheet = open ? createPortal(
    <div className={styles.backdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
      <section className={styles.sheet} role="dialog" aria-modal="true" aria-label="Налаштування кабінету механіка">
        <header className={styles.sheetHeader}>
          <div><small>КАБІНЕТ МЕХАНІКА</small><h2>Налаштування</h2><p>Зміни застосовуються одразу і зберігаються на цьому пристрої.</p></div>
          <button type="button" className={styles.closeButton} aria-label="Закрити налаштування" onClick={() => setOpen(false)}>×</button>
        </header>

        <div className={styles.sheetBody}>
          <section className={styles.settingSection}>
            <div className={styles.sectionTitle}><div><h3>Тема</h3><p>Світлий або темний режим кабінету.</p></div></div>
            <div className={styles.segmented}>
              {(["system", "light", "dark"] as ThemePreference[]).map((value) => <button key={value} type="button" className={preferences.theme === value ? styles.activeChoice : ""} onClick={() => update("theme", value)}>{value === "system" ? "Як у телефоні" : value === "light" ? "Світла" : "Темна"}</button>)}
            </div>
          </section>

          <section className={styles.settingSection}>
            <div className={styles.sectionTitle}><div><h3>Розмір шрифту</h3><p>Заголовки, описи та робочі підписи.</p></div><span className={styles.previewText}>Aa</span></div>
            <div className={styles.optionGrid}>
              {(["compact", "standard", "large"] as FontPreference[]).map((value) => <button key={value} type="button" className={preferences.font === value ? styles.activeChoice : ""} onClick={() => update("font", value)}><strong>{value === "compact" ? "Менший" : value === "standard" ? "Стандарт" : "Більший"}</strong><small>{value === "compact" ? "Більше інформації" : value === "standard" ? "Оптимальний" : "Легше читати"}</small></button>)}
            </div>
          </section>

          <section className={styles.settingSection}>
            <div className={styles.sectionTitle}><div><h3>Щільність екрана</h3><p>Відступи між картками та робочими блоками.</p></div></div>
            <div className={styles.optionGrid}>
              {(["compact", "standard", "comfortable"] as DensityPreference[]).map((value) => <button key={value} type="button" className={preferences.density === value ? styles.activeChoice : ""} onClick={() => update("density", value)}><strong>{value === "compact" ? "Щільно" : value === "standard" ? "Стандарт" : "Просторо"}</strong><small>{value === "compact" ? "Максимум на екрані" : value === "standard" ? "Як зараз" : "Більше повітря"}</small></button>)}
            </div>
          </section>

          <section className={styles.settingSection}>
            <div className={styles.sectionTitle}><div><h3>Кольорова гама</h3><p>Акцент кнопок, активних вкладок та брендингу кабінету.</p></div></div>
            <div className={styles.colorGrid}>
              {accentEntries.map(([value, meta]) => <button key={value} type="button" className={preferences.accent === value ? styles.activeColor : ""} onClick={() => update("accent", value)} aria-pressed={preferences.accent === value}><i style={{ background: meta.color }}/><span>{meta.label}</span>{preferences.accent === value && <b>✓</b>}</button>)}
            </div>
          </section>

          <section className={styles.settingSection}>
            <button type="button" className={styles.actionRow} onClick={openNotifications}><span className={styles.actionIcon}>●</span><span><strong>Сповіщення</strong><small>Призначення, зміни робіт та системні повідомлення</small></span>{notificationCount > 0 && <em>{notificationCount}</em>}<b>›</b></button>
            <button type="button" className={styles.actionRow} onClick={reset}><span className={styles.actionIcon}>↺</span><span><strong>Скинути оформлення</strong><small>Повернути стандартний вигляд TURBO ЛЕВ</small></span><b>›</b></button>
          </section>
        </div>
      </section>
    </div>,
    document.body,
  ) : null;

  return <>{trigger}{sheet}</>;
}
