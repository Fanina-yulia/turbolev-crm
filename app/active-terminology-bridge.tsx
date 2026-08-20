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

const globalExactReplacements = new Map<string, string>([
  ["Ліди → запис", "Активні → запис"],
  ["Ліди", "Активні"],
  ["Ліди / потенційні клієнти", "Активні"],
  ["Конвертовано в Lead", "Додано в Активні"],
  ["Прив'язано до існуючого Lead", "Прив'язано до запису в Активних"],
]);

function inLegacyScope(node: Node) {
  const element = node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement;
  return Boolean(element?.closest(".msgPage, .clientDrawer"));
}

function preserveWhitespace(current: string, replacement: string) {
  const leading = current.match(/^\s*/)?.[0] || "";
  const trailing = current.match(/\s*$/)?.[0] || "";
  return `${leading}${replacement}${trailing}`;
}

function rewriteTextNode(node: Text) {
  const current = node.nodeValue || "";
  const trimmed = current.trim();
  if (!trimmed) return;

  const globalExact = globalExactReplacements.get(trimmed);
  if (globalExact) {
    node.nodeValue = preserveWhitespace(current, globalExact);
    return;
  }

  // Analytics and explanatory copy can contain the old internal domain noun
  // inside a longer sentence. Keep the technical field/API names unchanged,
  // but never expose that noun to CRM users.
  if (/\bліда\b/i.test(trimmed)) {
    node.nodeValue = current.replace(/\bліда\b/gi, "активного запису");
    return;
  }
  if (/\bлідів\b/i.test(trimmed)) {
    node.nodeValue = current.replace(/\bлідів\b/gi, "активних записів");
    return;
  }

  if (!inLegacyScope(node)) return;
  const exact = exactReplacements.get(trimmed);
  if (exact) {
    node.nodeValue = preserveWhitespace(current, exact);
    return;
  }

  if (/^Лід\s+/.test(trimmed)) {
    node.nodeValue = preserveWhitespace(current, trimmed.replace(/^Лід\s+/, "Активні · "));
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
