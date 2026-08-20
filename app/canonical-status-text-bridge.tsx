"use client";

import { useEffect } from "react";

/**
 * Transitional UI compatibility layer for legacy screens that still render
 * technical/old labels directly. Business logic and filtering must use the
 * canonical lifecycle resolver; this bridge only prevents stale wording from
 * leaking into visible CRM status controls while those screens are migrated.
 */
const exactStatusReplacements = new Map<string, string>([
  ["Записаний", "Заплановано"],
  ["Автомобіль прибув", "В роботі"],
  ["Приїхав", "В роботі"],
  ["Передано менеджеру", "Завершена діагностика"],
  ["Діагностика завершена", "Завершена діагностика"],
  ["Опрацювання", "Підбір деталей"],
  ["Опрацювання робіт і деталей", "Підбір деталей"],
  ["Очікує підбору деталей", "Підбір деталей"],
  ["Калькуляція", "Очікує погодження"],
  ["Погодження", "Очікує погодження"],
  ["Очікують деталі", "Очікує деталі"],
  ["Очікує запчастини", "Очікує деталі"],
  ["Готово до ремонту", "Готовий до ремонту"],
  ["QC", "Контроль якості"],
  ["Очікує контроль якості", "Контроль якості"],
  ["До видачі", "Готовий до видачі"],
  ["Виданий", "Видано"],
  ["Закриті", "Видано"],
  ["Закритий / виданий", "Видано"],
  ["Скасований", "Скасовано"],
]);

const technicalOptionLabels = new Map<string, string>([
  ["BOOKED", "Заплановано"],
  ["ARRIVED", "В роботі"],
  ["DIAGNOSTICS", "В роботі"],
  ["WAITING_PARTS_SELECTION", "Підбір деталей"],
  ["WAITING_CALCULATION", "Очікує погодження"],
  ["WAITING_APPROVAL", "Очікує погодження"],
  ["WAITING_PARTS", "Очікує деталі"],
  ["READY_FOR_REPAIR", "Готовий до ремонту"],
  ["IN_REPAIR", "У ремонті"],
  ["WAITING_QC", "Контроль якості"],
  ["WAITING_PAYMENT", "Очікує оплату"],
  ["READY_FOR_PICKUP", "Готовий до видачі"],
  ["COMPLETED", "Видано"],
  ["CLOSED", "Видано"],
  ["CANCELLED", "Скасовано"],
]);

function statusScoped(node: Text) {
  const element = node.parentElement;
  if (!element) return false;
  return Boolean(element.closest([
    '[class*="status"]', '[class*="Status"]',
    '[class*="pill"]', '[class*="Pill"]',
    '[class*="badge"]', '[class*="Badge"]',
    '[class*="filter"]', '[class*="Filter"]',
  ].join(",")));
}

function rewriteOption(option: HTMLOptionElement) {
  const label = technicalOptionLabels.get(option.value);
  if (label && option.textContent !== label) option.textContent = label;
}

function rewriteTextNode(node: Text) {
  const current = node.nodeValue || "";
  const trimmed = current.trim();
  if (!trimmed || !statusScoped(node)) return;
  const replacement = exactStatusReplacements.get(trimmed);
  if (!replacement) return;
  const leading = current.match(/^\s*/)?.[0] || "";
  const trailing = current.match(/\s*$/)?.[0] || "";
  node.nodeValue = `${leading}${replacement}${trailing}`;
}

function rewrite(root: Node) {
  if (root instanceof HTMLOptionElement) rewriteOption(root);
  if (root.nodeType === Node.TEXT_NODE) {
    rewriteTextNode(root as Text);
    return;
  }
  if (root instanceof Element) root.querySelectorAll("option").forEach((option) => rewriteOption(option as HTMLOptionElement));
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
