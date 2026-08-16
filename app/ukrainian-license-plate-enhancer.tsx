"use client";

import { useEffect } from "react";

const UKRAINIAN_PLATE_RE = /(?<![A-ZА-ЯІЇЄ0-9])([ABCEHIKMOPTXАВСЕНІКМОРТХ]{2})[\s-]*(\d{4})[\s-]*([ABCEHIKMOPTXАВСЕНІКМОРТХ]{2})(?![A-ZА-ЯІЇЄ0-9])/giu;
const CYRILLIC_TO_LATIN: Record<string, string> = {
  "А": "A",
  "В": "B",
  "С": "C",
  "Е": "E",
  "Н": "H",
  "І": "I",
  "К": "K",
  "М": "M",
  "О": "O",
  "Р": "P",
  "Т": "T",
  "Х": "X",
};

function normalizePlate(value: string) {
  return value
    .toUpperCase()
    .replace(/[\s-]+/g, "")
    .replace(/[АВСЕНІКМОРТХ]/g, (letter) => CYRILLIC_TO_LATIN[letter] ?? letter);
}

function shouldSkip(node: Text) {
  const parent = node.parentElement;
  if (!parent) return true;
  return Boolean(
    parent.closest(
      "input, textarea, select, option, script, style, code, pre, svg, [contenteditable='true'], [data-ua-license-plate], [data-ua-plate-skip]",
    ),
  );
}

function makePlate(raw: string) {
  const plate = normalizePlate(raw);
  const root = document.createElement("span");
  root.className = "uaLicensePlate";
  root.dataset.uaLicensePlate = plate;
  root.setAttribute("role", "text");
  root.setAttribute("aria-label", `Державний номер ${plate}`);

  const band = document.createElement("span");
  band.className = "uaLicensePlate__band";
  band.setAttribute("aria-hidden", "true");

  const flag = document.createElement("span");
  flag.className = "uaLicensePlate__flag";

  const ua = document.createElement("span");
  ua.className = "uaLicensePlate__country";
  ua.textContent = "UA";

  const number = document.createElement("span");
  number.className = "uaLicensePlate__number";
  number.textContent = plate;

  band.append(flag, ua);
  root.append(band, number);
  return root;
}

function decorateTextNode(node: Text) {
  if (shouldSkip(node)) return;
  const source = node.nodeValue ?? "";
  UKRAINIAN_PLATE_RE.lastIndex = 0;
  if (!UKRAINIAN_PLATE_RE.test(source)) return;

  UKRAINIAN_PLATE_RE.lastIndex = 0;
  const fragment = document.createDocumentFragment();
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = UKRAINIAN_PLATE_RE.exec(source))) {
    if (match.index > cursor) fragment.append(document.createTextNode(source.slice(cursor, match.index)));
    fragment.append(makePlate(match[0]));
    cursor = match.index + match[0].length;
  }
  if (cursor < source.length) fragment.append(document.createTextNode(source.slice(cursor)));
  node.parentNode?.replaceChild(fragment, node);
}

function decorateTree(root: Node) {
  if (root.nodeType === Node.TEXT_NODE) {
    decorateTextNode(root as Text);
    return;
  }
  if (!(root instanceof Element || root instanceof DocumentFragment || root instanceof Document)) return;
  if (root instanceof Element && root.closest("[data-ua-license-plate], [data-ua-plate-skip]")) return;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let current = walker.nextNode();
  while (current) {
    nodes.push(current as Text);
    current = walker.nextNode();
  }
  nodes.forEach(decorateTextNode);
}

export function UkrainianLicensePlateEnhancer() {
  useEffect(() => {
    decorateTree(document.body);

    const pending = new Set<Node>();
    let frame = 0;
    const flush = () => {
      frame = 0;
      const batch = Array.from(pending);
      pending.clear();
      batch.forEach(decorateTree);
    };
    const schedule = (node: Node) => {
      if (node instanceof Element && node.closest("[data-ua-license-plate]")) return;
      if (node.parentElement?.closest("[data-ua-license-plate]")) return;
      pending.add(node);
      if (!frame) frame = window.requestAnimationFrame(flush);
    };

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === "characterData") {
          schedule(mutation.target);
          continue;
        }
        mutation.addedNodes.forEach(schedule);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });

    return () => {
      observer.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
      pending.clear();
    };
  }, []);

  return null;
}
