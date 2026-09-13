"use client";

import { useEffect } from "react";

type RequestKind = "ADDITIONAL_WORK" | "ADDITIONAL_DIAGNOSTIC" | "REPAIR_COMPLICATION";
type WorkImpact = "CAN_CONTINUE" | "BLOCKS_REPAIR";

const STYLE = `
[data-mechanic-additional-classifier="true"] {
  display: grid;
  gap: 10px;
  margin-bottom: 12px;
}
[data-mechanic-additional-classifier="true"] label {
  display: grid;
  gap: 6px;
  font-size: 12px;
  font-weight: 800;
}
[data-mechanic-additional-classifier="true"] select {
  min-height: 44px;
  width: 100%;
  padding: 9px 11px;
  border: 1px solid var(--m-border, #d8dde4);
  border-radius: 10px;
  background: var(--m-card, #fff);
  color: inherit;
  font: inherit;
  font-size: 13px;
}
[data-mechanic-additional-warning="true"] {
  margin: 0;
  padding: 10px 11px;
  border: 1px solid color-mix(in srgb, var(--m-danger, #d9363e) 45%, transparent);
  border-radius: 10px;
  background: color-mix(in srgb, var(--m-danger, #d9363e) 8%, transparent);
  color: var(--m-danger, #b42318);
  font-size: 11px;
  line-height: 1.4;
  font-weight: 750;
}
`;

function textOf(node: Element | null) {
  return node?.textContent?.replace(/\s+/g, " ").trim() || "";
}

function option(value: string, label: string) {
  const item = document.createElement("option");
  item.value = value;
  item.textContent = label;
  return item;
}

function currentClassifier() {
  return document.querySelector('[data-mechanic-additional-classifier="true"]') as HTMLElement | null;
}

function classifierValues() {
  const root = currentClassifier();
  const kind = root?.querySelector('select[data-additional-kind]') as HTMLSelectElement | null;
  const impact = root?.querySelector('select[data-additional-impact]') as HTMLSelectElement | null;
  return {
    kind: (kind?.value || "ADDITIONAL_WORK") as RequestKind,
    impact: (impact?.value || "CAN_CONTINUE") as WorkImpact,
  };
}

function updateWarning(root: HTMLElement) {
  const impact = root.querySelector('select[data-additional-impact]') as HTMLSelectElement | null;
  let warning = root.querySelector('[data-mechanic-additional-warning="true"]') as HTMLElement | null;
  const blocked = impact?.value === "BLOCKS_REPAIR";
  if (blocked && !warning) {
    warning = document.createElement("p");
    warning.dataset.mechanicAdditionalWarning = "true";
    warning.textContent = "Ця потреба блокує подальший ремонт. CRM відкриє технічний blocker і передасть ситуацію на контроль до погодження або скасування позиції.";
    root.append(warning);
  } else if (!blocked && warning) {
    warning.remove();
  }
}

function decorateMechanicAdditionalWork() {
  const cabinet = document.querySelector('[data-mechanic-cabinet="true"]');
  if (!cabinet) return;

  for (const button of Array.from(cabinet.querySelectorAll("button"))) {
    if (textOf(button).includes("Додаткові роботи")) button.textContent = "＋ Додати виявлене";
  }

  for (const strong of Array.from(cabinet.querySelectorAll("header strong"))) {
    if (textOf(strong) === "Додаткова робота") strong.textContent = "Додати виявлене";
  }

  const descriptionLabel = Array.from(cabinet.querySelectorAll("label")).find((label) => textOf(label).includes("Що потрібно додатково виконати?"));
  if (!descriptionLabel) return;
  const form = descriptionLabel.parentElement;
  if (!form || form.querySelector('[data-mechanic-additional-classifier="true"]')) return;

  const classifier = document.createElement("div");
  classifier.dataset.mechanicAdditionalClassifier = "true";

  const kindLabel = document.createElement("label");
  kindLabel.append(document.createTextNode("Тип виявленої потреби"));
  const kind = document.createElement("select");
  kind.dataset.additionalKind = "true";
  kind.append(
    option("ADDITIONAL_WORK", "Додаткова робота"),
    option("ADDITIONAL_DIAGNOSTIC", "Додаткова діагностика"),
    option("REPAIR_COMPLICATION", "Ускладнення під час ремонту"),
  );
  kindLabel.append(kind);

  const impactLabel = document.createElement("label");
  impactLabel.append(document.createTextNode("Чи можна продовжувати поточний ремонт?"));
  const impact = document.createElement("select");
  impact.dataset.additionalImpact = "true";
  impact.append(
    option("CAN_CONTINUE", "Так, ремонт можна продовжувати"),
    option("BLOCKS_REPAIR", "Ні, потрібне рішення / погодження"),
  );
  impact.addEventListener("change", () => updateWarning(classifier));
  impactLabel.append(impact);

  classifier.append(kindLabel, impactLabel);
  form.insertBefore(classifier, descriptionLabel);
}

export function MechanicAdditionalWorkBridge() {
  useEffect(() => {
    const nativeFetch = window.fetch.bind(window);
    const patchedFetch: typeof window.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes("/api/cabinet/mechanic/tasks/") && url.includes("/additional-work") && typeof init?.body === "string") {
        try {
          const body = JSON.parse(init.body) as Record<string, unknown>;
          const { kind, impact } = classifierValues();
          init = {
            ...init,
            body: JSON.stringify({ ...body, kind, impact }),
          };
        } catch {
          // Preserve the original request if a non-JSON caller ever uses this endpoint.
        }
      }
      return nativeFetch(input, init);
    };
    window.fetch = patchedFetch;

    let scheduled = false;
    const run = () => {
      scheduled = false;
      decorateMechanicAdditionalWork();
    };
    const schedule = () => {
      if (scheduled) return;
      scheduled = true;
      window.requestAnimationFrame(run);
    };
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });
    schedule();

    return () => {
      observer.disconnect();
      if (window.fetch === patchedFetch) window.fetch = nativeFetch;
    };
  }, []);

  return <style dangerouslySetInnerHTML={{ __html: STYLE }} />;
}
