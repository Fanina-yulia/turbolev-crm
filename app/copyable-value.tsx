"use client";

import { useState } from "react";

type CopyableValueProps = {
  value: string;
  label?: string;
  className?: string;
};

export function CopyableValue({ value, label, className = "" }: CopyableValueProps) {
  const [copied, setCopied] = useState(false);
  const text = value.trim();
  if (!text) return null;

  async function copyValue() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  }

  return (
    <button
      type="button"
      className={className}
      onClick={() => void copyValue()}
      title={copied ? "Скопійовано" : `Скопіювати ${label || "значення"}`}
      aria-label={copied ? `${label || "Значення"} скопійовано` : `Скопіювати ${label || "значення"}`}
      style={{ cursor: "copy", border: 0, padding: 0, background: "transparent", font: "inherit", color: "inherit", textAlign: "inherit" }}
    >
      {copied ? "Скопійовано" : value}
    </button>
  );
}
