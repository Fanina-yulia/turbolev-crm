"use client";

import { useEffect } from "react";
import { navigateCrm, readCrmRoute } from "./crm-route";

type CommercialSummary = {
  currency: string;
  mixedCurrency: boolean;
  approvedAmount: number | null;
  pendingAmount: number | null;
  approvedCount: number;
  pendingCount: number;
  mechanicRequestedPendingCount: number;
};

type Payload = {
  ok: boolean;
  appointmentId?: string;
  workOrderId?: string | null;
  commercialSummary?: CommercialSummary | null;
};

const STYLE = `
[data-planner-estimate][data-commercial-summary="true"] { display:grid !important; gap:5px !important; align-items:stretch !important; }
[data-planner-commercial-row] { display:flex; align-items:center; justify-content:space-between; gap:12px; }
[data-planner-commercial-row] small { margin:0 !important; color:var(--muted); font-size:11px; font-weight:850; letter-spacing:.04em; text-transform:uppercase; }
[data-planner-commercial-row] strong { font-size:15px; white-space:nowrap; }
[data-planner-commercial-row="pending"] strong { color:#a15c00 !important; }
[data-planner-commercial-hint] { margin:2px 0 0 !important; color:var(--muted); font-size:11px; line-height:1.35; }
`;

function textOf(element: Element | null) {
  return element?.textContent?.replace(/\s+/g, " ").trim() || "";
}

function detailsModal() {
  return document.querySelector('[role="dialog"][aria-label="Інформація про запис"]') as HTMLElement | null;
}

function findWorkSection(modal: HTMLElement) {
  return Array.from(modal.querySelectorAll("section")).find((section) => {
    const heading = textOf(section.querySelector("h3"));
    return heading === "Роботи" || heading === "Діагностика";
  }) as HTMLElement | undefined;
}

function money(amount: number | null, currency: string) {
  if (amount == null || !Number.isFinite(amount)) return "—";
  try {
    return new Intl.NumberFormat("uk-UA", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `${new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 0 }).format(amount)} ${currency}`;
  }
}

function signatureOf(payload: Payload | null) {
  if (!payload?.workOrderId || !payload.commercialSummary) return "none";
  const summary = payload.commercialSummary;
  return JSON.stringify([
    payload.workOrderId,
    summary.currency,
    summary.mixedCurrency,
    summary.approvedAmount,
    summary.pendingAmount,
    summary.approvedCount,
    summary.pendingCount,
    summary.mechanicRequestedPendingCount,
  ]);
}

function commercialRow(kind: "approved" | "pending", label: string, value: string) {
  const row = document.createElement("div");
  row.dataset.plannerCommercialRow = kind;
  const small = document.createElement("small");
  small.textContent = label;
  const strong = document.createElement("strong");
  strong.textContent = value;
  row.append(small, strong);
  return row;
}

function decorate(modal: HTMLElement, payload: Payload | null) {
  const workSection = findWorkSection(modal);
  if (!workSection) return;
  const editButton = workSection.querySelector("button") as HTMLButtonElement | null;

  if (!payload?.workOrderId || !payload.commercialSummary) {
    if (editButton) {
      delete editButton.dataset.plannerCommercialLink;
      delete editButton.dataset.workOrderId;
    }
    return;
  }

  if (editButton) {
    editButton.dataset.plannerCommercialLink = "true";
    editButton.dataset.workOrderId = payload.workOrderId;
    editButton.title = "Відкрити комерційну пропозицію / Work Order";
    editButton.setAttribute("aria-label", "Відкрити комерційну пропозицію / Work Order");
  }

  let estimate = workSection.querySelector("[data-planner-estimate]") as HTMLElement | null;
  if (!estimate) {
    estimate = document.createElement("div");
    estimate.dataset.plannerEstimate = "true";
    const title = workSection.querySelector("[class*='detailsSectionTitle']");
    title?.insertAdjacentElement("afterend", estimate);
    if (!title) workSection.prepend(estimate);
  }

  const signature = signatureOf(payload);
  if (estimate.dataset.commercialSummarySignature === signature) return;

  estimate.dataset.commercialSummary = "true";
  estimate.dataset.commercialSummarySignature = signature;
  const summary = payload.commercialSummary;

  const fragment = document.createDocumentFragment();
  if (summary.mixedCurrency) {
    fragment.append(commercialRow("approved", "Суми", "Кілька валют"));
    const hint = document.createElement("p");
    hint.dataset.plannerCommercialHint = "true";
    hint.textContent = "Відкрийте комерційну пропозицію для розбивки за валютами.";
    fragment.append(hint);
  } else {
    fragment.append(commercialRow("approved", "Погоджено", money(summary.approvedAmount, summary.currency)));
    if (summary.pendingCount > 0 || (summary.pendingAmount ?? 0) > 0) {
      fragment.append(commercialRow("pending", "Очікує погодження", money(summary.pendingAmount, summary.currency)));
    }
    if (summary.mechanicRequestedPendingCount > 0) {
      const hint = document.createElement("p");
      hint.dataset.plannerCommercialHint = "true";
      hint.textContent = `Від механіка очікує рішення: ${summary.mechanicRequestedPendingCount}`;
      fragment.append(hint);
    }
  }

  estimate.replaceChildren(fragment);
}

async function loadSummary(appointmentId: string, signal: AbortSignal) {
  const response = await fetch(`/api/planner/${encodeURIComponent(appointmentId)}/commercial-summary`, {
    cache: "no-store",
    credentials: "include",
    signal,
  });
  const payload = await response.json().catch(() => null) as Payload | null;
  return response.ok && payload?.ok ? payload : null;
}

export function PlannerCommercialSummaryEnhancerV2() {
  useEffect(() => {
    const cache = new Map<string, Payload | null>();
    let active = "";
    let controller: AbortController | null = null;
    let stopped = false;
    let scheduled = false;

    const tick = () => {
      scheduled = false;
      if (stopped) return;
      const modal = detailsModal();
      if (!modal) {
        active = "";
        controller?.abort();
        controller = null;
        return;
      }

      const appointmentId = readCrmRoute().appointmentId || "";
      if (!appointmentId) return;

      if (cache.has(appointmentId)) {
        decorate(modal, cache.get(appointmentId) ?? null);
        return;
      }
      if (active === appointmentId && controller) return;

      controller?.abort();
      controller = new AbortController();
      active = appointmentId;
      const currentController = controller;
      void loadSummary(appointmentId, currentController.signal)
        .then((payload) => {
          if (stopped || currentController.signal.aborted || active !== appointmentId) return;
          cache.set(appointmentId, payload);
          const current = detailsModal();
          if (current && readCrmRoute().appointmentId === appointmentId) decorate(current, payload);
        })
        .catch((error) => {
          if (error instanceof DOMException && error.name === "AbortError") return;
          cache.set(appointmentId, null);
        });
    };

    const scheduleTick = () => {
      if (scheduled || stopped) return;
      scheduled = true;
      window.requestAnimationFrame(tick);
    };

    const invalidate = () => {
      cache.clear();
      active = "";
      controller?.abort();
      controller = null;
      scheduleTick();
    };

    const onClick = (event: MouseEvent) => {
      const target = event.target instanceof Element
        ? event.target.closest("[data-planner-commercial-link]") as HTMLElement | null
        : null;
      const workOrderId = target?.dataset.workOrderId;
      if (!workOrderId) return;
      event.preventDefault();
      event.stopPropagation();
      navigateCrm("Комерційна пропозиція", { workOrderId, workOrderTab: "estimate" });
    };

    document.addEventListener("click", onClick, true);
    window.addEventListener("popstate", scheduleTick);
    window.addEventListener("focus", invalidate);
    window.addEventListener("turbolev:data-changed", invalidate as EventListener);

    const observer = new MutationObserver(scheduleTick);
    observer.observe(document.body, { childList: true, subtree: true });
    scheduleTick();

    return () => {
      stopped = true;
      controller?.abort();
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("popstate", scheduleTick);
      window.removeEventListener("focus", invalidate);
      window.removeEventListener("turbolev:data-changed", invalidate as EventListener);
      observer.disconnect();
    };
  }, []);

  return <style dangerouslySetInnerHTML={{ __html: STYLE }} />;
}
