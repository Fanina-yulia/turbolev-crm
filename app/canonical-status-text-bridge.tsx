"use client";

import { useEffect } from "react";

/**
 * Transitional UI compatibility layer for legacy screens that still render
 * technical/old labels directly. Business logic and filtering must use the
 * canonical lifecycle resolver; this bridge only prevents stale wording from
 * leaking into visible CRM text while those screens are gradually migrated.
 */
const exactStatusReplacements = new Map<string, string>([
  ["Автомобіль прибув", "В роботі"],
  ["Приїхав", "В роботі"],
  ["На діагностиці", "В роботі"],
  ["Передано менеджеру", "Завершена діагностика"],
  ["Діагностика завершена", "Завершена діагностика"],
  ["Опрацювання", "Підбір деталей"],
  ["Опрацювання робіт і деталей", "Підбір деталей"],
  ["Очікує підбору деталей", "Підбір деталей"],
  ["Очікують деталі", "Очікує деталі"],
  ["Очікує запчастини", "Очікує деталі"],
  ["Готово до ремонту", "Готовий до ремонту"],
  ["Очікує контроль якості", "Контроль якості"],
  ["До видачі", "Готовий до видачі"],
  ["Закриті", "Видано"],
  ["Закритий / виданий", "Видано"],
]);

function rewriteTextNode(node: Text) {
  const current = node.nodeValue || "";
  const trimmed = current.trim();
  if (!trimmed) return;
  const replacement = exactStatusReplacements.get(trimmed);
  if (!replacement) return;
  const leading = current.match(/^\s*/)?.[0] || "";
  const trailing = current.match(/\s*$/)?.[0] || "";
  node.nodeValue = `${leading}${replacement}${trailing}`;
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

export function CanonicalStatusTextBridge() {
  useEffect(() => {
    rewrite(document.body);
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        mutation.addedNodes.forEach(rewrite);
        if (mutation.type === "characterData") rewrite(mutation.target);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, []);
  return null;
}
