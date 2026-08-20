"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { VehicleBrandLogo } from "./vehicle-brand-logo";
import { VehicleRender } from "./vehicle-render";
import { formatVehiclePlate, normalizeVehiclePlate } from "./vehicle-plate";

const PLATE_RE = /[A-ZАВЕІКМНОРСТХУ]{2}[\s\-–—]?\d{4}[\s\-–—]?[A-ZАВЕІКМНОРСТХУ]{2}/giu;
const ALNUM_RE = /[A-ZА-ЯІЇЄ0-9]/iu;
const SKIP_SELECTOR = [
  "script",
  "style",
  "textarea",
  "input",
  "select",
  "option",
  "code",
  "pre",
  "[contenteditable='true']",
  "[data-no-plate-enhance]",
  "[data-vehicle-plate]",
].join(",");

type VehicleIdentity = {
  id: string;
  brand: string | null;
  model: string | null;
  year: number | null;
};

type MechanicTarget = {
  key: string;
  plate: string;
  title: string;
  fallbackBrand: string;
  iconHost: HTMLElement;
  photoHost: HTMLElement;
};

function isBoundary(text: string, index: number) {
  if (index < 0 || index >= text.length) return true;
  return !ALNUM_RE.test(text[index] || "");
}

function plateMarkup(value: string) {
  const normalized = normalizeVehiclePlate(value);
  const display = formatVehiclePlate(value);
  const plate = document.createElement("span");
  plate.className = "turboLevVehiclePlate";
  plate.dataset.vehiclePlate = "true";
  plate.dataset.plate = normalized;
  plate.setAttribute("role", "img");
  plate.setAttribute("aria-label", `Державний номер ${display}`);
  plate.title = `Державний номер ${display}`;

  const band = document.createElement("span");
  band.className = "turboLevVehiclePlateBand";
  band.setAttribute("aria-hidden", "true");
  const flag = document.createElement("i");
  const ua = document.createElement("b");
  ua.textContent = "UA";
  band.append(flag, ua);

  const number = document.createElement("span");
  number.className = "turboLevVehiclePlateNumber";
  number.textContent = display;
  plate.append(band, number);
  return plate;
}

function enhancePlateTextNode(node: Text) {
  const parent = node.parentElement;
  if (!parent || parent.closest(SKIP_SELECTOR)) return;
  const text = node.nodeValue || "";
  PLATE_RE.lastIndex = 0;
  const matches = Array.from(text.matchAll(PLATE_RE)).filter((match) => {
    const start = match.index ?? -1;
    const end = start + match[0].length;
    return start >= 0 && isBoundary(text, start - 1) && isBoundary(text, end);
  });
  if (!matches.length) return;

  const fragment = document.createDocumentFragment();
  let cursor = 0;
  for (const match of matches) {
    const start = match.index ?? 0;
    if (start > cursor) fragment.append(document.createTextNode(text.slice(cursor, start)));
    fragment.append(plateMarkup(match[0]));
    cursor = start + match[0].length;
  }
  if (cursor < text.length) fragment.append(document.createTextNode(text.slice(cursor)));
  node.replaceWith(fragment);
}

function enhancePlates(root: ParentNode) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let current = walker.nextNode();
  while (current) {
    const text = current as Text;
    if (PLATE_RE.test(text.nodeValue || "")) nodes.push(text);
    PLATE_RE.lastIndex = 0;
    current = walker.nextNode();
  }
  nodes.forEach(enhancePlateTextNode);
}

function firstPlate(text: string) {
  PLATE_RE.lastIndex = 0;
  for (const match of text.matchAll(PLATE_RE)) {
    const start = match.index ?? -1;
    const end = start + match[0].length;
    if (start >= 0 && isBoundary(text, start - 1) && isBoundary(text, end)) return normalizeVehiclePlate(match[0]);
  }
  return "";
}

function fallbackBrand(title: string) {
  const normalized = title.trim();
  if (!normalized) return "AUTO";
  const upper = normalized.toUpperCase();
  if (upper.startsWith("MERCEDES BENZ") || upper.startsWith("MERCEDES-BENZ")) return "Mercedes-Benz";
  if (upper.startsWith("LAND ROVER")) return "Land Rover";
  if (upper.startsWith("RANGE ROVER")) return "Range Rover";
  if (upper.startsWith("ALFA ROMEO")) return "Alfa Romeo";
  return normalized.split(/\s+/)[0] || "AUTO";
}

async function loadVehicleIdentity(plate: string): Promise<VehicleIdentity | null> {
  const response = await fetch(`/api/vehicles/lookup?plate=${encodeURIComponent(plate)}`, {
    cache: "no-store",
    credentials: "include",
  });
  const body = await response.json().catch(() => null) as {
    status?: string;
    lookupLevel?: string;
    vehicle?: { id?: string | null; make?: string | null; model?: string | null; year?: number | null };
  } | null;
  if (!response.ok || body?.status !== "FOUND" || !body.vehicle?.id) return null;
  return {
    id: body.vehicle.id,
    brand: body.vehicle.make ?? null,
    model: body.vehicle.model ?? null,
    year: body.vehicle.year ?? null,
  };
}

function scanMechanicCards() {
  const cabinet = document.querySelector<HTMLElement>("[data-mechanic-cabinet='true']");
  if (!cabinet) return [] as MechanicTarget[];

  const icons = Array.from(cabinet.querySelectorAll<HTMLElement>("div")).filter((element) => {
    if (element.dataset.vehicleBrandHostOwner === "true") return false;
    return element.childElementCount === 0 && element.textContent?.trim() === "🚗";
  });

  const created: MechanicTarget[] = [];
  for (const icon of icons) {
    const article = icon.closest("article") as HTMLElement | null;
    if (!article || article.dataset.vehicleIdentityEnhanced === "true") continue;
    const title = article.querySelector("h2,h3")?.textContent?.trim() || "Автомобіль";
    const plate = firstPlate(article.textContent || "");
    if (!plate) continue;

    article.dataset.vehicleIdentityEnhanced = "true";
    article.classList.add("turboLevMechanicVehicleHero");
    icon.dataset.vehicleBrandHostOwner = "true";
    icon.classList.add("turboLevMechanicBrandSlot");
    icon.setAttribute("aria-label", `Логотип ${fallbackBrand(title)}`);

    const iconHost = document.createElement("span");
    iconHost.dataset.vehicleBrandHost = "true";
    icon.append(iconHost);

    const photoHost = document.createElement("span");
    photoHost.dataset.vehiclePhotoHost = "true";
    photoHost.setAttribute("aria-label", `Зображення ${title}`);
    article.append(photoHost);

    created.push({
      key: `${plate}:${Math.random().toString(36).slice(2)}`,
      plate,
      title,
      fallbackBrand: fallbackBrand(title),
      iconHost,
      photoHost,
    });
  }
  return created;
}

export function VehiclePresentationBridge() {
  const [targets, setTargets] = useState<MechanicTarget[]>([]);
  const [identities, setIdentities] = useState<Record<string, VehicleIdentity | null | undefined>>({});
  const requests = useRef(new Map<string, Promise<VehicleIdentity | null>>());

  useEffect(() => {
    let frame = 0;
    const scan = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        enhancePlates(document.body);
        const next = scanMechanicCards();
        setTargets((current) => {
          const connected = current.filter((item) => item.iconHost.isConnected && item.photoHost.isConnected);
          return next.length ? [...connected, ...next] : connected;
        });
      });
    };

    scan();
    const observer = new MutationObserver(scan);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    const plates = Array.from(new Set(targets.map((item) => item.plate)));
    for (const plate of plates) {
      if (Object.prototype.hasOwnProperty.call(identities, plate)) continue;
      let request = requests.current.get(plate);
      if (!request) {
        request = loadVehicleIdentity(plate).catch(() => null);
        requests.current.set(plate, request);
      }
      void request.then((identity) => {
        setIdentities((current) => Object.prototype.hasOwnProperty.call(current, plate)
          ? current
          : { ...current, [plate]: identity });
      });
    }
  }, [targets, identities]);

  return <>
    {targets.map((target) => {
      const identity = identities[target.plate];
      const brand = identity?.brand || target.fallbackBrand;
      return <span key={target.key}>
        {target.iconHost.isConnected ? createPortal(<VehicleBrandLogo brand={brand} size={42} />, target.iconHost) : null}
        {identity?.id && target.photoHost.isConnected ? createPortal(
          <VehicleRender
            id={identity.id}
            brand={identity.brand}
            model={identity.model}
            year={identity.year}
            size="hero"
            eager
            className="turboLevMechanicVehicleRender"
          />,
          target.photoHost,
        ) : null}
      </span>;
    })}
  </>;
}
