"use client";

import { useEffect } from "react";

const exactReplacements = new Map<string, string>([
  ["Ліди", "Активні"],
  ["Лід", "Активні"],
  ["Лід створено", "Додано в Активні"],
  ["+ Лід", "В роботу"],
  ["Створити лід", "Додати в Активні"],
  ["Створити лід із цього звернення", "Додати в Активні"],
  ["Відкрити лід", "Відкрити в Активних"],
  ["Є активний лід", "Є в Активних"],
  ["живі ліди Neon", "активні заявки"],
  ["Ліди → запис", "Активні → запис"],
  ["Особиста черга дій із лідів, звернень та сервісних процесів.", "Особиста черга дій з Активних, звернень та сервісних процесів."],
  ["Для створення ліда потрібне серверне з'єднання", "Для передачі в Активні потрібне серверне з'єднання"],
  ["Звернення прив'язано до існуючого ліда", "Звернення прив'язано до наявного запису в Активних"],
  ["Не вдалося створити лід", "Не вдалося додати в Активні"],
  ["Передано менеджеру", "Завершена діагностика"],
  ["Повернено на уточнення", "Повернено механіку"],
  ["CARD_SENT", "Надіслана ДК"],
]);

function isUiTextNode(node: Node) {
  const element = node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement;
  if (!element) return false;
  return !element.closest("script, style, noscript, textarea, code, pre");
}

function inLegacyNavigationScope(node: Node) {
  const element = node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement;
  return Boolean(element?.closest(".msgPage, .clientDrawer"));
}

function isMechanicCabinet() {
  const text = document.body?.textContent || "";
  return text.includes("Кабінет механіка") || text.includes("Мої діагностики");
}

function preserveWhitespace(current: string, replacement: string) {
  const leading = current.match(/^\s*/)?.[0] || "";
  const trailing = current.match(/\s*$/)?.[0] || "";
  return `${leading}${replacement}${trailing}`;
}

function rewriteLegacyLeadWords(value: string) {
  return value
    .replaceAll("Лідів", "Активних")
    .replaceAll("лідів", "активних")
    .replaceAll("Лідом", "записом в Активних")
    .replaceAll("лідом", "записом в Активних")
    .replaceAll("Ліда", "запису в Активних")
    .replaceAll("ліда", "запису в Активних")
    .replaceAll("Ліди", "Активні")
    .replaceAll("ліди", "Активні")
    .replaceAll("Лід", "Активні")
    .replaceAll("лід", "активна заявка");
}

function rewriteTextNode(node: Text) {
  if (!isUiTextNode(node)) return;
  const current = node.nodeValue || "";
  const trimmed = current.trim();
  if (!trimmed) return;

  const exact = exactReplacements.get(trimmed);
  if (exact) {
    node.nodeValue = preserveWhitespace(current, exact);
    return;
  }

  if (trimmed === "Підтверджено" && isMechanicCabinet()) {
    node.nodeValue = preserveWhitespace(current, "ДК сформована");
    return;
  }

  if (/^Є активний лід(?:\s|·|$)/.test(trimmed)) {
    node.nodeValue = preserveWhitespace(current, trimmed.replace(/^Є активний лід/, "Є в Активних"));
    return;
  }

  if (/^Лід\s+/.test(trimmed)) {
    node.nodeValue = preserveWhitespace(current, trimmed.replace(/^Лід\s+/, "Активні · "));
    return;
  }

  const rewritten = rewriteLegacyLeadWords(trimmed);
  if (rewritten !== trimmed) node.nodeValue = preserveWhitespace(current, rewritten);
}

function rewrite(root: Node) {
  if (root.nodeType === Node.TEXT_NODE) {
    rewriteTextNode(root as Text);
    return;
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    rewriteTextNode(node as Text);
    node = walker.nextNode();
  }
}

export function ActiveTerminologyBridge() {
  useEffect(() => {
    rewrite(document.body);

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        mutation.addedNodes.forEach(rewrite);
        if (mutation.type === "characterData") rewrite(mutation.target);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });

    const handleLegacyActiveNavigation = (event: MouseEvent) => {
      const target = event.target as Element | null;
      const button = target?.closest("button");
      if (!button || !inLegacyNavigationScope(button)) return;
      if (button.textContent?.trim() !== "Відкрити в Активних") return;

      event.preventDefault();
      event.stopPropagation();
      window.dispatchEvent(new CustomEvent("turbolev:navigate", { detail: "Активні" }));
    };

    document.addEventListener("click", handleLegacyActiveNavigation, true);
    return () => {
      observer.disconnect();
      document.removeEventListener("click", handleLegacyActiveNavigation, true);
    };
  }, []);

  return null;
}
