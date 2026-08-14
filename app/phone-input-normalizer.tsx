"use client";

import { useEffect } from "react";

function formatUkrainianPhoneInput(value: string) {
  let digits = value.replace(/\D/g, "");
  if (!digits) return "";

  let national = "";

  if (digits.startsWith("380")) {
    national = digits.slice(3);
  } else if (digits.startsWith("0")) {
    national = digits.slice(1);
  } else if (digits.length <= 9) {
    national = digits;
  } else if (digits.startsWith("38")) {
    national = digits.slice(2).replace(/^0/, "");
  } else {
    national = digits.slice(-9);
  }

  national = national.slice(0, 9);

  const operator = national.slice(0, 2);
  const first = national.slice(2, 5);
  const second = national.slice(5, 7);
  const third = national.slice(7, 9);

  return [
    "+380",
    operator,
    first,
    second,
    third,
  ].filter(Boolean).join(" ");
}

export function PhoneInputNormalizer() {
  useEffect(() => {
    function handleInput(event: Event) {
      const input = event.target;
      if (!(input instanceof HTMLInputElement)) return;
      if (input.inputMode !== "tel") return;

      const formatted = formatUkrainianPhoneInput(input.value);
      if (input.value !== formatted) input.value = formatted;
    }

    document.addEventListener("input", handleInput, true);
    return () => document.removeEventListener("input", handleInput, true);
  }, []);

  return null;
}
