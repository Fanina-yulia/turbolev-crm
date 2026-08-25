"use client";

import { useEffect, useRef, useState } from "react";
import { GlobalSmartSearch } from "./global-smart-search";

export function GlobalSmartSearchPalette() {
  const [active, setActive] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setActive(true);
      } else if (event.key === "Escape") {
        setActive(false);
      }
    };
    const closeOnNavigate = () => setActive(false);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("popstate", closeOnNavigate);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("popstate", closeOnNavigate);
    };
  }, []);

  useEffect(() => {
    if (!active) return;
    const frame = window.requestAnimationFrame(() => contentRef.current?.querySelector<HTMLInputElement>("input")?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [active]);

  return <div
    aria-hidden={!active}
    onMouseDown={(event) => { if (event.target === event.currentTarget) setActive(false); }}
    style={{
      position: "fixed",
      inset: 0,
      zIndex: 2600,
      display: active ? "grid" : "none",
      alignItems: "start",
      justifyItems: "center",
      paddingTop: "12vh",
      background: "rgba(8,10,13,.42)",
      backdropFilter: "blur(5px)",
    }}
  >
    <div ref={contentRef} onMouseDown={(event) => event.stopPropagation()} style={{ width: "min(560px, calc(100vw - 24px))" }}>
      <GlobalSmartSearch/>
    </div>
  </div>;
}
