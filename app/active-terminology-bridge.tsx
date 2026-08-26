"use client";

import { useEffect } from "react";

const exactReplacements = new Map<string, string>([
  ["Активні", "Звернення"],
  ["Ліди", "Звернення"],
  ["Лід", "Звернення"],
  ["Лід створено", "Звернення створено"],
  ["+ Лід", "В роботу"],
  ["Створити лід", "Створити звернення"],
  ["Створити лід із цього звернення", "Додати звернення в роботу"],
  ["Відкрити лід", "Відкрити звернення"],
  ["Відкрити в Активних", "Відкрити звернення"],
  ["Є активний лід", "Є звернення"],
  ["Є в Активних", "Є звернення"],
  ["живі ліди Neon", "звернення Neon"],
  ["Ліди → запис", "Звернення → запис"],
  ["Активні → запис", "Звернення → запис"],
  ["Особиста черга дій із лідів, звернень та сервісних процесів.", "Особиста черга дій зі звернень та сервісних процесів."],
  ["Особиста черга дій з Активних, звернень та сервісних процесів.", "Особиста черга дій зі звернень та сервісних процесів."],
  ["Для створення ліда потрібне серверне з'єднання", "Для створення звернення потрібне серверне з'єднання"],
  ["Для передачі в Активні потрібне серверне з'єднання", "Для передачі звернення в роботу потрібне серверне з'єднання"],
  ["Для додавання в Активні потрібне серверне з'єднання", "Для передачі звернення в роботу потрібне серверне з'єднання"],
  ["Звернення прив'язано до існуючого ліда", "Звернення прив'язано до наявного звернення"],
  ["Звернення прив'язано до наявного запису в Активних", "Звернення прив'язано до наявного звернення"],
  ["Контакт уже є в Активних", "Контакт уже передано в роботу"],
  ["Контакт додано в Активні", "Контакт передано в роботу"],
  ["Не вдалося створити лід", "Не вдалося створити звернення"],
  ["Не вдалося додати в Активні", "Не вдалося передати звернення в роботу"],
  ["Не вдалося додати контакт в Активні", "Не вдалося передати контакт у роботу"],
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
    .replaceAll("Лідів", "Звернень")
    .replaceAll("лідів", "звернень")
    .replaceAll("Лідом", "зверненням")
    .replaceAll("лідом", "зверненням")
    .replaceAll("Ліда", "звернення")
    .replaceAll("ліда", "звернення")
    .replaceAll("Ліди", "Звернення")
    .replaceAll("ліди", "звернення")
    .replaceAll("Лід", "Звернення")
    .replaceAll("лід", "звернення");
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
    node.nodeValue = preserveWhitespace(current, trimmed.replace(/^Є активний лід/, "Є звернення"));
    return;
  }

  if (/^Лід\s+/.test(trimmed)) {
    node.nodeValue = preserveWhitespace(current, trimmed.replace(/^Лід\s+/, "Звернення · "));
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
      if (button.textContent?.trim() !== "Відкрити звернення") return;

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
