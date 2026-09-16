"use client";

import { useEffect } from "react";

const UX_STYLE = `
@media (max-width:600px) {
  [data-mechanic-cabinet="true"] > div {
    padding-bottom:calc(118px + env(safe-area-inset-bottom))!important;
  }
  [data-mechanic-cabinet="true"] main {
    padding-bottom:42px!important;
  }
}
[data-mechanic-additional-classifier="true"] select {
  background:var(--m-surface-2,#f7f9fb)!important;
  color:var(--m-text,#111923)!important;
  -webkit-text-fill-color:var(--m-text,#111923)!important;
  caret-color:var(--m-text,#111923)!important;
  opacity:1!important;
  color-scheme:light dark;
}
[data-mechanic-additional-classifier="true"] select option {
  background:var(--m-surface,#fff)!important;
  color:var(--m-text,#111923)!important;
  -webkit-text-fill-color:var(--m-text,#111923)!important;
}
`;

function textOf(node: Element | null) {
  return node?.textContent?.replace(/\s+/g, " ").trim() || "";
}

function clearStatusToast(root: HTMLElement) {
  for (const button of Array.from(root.querySelectorAll<HTMLButtonElement>("button"))) {
    if (textOf(button) !== "×") continue;
    const parent = button.parentElement;
    if (!parent) continue;
    const hasDirectMessage = Array.from(parent.children).some((child) => child.tagName === "SPAN");
    if (hasDirectMessage && window.getComputedStyle(parent).position === "fixed") {
      button.click();
    }
  }
}

function parseMinutes(value: string) {
  let result = 0;
  const hours = value.match(/(\d+(?:[.,]\d+)?)\s*год/i);
  const minutes = value.match(/(\d+)\s*хв/i);
  if (hours) result += Math.round(Number(hours[1].replace(",", ".")) * 60);
  if (minutes) result += Number(minutes[1]);
  return result;
}

function kyivClockMinutes() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Kyiv",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const hour = Number(parts.find((item) => item.type === "hour")?.value || 0);
  const minute = Number(parts.find((item) => item.type === "minute")?.value || 0);
  return hour * 60 + minute;
}

function correctActiveOverdue(root: HTMLElement) {
  const heading = Array.from(root.querySelectorAll("h2")).find((node) => textOf(node) === "Керування роботою");
  const controls = heading?.closest<HTMLElement>("section");
  const main = controls?.closest<HTMLElement>("main");
  if (!controls || !main) return;

  const active = Array.from(controls.querySelectorAll("button")).some((button) => textOf(button).includes("Пауза"));
  if (!active) return;

  const summary = main.querySelector<HTMLElement>(":scope > section:first-of-type");
  if (!summary) return;
  const pill = Array.from(summary.querySelectorAll<HTMLElement>("span")).find((node) =>
    textOf(node) === "Прострочено" || node.dataset.mechanicOverdueCorrected === "true",
  );
  if (!pill) return;

  const meta = Array.from(summary.querySelectorAll<HTMLElement>("span"));
  const startText = textOf(meta.find((node) => textOf(node).startsWith("Початок")) || null);
  const durationText = textOf(meta.find((node) => textOf(node).startsWith("Тривалість")) || null);
  const startMatch = startText.match(/(\d{1,2}):(\d{2})/);
  const plannedMinutes = parseMinutes(durationText);
  if (!startMatch || plannedMinutes <= 0) return;

  const startMinutes = Number(startMatch[1]) * 60 + Number(startMatch[2]);
  let nowMinutes = kyivClockMinutes();
  if (startMinutes > nowMinutes + 12 * 60) nowMinutes += 24 * 60;
  const actuallyOverdue = Math.max(0, nowMinutes - startMinutes) >= plannedMinutes;
  const warning = Array.from(summary.querySelectorAll<HTMLElement>("p")).find((node) => textOf(node).includes("Плановий час уже минув"));

  if (!actuallyOverdue) {
    pill.dataset.mechanicOverdueCorrected = "true";
    pill.textContent = "В роботі";
    pill.style.background = "var(--m-blue-soft)";
    pill.style.color = "var(--m-blue)";
    pill.style.border = "1px solid color-mix(in srgb,var(--m-blue) 35%,var(--m-border))";
    if (warning) warning.hidden = true;
  } else if (pill.dataset.mechanicOverdueCorrected === "true") {
    delete pill.dataset.mechanicOverdueCorrected;
    pill.textContent = "Прострочено";
    pill.style.background = "var(--m-danger-soft)";
    pill.style.color = "var(--m-danger)";
    pill.style.border = "1px solid color-mix(in srgb,var(--m-danger) 45%,var(--m-border))";
    if (warning) warning.hidden = false;
  }
}

function decorate(root: HTMLElement) {
  for (const button of Array.from(root.querySelectorAll<HTMLButtonElement>("button"))) {
    const label = textOf(button);
    if (label.includes("Завершити ремонт")) {
      button.textContent = label.replace("Завершити ремонт", "Завершити роботу");
      continue;
    }
    if (label === "Не можу виконати роботу") {
      button.hidden = true;
      button.disabled = true;
      button.style.display = "none";
      continue;
    }
    if (label.includes("Додати фото / виявлений дефект")) {
      button.innerHTML = "📷 Дефект / фото <span>›</span>";
      continue;
    }
    if (label.includes("Додати виявлене")) {
      button.textContent = label.replace("Додати виявлене", "Додаткова робота");
    }
  }

  for (const strong of Array.from(root.querySelectorAll<HTMLElement>("header strong"))) {
    if (textOf(strong) === "Додати виявлене") strong.textContent = "Додаткова робота";
  }

  correctActiveOverdue(root);
}

export function MechanicWorkflowUxBridge() {
  useEffect(() => {
    const nativeFetch = window.fetch.bind(window);
    const patchedFetch: typeof window.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (typeof init?.body === "string" && (init.method || "GET").toUpperCase() === "PATCH" && /\/api\/cabinet\/mechanic\/tasks\/[^/?]+(?:\?.*)?$/.test(url)) {
        try {
          const body = JSON.parse(init.body) as Record<string, unknown>;
          if (body.action === "WAITING_PARTS") {
            const target = url.replace(/(\?.*)?$/, "/wait-parts$1");
            return nativeFetch(target, init);
          }
        } catch {
          // Keep the original request for non-JSON callers.
        }
      }
      return nativeFetch(input, init);
    };
    window.fetch = patchedFetch;

    const onClick = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target.closest("button") : null;
      const root = document.querySelector<HTMLElement>('[data-mechanic-cabinet="true"]');
      if (!target || !root) return;
      const label = textOf(target);
      if (["Запросити запчастину", "Поставити питання менеджеру", "Дефект / фото", "Додаткова робота", "Додати фото / виявлений дефект", "Додати виявлене"].some((value) => label.includes(value))) {
        clearStatusToast(root);
      }
    };
    document.addEventListener("click", onClick, true);

    let frame = 0;
    const run = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const root = document.querySelector<HTMLElement>('[data-mechanic-cabinet="true"]');
        if (root) decorate(root);
      });
    };
    const observer = new MutationObserver(run);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    const timer = window.setInterval(run, 30000);
    run();

    return () => {
      observer.disconnect();
      window.clearInterval(timer);
      window.cancelAnimationFrame(frame);
      document.removeEventListener("click", onClick, true);
      if (window.fetch === patchedFetch) window.fetch = nativeFetch;
    };
  }, []);

  return <style dangerouslySetInnerHTML={{ __html: UX_STYLE }} />;
}
