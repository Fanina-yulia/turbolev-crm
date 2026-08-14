"use client";

import { useEffect } from "react";

function applyLeadFilter() {
  const url = new URL(window.location.href);
  if (url.searchParams.get("section") !== "leads") return;
  const filter = url.searchParams.get("filter");
  const wanted = filter === "new" ? "Нові" : filter === "booked" ? "Записані" : null;
  if (!wanted) return;

  const cards = Array.from(document.querySelectorAll<HTMLButtonElement>(".leadKpiCard"));
  const target = cards.find((button) => button.querySelector("span")?.textContent?.trim() === wanted);
  if (target && !target.classList.contains("leadKpiActive")) target.click();
}

export function WorkflowFilterEnhancer() {
  useEffect(() => {
    let timer = 0;
    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(applyLeadFilter, 80);
    };

    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("popstate", schedule);
    window.addEventListener("turbolev:navigate", schedule);
    schedule();

    return () => {
      observer.disconnect();
      window.removeEventListener("popstate", schedule);
      window.removeEventListener("turbolev:navigate", schedule);
      window.clearTimeout(timer);
    };
  }, []);

  return null;
}
