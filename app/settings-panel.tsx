"use client";

import { useEffect, useState } from "react";

type ThemeMode = "light" | "dark" | "auto";
type ResolvedTheme = "light" | "dark";

function resolveTheme(mode: ThemeMode): ResolvedTheme {
  if (mode === "light" || mode === "dark") return mode;
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function applyTheme(mode: ThemeMode) {
  document.documentElement.dataset.theme = resolveTheme(mode);
  document.documentElement.dataset.themeMode = mode;
}

export function SettingsPanel() {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<ThemeMode>("auto");

  useEffect(() => {
    const saved = window.localStorage.getItem("turbolev-theme-mode") as ThemeMode | null;
    const legacy = window.localStorage.getItem("turbolev-theme") as "light" | "dark" | null;
    const initial: ThemeMode = saved ?? legacy ?? "auto";

    setMode(initial);
    applyTheme(initial);

    const media = window.matchMedia("(prefers-color-scheme: light)");
    const syncSystemTheme = () => {
      const current = (window.localStorage.getItem("turbolev-theme-mode") as ThemeMode | null) ?? initial;
      if (current === "auto") applyTheme("auto");
    };

    media.addEventListener("change", syncSystemTheme);
    return () => media.removeEventListener("change", syncSystemTheme);
  }, []);

  function selectMode(next: ThemeMode) {
    setMode(next);
    window.localStorage.setItem("turbolev-theme-mode", next);
    window.localStorage.removeItem("turbolev-theme");
    applyTheme(next);
  }

  return (
    <>
      <button className="settingsNavButton" type="button" onClick={() => setOpen(true)}>
        <span className="navDot" />
        Налаштування
      </button>

      {open ? (
        <div className="settingsBackdrop" role="presentation" onMouseDown={() => setOpen(false)}>
          <section className="settingsModal" role="dialog" aria-modal="true" aria-labelledby="settingsTitle" onMouseDown={(event) => event.stopPropagation()}>
            <div className="settingsHeader">
              <div>
                <p className="eyebrow">СИСТЕМА</p>
                <h2 id="settingsTitle">Налаштування</h2>
              </div>
              <button className="settingsClose" type="button" aria-label="Закрити налаштування" onClick={() => setOpen(false)}>×</button>
            </div>

            <div className="settingsSection">
              <div className="settingsSectionCopy">
                <strong>Оформлення</strong>
                <span>Вибери тему CRM. Автоматична тема повторює налаштування Windows або браузера.</span>
              </div>

              <div className="themeOptions" role="radiogroup" aria-label="Тема CRM">
                <button className={mode === "light" ? "themeOption themeOptionActive" : "themeOption"} type="button" role="radio" aria-checked={mode === "light"} onClick={() => selectMode("light")}>
                  <span className="themePreview themePreviewLight" aria-hidden="true" />
                  <span><strong>Світла</strong><small>Завжди світлий інтерфейс</small></span>
                </button>
                <button className={mode === "dark" ? "themeOption themeOptionActive" : "themeOption"} type="button" role="radio" aria-checked={mode === "dark"} onClick={() => selectMode("dark")}>
                  <span className="themePreview themePreviewDark" aria-hidden="true" />
                  <span><strong>Темна</strong><small>Завжди темний інтерфейс</small></span>
                </button>
                <button className={mode === "auto" ? "themeOption themeOptionActive" : "themeOption"} type="button" role="radio" aria-checked={mode === "auto"} onClick={() => selectMode("auto")}>
                  <span className="themePreview themePreviewAuto" aria-hidden="true" />
                  <span><strong>Автоматична</strong><small>Як у системі</small></span>
                </button>
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
