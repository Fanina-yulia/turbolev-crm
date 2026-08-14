"use client";

import { useEffect, useState } from "react";

type Theme = "dark" | "light";

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("dark");

  useEffect(() => {
    const saved = window.localStorage.getItem("turbolev-theme") as Theme | null;
    const preferred: Theme = saved ?? (window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
    document.documentElement.dataset.theme = preferred;
    setTheme(preferred);
  }, []);

  function toggleTheme() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    window.localStorage.setItem("turbolev-theme", next);
    setTheme(next);
  }

  return (
    <button className="themeToggle" onClick={toggleTheme} type="button" aria-label="Змінити тему">
      <span aria-hidden="true">{theme === "dark" ? "☀" : "◐"}</span>
      {theme === "dark" ? "Світла" : "Темна"}
    </button>
  );
}
