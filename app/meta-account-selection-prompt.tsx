"use client";

import { useEffect, useState } from "react";
import { MetaAccountPicker } from "./meta-account-picker";
import styles from "./meta-account-selection-prompt.module.css";

export function MetaAccountSelectionPrompt() {
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    setOpen(query.get("integration")?.toLowerCase() === "meta" && query.get("integrationStatus") === "connected");
  }, []);

  function close() {
    setOpen(false);
    const url = new URL(window.location.href);
    url.searchParams.delete("integrationStatus");
    url.searchParams.delete("integrationMessage");
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  }

  if (!open) return null;
  return <div className={styles.backdrop} role="presentation">
    <div className={styles.modal} role="dialog" aria-modal="true" aria-label="Вибір Meta сторінки">
      <div className={styles.head}><div><span>META</span><h2>Оберіть робочу Facebook Page</h2></div><button type="button" onClick={close}>×</button></div>
      <p>Якщо у Meta-акаунті декілька сторінок, виберіть ту, з якої CRM повинна отримувати Messenger, Instagram та Lead Ads. Пов’язаний Instagram акаунт визначається автоматично.</p>
      <MetaAccountPicker onChanged={async () => { setSaved(true); }} />
      <div className={styles.footer}><button type="button" onClick={close}>{saved ? "Готово" : "Залишити поточну"}</button></div>
    </div>
  </div>;
}
