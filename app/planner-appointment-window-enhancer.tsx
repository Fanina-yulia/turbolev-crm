"use client";

import { useEffect } from "react";
import { navigateCrm, readCrmRoute } from "./crm-route";

type AppointmentSnapshot = {
  id: string;
  clientId: string | null;
  phone: string | null;
  estimatedAmount: string | number | null;
  purpose: "DIAGNOSTICS" | "REPAIR" | null;
};

type JsonRecord = Record<string, unknown>;

const COMPACT_CSS = `
[data-compact-appointment="true"] {
  width: min(660px, calc(100vw - 24px)) !important;
  max-height: calc(100vh - 16px) !important;
  overflow: hidden !important;
}
[data-compact-appointment="true"] [class*="detailsHead"] {
  padding: 11px 16px 9px !important;
  gap: 10px !important;
}
[data-compact-appointment="true"] [class*="detailsHead"] p { margin-bottom: 3px !important; }
[data-compact-appointment="true"] [class*="detailsHead"] h2 { font-size: 19px !important; }
[data-compact-appointment="true"] [class*="detailsHead"] span { margin-top: 3px !important; }
[data-compact-appointment="true"] [class*="detailsBody"] {
  gap: 7px !important;
  padding: 9px 16px 11px !important;
}
[data-compact-appointment="true"] [class*="detailsVehicle"] {
  padding: 9px 11px !important;
  border-radius: 9px !important;
}
[data-compact-appointment="true"] [class*="detailsGrid"] > div {
  padding: 8px 10px !important;
  gap: 2px !important;
}
[data-compact-appointment="true"] [class*="detailsSection"] {
  padding: 9px 11px !important;
  border-radius: 9px !important;
}
[data-compact-appointment="true"] [class*="detailsSection"] > p {
  margin-top: 5px !important;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
[data-compact-appointment="true"] [class*="detailsSection"] > small {
  margin-top: 4px !important;
  display: -webkit-box !important;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
[data-compact-appointment="true"] [data-planner-client-link] {
  cursor: pointer;
  outline: none;
  transition: background .12s ease;
}
[data-compact-appointment="true"] [data-planner-client-link]:hover,
[data-compact-appointment="true"] [data-planner-client-link]:focus-visible {
  background: color-mix(in srgb, var(--orange) 7%, var(--panel)) !important;
}
[data-compact-appointment="true"] [data-planner-client-link] strong {
  color: var(--orange);
  text-decoration: underline;
  text-decoration-thickness: 1px;
  text-underline-offset: 3px;
}
[data-compact-appointment="true"] [data-planner-estimate] {
  margin-top: 7px;
  padding: 8px 10px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border: 1px solid color-mix(in srgb, var(--orange) 35%, var(--line));
  border-radius: 8px;
  background: color-mix(in srgb, var(--orange) 6%, var(--panel));
}
[data-compact-appointment="true"] [data-planner-estimate] small {
  margin: 0 !important;
  color: var(--muted);
  font-size: 11px;
  font-weight: 850;
  letter-spacing: .06em;
  text-transform: uppercase;
}
[data-compact-appointment="true"] [data-planner-estimate] strong {
  color: var(--orange);
  font-size: 15px;
  white-space: nowrap;
}
[data-compact-appointment="true"] [data-planner-hidden="true"],
[data-compact-appointment="true"] [class*="detailsReadonly"],
[data-compact-appointment="true"] [class*="detailsFoot"] {
  display: none !important;
}
@media (max-height: 760px) and (min-width: 761px) {
  [data-compact-appointment="true"] [class*="detailsHead"] { padding-top: 8px !important; padding-bottom: 7px !important; }
  [data-compact-appointment="true"] [class*="detailsBody"] { gap: 5px !important; padding-top: 7px !important; padding-bottom: 8px !important; }
  [data-compact-appointment="true"] [class*="detailsVehicle"] { padding-top: 7px !important; padding-bottom: 7px !important; }
  [data-compact-appointment="true"] [class*="detailsGrid"] > div { padding-top: 6px !important; padding-bottom: 6px !important; }
  [data-compact-appointment="true"] [class*="detailsSection"] { padding-top: 7px !important; padding-bottom: 7px !important; }
}
@media (max-width: 760px) {
  [data-compact-appointment="true"] {
    width: 100% !important;
    max-height: calc(100vh - 12px) !important;
    overflow: auto !important;
  }
}
`;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringOrNull(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function parseSnapshot(value: unknown, appointmentId: string): AppointmentSnapshot | null {
  if (!isRecord(value) || !Array.isArray(value.appointments)) return null;
  const row = value.appointments.find((item) => isRecord(item) && item.id === appointmentId);
  if (!isRecord(row)) return null;
  const purpose = row.purpose === "DIAGNOSTICS" || row.purpose === "REPAIR" ? row.purpose : null;
  const estimatedAmount = typeof row.estimatedAmount === "number" || typeof row.estimatedAmount === "string" ? row.estimatedAmount : null;
  return {
    id: appointmentId,
    clientId: stringOrNull(row.clientId),
    phone: stringOrNull(row.phone),
    estimatedAmount,
    purpose,
  };
}

function parseClientId(value: unknown) {
  if (!isRecord(value) || !isRecord(value.client)) return null;
  return stringOrNull(value.client.id);
}

function formatAmount(value: AppointmentSnapshot["estimatedAmount"]) {
  const numeric = value == null || value === "" ? Number.NaN : Number(value);
  return Number.isFinite(numeric)
    ? new Intl.NumberFormat("uk-UA", { style: "currency", currency: "UAH", maximumFractionDigits: 0 }).format(numeric)
    : "Ще не розраховано";
}

function detailsModal() {
  return document.querySelector('[role="dialog"][aria-label="Інформація про запис"]') as HTMLElement | null;
}

function textOf(element: Element | null) {
  return element?.textContent?.replace(/\s+/g, " ").trim() || "";
}

function findSection(modal: HTMLElement, headings: string[]) {
  return Array.from(modal.querySelectorAll("section")).find((section) => {
    const heading = textOf(section.querySelector("h3"));
    return headings.includes(heading);
  }) as HTMLElement | undefined;
}

function findClientCell(modal: HTMLElement) {
  const clientLabel = Array.from(modal.querySelectorAll("small")).find((node) => textOf(node) === "КЛІЄНТ");
  return clientLabel?.parentElement as HTMLElement | null;
}

function hideNoise(modal: HTMLElement) {
  for (const heading of ["Фінанси", "Стан роботи"]) {
    const section = findSection(modal, [heading]);
    if (section) section.dataset.plannerHidden = "true";
  }
}

function renderEstimate(modal: HTMLElement, snapshot: AppointmentSnapshot | null) {
  const workSection = findSection(modal, ["Діагностика", "Роботи"]);
  if (!workSection) return;
  let estimate = workSection.querySelector("[data-planner-estimate]") as HTMLElement | null;
  if (!estimate) {
    estimate = document.createElement("div");
    estimate.dataset.plannerEstimate = "true";
    const label = document.createElement("small");
    label.dataset.plannerEstimateLabel = "true";
    const value = document.createElement("strong");
    value.dataset.plannerEstimateValue = "true";
    estimate.append(label, value);
    const title = workSection.querySelector("[class*='detailsSectionTitle']");
    title?.insertAdjacentElement("afterend", estimate);
    if (!title) workSection.prepend(estimate);
  }
  const heading = textOf(workSection.querySelector("h3"));
  const isRepair = snapshot?.purpose === "REPAIR" || heading === "Роботи";
  const label = estimate.querySelector("[data-planner-estimate-label]");
  const value = estimate.querySelector("[data-planner-estimate-value]");
  const nextLabel = isRepair ? "Орієнтовна сума робіт" : "Орієнтовна вартість діагностики";
  const nextValue = formatAmount(snapshot?.estimatedAmount ?? null);
  if (label && label.textContent !== nextLabel) label.textContent = nextLabel;
  if (value && value.textContent !== nextValue) value.textContent = nextValue;
}

function applyClientLink(modal: HTMLElement, clientId: string | null) {
  const cell = findClientCell(modal);
  if (!cell) return;
  if (!clientId) {
    delete cell.dataset.plannerClientLink;
    delete cell.dataset.clientId;
    cell.removeAttribute("role");
    cell.removeAttribute("tabindex");
    cell.removeAttribute("title");
    return;
  }
  cell.dataset.plannerClientLink = "true";
  cell.dataset.clientId = clientId;
  cell.setAttribute("role", "button");
  cell.setAttribute("tabindex", "0");
  cell.setAttribute("title", "Відкрити картку клієнта");
}

async function resolveSnapshot(appointmentId: string, signal: AbortSignal) {
  const now = Date.now();
  const params = new URLSearchParams({
    from: new Date(now - 86_400_000).toISOString(),
    to: new Date(now + 86_400_000).toISOString(),
    appointmentId,
  });
  const response = await fetch(`/api/planner?${params.toString()}`, { cache: "no-store", credentials: "include", signal });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) return null;
  const snapshot = parseSnapshot(payload, appointmentId);
  if (!snapshot || snapshot.clientId || !snapshot.phone) return snapshot;

  const clientResponse = await fetch(`/api/client-card?phone=${encodeURIComponent(snapshot.phone)}`, { cache: "no-store", credentials: "include", signal });
  const clientPayload: unknown = await clientResponse.json().catch(() => null);
  if (!clientResponse.ok) return snapshot;
  return { ...snapshot, clientId: parseClientId(clientPayload) };
}

export function PlannerAppointmentWindowEnhancer() {
  useEffect(() => {
    const cache = new Map<string, AppointmentSnapshot | null>();
    let activeAppointmentId = "";
    let controller: AbortController | null = null;
    let stopped = false;

    const decorate = (modal: HTMLElement, snapshot: AppointmentSnapshot | null) => {
      modal.dataset.compactAppointment = "true";
      hideNoise(modal);
      renderEstimate(modal, snapshot);
      applyClientLink(modal, snapshot?.clientId ?? null);
    };

    const tick = () => {
      if (stopped) return;
      const modal = detailsModal();
      if (!modal) {
        activeAppointmentId = "";
        controller?.abort();
        controller = null;
        return;
      }
      const appointmentId = readCrmRoute().appointmentId || "";
      if (!appointmentId) return;

      const cached = cache.get(appointmentId);
      decorate(modal, cached ?? null);
      if (cache.has(appointmentId)) return;
      if (activeAppointmentId === appointmentId && controller) return;

      controller?.abort();
      controller = new AbortController();
      activeAppointmentId = appointmentId;
      void resolveSnapshot(appointmentId, controller.signal)
        .then((snapshot) => {
          if (stopped || controller?.signal.aborted || activeAppointmentId !== appointmentId) return;
          cache.set(appointmentId, snapshot);
          const currentModal = detailsModal();
          if (currentModal && readCrmRoute().appointmentId === appointmentId) decorate(currentModal, snapshot);
        })
        .catch((error) => {
          if (error instanceof DOMException && error.name === "AbortError") return;
          cache.set(appointmentId, null);
        });
    };

    const openClient = (target: EventTarget | null) => {
      const element = target instanceof Element ? target.closest("[data-planner-client-link]") as HTMLElement | null : null;
      const clientId = element?.dataset.clientId;
      if (!clientId) return false;
      navigateCrm("Клієнти", { clientId });
      return true;
    };

    const onClick = (event: MouseEvent) => {
      if (openClient(event.target)) event.preventDefault();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      if (openClient(event.target)) event.preventDefault();
    };

    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("popstate", tick);
    const observer = new MutationObserver(tick);
    observer.observe(document.body, { childList: true, subtree: true });
    const timer = window.setInterval(tick, 350);
    tick();

    return () => {
      stopped = true;
      controller?.abort();
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("popstate", tick);
      observer.disconnect();
      window.clearInterval(timer);
    };
  }, []);

  return <style dangerouslySetInnerHTML={{ __html: COMPACT_CSS }} />;
}
