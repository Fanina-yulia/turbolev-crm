"use client";

import { useEffect } from "react";

const DIAGNOSTIC_PDF_FRAME_SELECTOR = 'iframe[src*="/api/diagnostics/"][src*="/pdf"]';

function fitDiagnosticPdfFrame(frame: HTMLIFrameElement) {
  const source = frame.getAttribute("src");
  if (!source || !source.includes("/api/diagnostics/") || !source.includes("/pdf")) return;

  try {
    const url = new URL(source, window.location.origin);
    const params = new URLSearchParams(url.hash.startsWith("#") ? url.hash.slice(1) : url.hash);

    if (params.get("page") === "1" && params.get("view") === "Fit" && !params.has("zoom")) return;

    params.set("page", "1");
    params.set("view", "Fit");
    params.delete("zoom");
    url.hash = params.toString();

    const nextSource = `${url.pathname}${url.search}${url.hash}`;
    if (nextSource !== source) frame.setAttribute("src", nextSource);
  } catch {
    // Leave an unexpected/non-URL source untouched.
  }
}

function scanAddedNode(node: Node) {
  if (node instanceof HTMLIFrameElement) {
    fitDiagnosticPdfFrame(node);
    return;
  }
  if (!(node instanceof Element)) return;
  node.querySelectorAll<HTMLIFrameElement>(DIAGNOSTIC_PDF_FRAME_SELECTOR).forEach(fitDiagnosticPdfFrame);
}

/**
 * Keeps every diagnostic-card PDF preview in "Fit page" mode on a fresh open.
 * We observe child insertion only (not attributes), so rewriting iframe.src is idempotent
 * and cannot create a MutationObserver loop.
 */
export function DiagnosticPdfFitPageBridge() {
  useEffect(() => {
    document.querySelectorAll<HTMLIFrameElement>(DIAGNOSTIC_PDF_FRAME_SELECTOR).forEach(fitDiagnosticPdfFrame);

    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) scanAddedNode(node);
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  return null;
}
