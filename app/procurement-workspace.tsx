"use client";

import { useEffect, useRef } from "react";
import { readCrmRoute } from "./crm-route";
import { ProcurementQueue } from "./procurement-queue";
import styles from "./procurement-workspace.module.css";

type ProcurementCard = {
  id: string;
  plate?: string | null;
  vin?: string | null;
  vehicle?: string | null;
  workOrderId?: string | null;
  number?: number | null;
};

type ProcurementResponse = { ok?: boolean; cards?: ProcurementCard[] };

function textOf(node: Element) {
  return String(node.textContent || "").replace(/\s+/g, " ").trim();
}

function setNativeInput(input: HTMLInputElement, value: string) {
  if (!value || input.value === value) return;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function clearFocusedCard() {
  document.querySelectorAll('[data-procurement-route-focus="true"]').forEach((node) => node.removeAttribute("data-procurement-route-focus"));
}

function focusRenderedCard(card: ProcurementCard) {
  const plate = card.plate?.trim();
  const vin = card.vin?.trim();
  const candidates = Array.from(document.querySelectorAll<HTMLElement>("article"));
  const target = candidates.find((article) => {
    const text = textOf(article);
    return Boolean((plate && text.includes(plate)) || (vin && text.includes(vin)));
  });
  if (!target) return false;
  clearFocusedCard();
  target.setAttribute("data-procurement-route-focus", "true");
  target.scrollIntoView({ behavior: "smooth", block: "center" });
  return true;
}

function ProcurementRouteFocus() {
  const applied = useRef("");

  useEffect(() => {
    let cancelled = false;
    let observer: MutationObserver | null = null;
    let timer = 0;

    const sync = async () => {
      const url = new URL(window.location.href);
      if (url.searchParams.get("section") !== "procurement") return;
      const route = readCrmRoute();
      if (!route.partsRequestId || applied.current === route.partsRequestId) return;

      try {
        const response = await fetch("/api/procurement", { cache: "no-store" });
        const payload = await response.json().catch(() => null) as ProcurementResponse | null;
        if (!response.ok || !payload?.cards || cancelled) return;
        const card = payload.cards.find((item) => item.id === route.partsRequestId);
        if (!card) return;

        const query = card.plate || card.vin || card.vehicle || "";
        const input = Array.from(document.querySelectorAll<HTMLInputElement>("input")).find((item) => item.placeholder?.includes("ЗН, авто, VIN"));
        if (input && query) setNativeInput(input, query);

        const tryFocus = () => {
          if (focusRenderedCard(card)) {
            applied.current = route.partsRequestId || "";
            observer?.disconnect();
            return true;
          }
          return false;
        };

        if (!tryFocus()) {
          observer = new MutationObserver(() => {
            window.clearTimeout(timer);
            timer = window.setTimeout(tryFocus, 60);
          });
          observer.observe(document.body, { childList: true, subtree: true });
        }
      } catch {
        return;
      }
    };

    const onPopState = () => {
      applied.current = "";
      clearFocusedCard();
      void sync();
    };
    window.addEventListener("popstate", onPopState);
    void sync();
    return () => {
      cancelled = true;
      observer?.disconnect();
      window.clearTimeout(timer);
      window.removeEventListener("popstate", onPopState);
    };
  }, []);

  return null;
}

export function ProcurementWorkspace() {
  return <div className={styles.root}>
    <ProcurementRouteFocus/>
    <ProcurementQueue/>
  </div>;
}
