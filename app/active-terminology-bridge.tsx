"use client";

import { useEffect } from "react";

const exactReplacements = new Map<string, string>([
  ["Лід створено", "Додано в Активні"],
  ["+ Лід", "В роботу"],
  ["Лід", "Відкрити в Активних"],
  ["Створити лід із цього звернення", "Додати в Активні"],
  ["Відкрити лід", "Відкрити в Активних"],
  ["Для створення ліда потрібне серверне з'єднання", "Для передачі в Активні потрібне серверне з'єднання"],
  ["Звернення прив'язано до існуючого ліда", "Звернення прив'язано до наявного запису в Активних"],
  ["Не вдалося створити лід", "Не вдалося додати в Активні"],
]);

function inScope(node: Node) {
  const element = node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement;
  return Boolean(element?.closest(".msgPage, .clientDrawer"));
}

function rewriteTextNode(node: Text) {
  if (!inScope(node)) return;
  const current = node.nodeValue || "";
  const trimmed = current.trim();
  if (!trimmed) return;

  const exact = exactReplacements.get(trimmed);
  if (exact) {
    const leading = current.match(/^\s*/)?.[0] || "";
    const trailing = current.match(/\s*$/)?.[0] || "";
    node.nodeValue = `${leading}${exact}${trailing}`;
    return;
  }

  if (/^Лід\s+/.test(trimmed)) {
    const leading = current.match(/^\s*/)?.[0] || "";
    const trailing = current.match(/\s*$/)?.[0] || "";
    node.nodeValue = `${leading}${trimmed.replace(/^Лід\s+/, "Активні · ")}${trailing}`;
  }
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
      if (!button || !button.closest(".msgPage, .clientDrawer")) return;
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
