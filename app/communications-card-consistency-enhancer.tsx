"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ClientCardContract, ClientCardVehicleContract } from "@/src/lib/contracts/client-card";
import { parseClientCardGetPayload } from "@/src/lib/contracts/client-card-payload.parsers";
import { VehicleIdentity } from "./vehicle-identity";

type Props = {
  open: boolean;
  name: string;
  phone?: string;
  channel?: string;
};

type PortalTarget = {
  key: string;
  mount: HTMLSpanElement;
  vehicle: ClientCardVehicleContract;
  variant: "summary" | "choice";
};

function normalizePhone(value: string) {
  let digits = value.replace(/\D/g, "");
  if (digits.startsWith("0")) digits = `38${digits}`;
  if (!digits.startsWith("380") && digits.length === 9) digits = `380${digits}`;
  return digits.slice(0, 12);
}

function displayPhone(value: string) {
  const digits = normalizePhone(value);
  if (digits.length !== 12) return value;
  const local = digits.slice(3);
  return `+380 ${local.slice(0, 2)} ${local.slice(2, 5)} ${local.slice(5, 7)} ${local.slice(7, 9)}`;
}

function channelLabel(channel?: string) {
  return channel === "BINOTEL" ? "Binotel" : channel === "INSTAGRAM" ? "Instagram" : channel === "FACEBOOK" ? "Facebook" : channel === "TELEGRAM" ? "Telegram" : channel === "TIKTOK" ? "TikTok" : channel === "OLX" ? "OLX" : channel === "WEBSITE" ? "Сайт" : channel || "";
}

function sameTargets(left: PortalTarget[], right: PortalTarget[]) {
  return left.length === right.length && left.every((item, index) => item.mount === right[index]?.mount && item.vehicle.id === right[index]?.vehicle.id && item.variant === right[index]?.variant);
}

export function CommunicationsCardConsistencyEnhancer({ open, name, phone, channel }: Props) {
  const [client, setClient] = useState<ClientCardContract | null>(null);
  const [version, setVersion] = useState(0);
  const [targets, setTargets] = useState<PortalTarget[]>([]);
  const targetsRef = useRef<PortalTarget[]>([]);

  useEffect(() => { targetsRef.current = targets; }, [targets]);

  useEffect(() => {
    const refresh = () => setVersion((value) => value + 1);
    window.addEventListener("turbolev:data-changed", refresh);
    return () => window.removeEventListener("turbolev:data-changed", refresh);
  }, []);

  useEffect(() => {
    const normalized = normalizePhone(phone || "");
    if (normalized.length !== 12) {
      setClient(null);
      return;
    }
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`/api/client-card?phone=${encodeURIComponent(phone || normalized)}`, { cache: "no-store", signal: controller.signal });
        const raw: unknown = await response.json().catch(() => null);
        const parsed = parseClientCardGetPayload(raw);
        if (!controller.signal.aborted) setClient(response.ok && parsed ? parsed.client : null);
      } catch {
        if (!controller.signal.aborted) setClient(null);
      }
    })();
    return () => controller.abort();
  }, [phone, version]);

  const apply = useCallback(() => {
    const nextTargets: PortalTarget[] = [];

    const contactButton = document.querySelector<HTMLButtonElement>('button[class*="contactSummary"]');
    if (contactButton) {
      const contactText = contactButton.querySelector<HTMLElement>('[class*="contactText"]');
      if (contactText) {
        const strong = contactText.querySelector("strong");
        const small = contactText.querySelector("small");
        if (strong) strong.textContent = client?.name?.trim() || name || "Клієнт";
        if (small && phone) small.textContent = displayPhone(phone);
        const verbose = contactText.querySelector<HTMLElement>(".communicationsChannelContext");
        if (verbose) verbose.style.display = "none";
        let badge = contactText.querySelector<HTMLElement>("[data-tlv-channel-badge]");
        const label = channelLabel(channel);
        if (label && !badge) {
          badge = document.createElement("span");
          badge.dataset.tlvChannelBadge = "1";
          badge.className = "tlvChannelBadge";
          contactText.appendChild(badge);
        }
        if (badge) badge.textContent = label;
      }
      const openHint = contactButton.querySelector<HTMLElement>('[class*="openHint"]');
      if (openHint) openHint.style.display = "none";
    }

    const headerVehicleButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('button[class*="vehicleSummary"]'));
    headerVehicleButtons.forEach((button, index) => {
      const vehicle = client?.vehicles?.[index];
      if (!vehicle) return;
      Array.from(button.children).forEach((child) => {
        const element = child as HTMLElement;
        if (!element.dataset.tlvVehicleMount) element.style.display = "none";
      });
      button.classList.add("tlvVehicleSummaryEnhanced");
      let mount = button.querySelector<HTMLSpanElement>("[data-tlv-vehicle-mount]");
      if (!mount) {
        mount = document.createElement("span");
        mount.dataset.tlvVehicleMount = "header";
        mount.className = "tlvVehicleMount";
        button.appendChild(mount);
      }
      nextTargets.push({ key: `header:${vehicle.id}`, mount, vehicle, variant: "summary" });
    });

    const drawer = document.querySelector<HTMLElement>(".clientDrawer");
    if (drawer) {
      const head = drawer.querySelector<HTMLElement>(".clientDrawerHead");
      if (head) {
        const title = head.querySelector("h2");
        const subtitle = head.querySelector("span");
        if (title) title.textContent = client?.name?.trim() || name || "Клієнт";
        if (subtitle && phone) subtitle.textContent = displayPhone(phone);
      }

      const contactSection = drawer.querySelector<HTMLElement>(".contactCompact");
      if (contactSection) {
        const blockTitle = contactSection.querySelector<HTMLElement>(".clientBlockTitle");
        if (blockTitle) {
          const oldNote = blockTitle.querySelector<HTMLElement>("span");
          if (oldNote) oldNote.style.display = "none";
          let edit = blockTitle.querySelector<HTMLButtonElement>("[data-tlv-edit-contact]");
          if (!edit) {
            edit = document.createElement("button");
            edit.type = "button";
            edit.dataset.tlvEditContact = "1";
            edit.className = "tlvEditContact";
            edit.textContent = "Редагувати контакт";
            edit.addEventListener("click", () => {
              contactSection.dataset.tlvEditing = contactSection.dataset.tlvEditing === "true" ? "false" : "true";
              apply();
            });
            blockTitle.appendChild(edit);
          }
          edit.textContent = contactSection.dataset.tlvEditing === "true" ? "Готово" : "Редагувати контакт";
        }
        let compact = contactSection.querySelector<HTMLElement>("[data-tlv-contact-compact]");
        if (!compact) {
          compact = document.createElement("div");
          compact.dataset.tlvContactCompact = "1";
          compact.className = "tlvContactCompact";
          const strong = document.createElement("strong");
          const span = document.createElement("span");
          compact.append(strong, span);
          blockTitle?.insertAdjacentElement("afterend", compact);
        }
        const compactStrong = compact.querySelector("strong");
        const compactPhone = compact.querySelector("span");
        if (compactStrong) compactStrong.textContent = client?.name?.trim() || name || "Клієнт";
        if (compactPhone) compactPhone.textContent = displayPhone(client?.phone || phone || "");
        const editing = contactSection.dataset.tlvEditing === "true";
        Array.from(contactSection.children).forEach((child) => {
          const element = child as HTMLElement;
          if (element === blockTitle || element === compact || element.classList.contains("clientMessage")) return;
          element.style.display = editing ? "" : "none";
        });
        compact.style.display = editing ? "none" : "flex";
      }

      const vehicleButtons = Array.from(drawer.querySelectorAll<HTMLButtonElement>(".vehicleChoice"));
      vehicleButtons.forEach((button, index) => {
        const vehicle = client?.vehicles?.[index];
        if (!vehicle) return;
        Array.from(button.children).forEach((child) => {
          const element = child as HTMLElement;
          if (!element.dataset.tlvVehicleMount) element.style.display = "none";
        });
        button.classList.add("tlvVehicleChoiceEnhanced");
        let mount = button.querySelector<HTMLSpanElement>("[data-tlv-vehicle-mount]");
        if (!mount) {
          mount = document.createElement("span");
          mount.dataset.tlvVehicleMount = "drawer";
          mount.className = "tlvVehicleMount";
          button.appendChild(mount);
        }
        nextTargets.push({ key: `drawer:${vehicle.id}`, mount, vehicle, variant: "choice" });
      });

      const duplicateActiveVehicle = drawer.querySelector<HTMLElement>(".activeVehicleBlock");
      if (duplicateActiveVehicle) duplicateActiveVehicle.style.display = "none";
    }

    if (!sameTargets(targetsRef.current, nextTargets)) setTargets(nextTargets);
  }, [channel, client, name, phone]);

  useEffect(() => {
    let timer: number | undefined;
    const schedule = () => {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(apply, 40);
    };
    apply();
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      if (timer) window.clearTimeout(timer);
    };
  }, [apply, open]);

  return <>
    {targets.map((target) => createPortal(<VehicleIdentity vehicle={target.vehicle} variant={target.variant} showVin={target.variant === "choice"}/>, target.mount, target.key))}
    <style jsx global>{`
      .tlvChannelBadge{display:inline-flex!important;align-items:center;width:max-content;margin-top:6px;padding:4px 8px;border:1px solid var(--line);border-radius:999px;background:var(--surface);color:var(--orange)!important;font-size:12px!important;font-weight:800;line-height:1.2}
      .tlvVehicleSummaryEnhanced{min-width:310px!important;flex-basis:310px!important;display:block!important;padding:6px 10px!important}
      .tlvVehicleMount{display:block!important;width:100%;min-width:0}
      .tlvEditContact{border:1px solid var(--line);border-radius:9px;background:var(--surface);color:var(--text);padding:6px 9px;font-size:12px;font-weight:800;cursor:pointer}
      .tlvContactCompact{align-items:center;justify-content:space-between;gap:12px;border:1px solid var(--line);border-radius:11px;background:var(--surface);padding:11px 12px}.tlvContactCompact strong{font-size:14px}.tlvContactCompact span{color:var(--muted);font-size:12px}
      .tlvVehicleChoiceEnhanced{display:block!important;padding:10px 12px!important;min-height:112px}.tlvVehicleChoiceEnhanced.active{box-shadow:inset 4px 0 0 var(--orange)!important}
      .clientDrawerHead p,.clientDrawerHead span,.clientBlockTitle span,.clientDrawer .contactCompact label,.clientDrawer .twoPhones label>span,.clientDrawer .clientMessage,.clientDrawer .addVehicleToggle,.clientDrawer .vehicleAddCompact small,.clientDrawer .inlineHistory,.clientDrawer .gateHint{font-size:12px!important}.clientDrawer .contactCompact input,.clientDrawer .vehicleAddCompact input,.clientDrawer .vehicleAddCompact button,.clientDrawer .nextAction,.clientDrawer .actionGrid button{font-size:13px!important}.clientDrawer .clientBlockTitle b{font-size:14px!important}.clientDrawerHead h2{font-size:23px!important}
      @media(max-width:720px){.tlvVehicleSummaryEnhanced{min-width:270px!important;flex-basis:270px!important}.tlvContactCompact{align-items:flex-start;flex-direction:column}}
    `}</style>
  </>;
}
