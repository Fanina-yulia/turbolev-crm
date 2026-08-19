"use client";

import { useEffect, useState } from "react";
import styles from "./integrations-settings-hub.module.css";

type MetaAccount = {
  pageId: string;
  pageName: string;
  instagramAccountId: string | null;
  instagramAccountName: string | null;
};

export function MetaAccountPicker({ currentPageId, onChanged }: { currentPageId?: string; onChanged?: () => void | Promise<void> }) {
  const [accounts, setAccounts] = useState<MetaAccount[]>([]);
  const [selected, setSelected] = useState(currentPageId || "");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true); setMessage("");
      try {
        const response = await fetch("/api/settings/integrations/meta/accounts", { cache: "no-store" });
        const payload = await response.json() as { ok?: boolean; accounts?: MetaAccount[]; error?: string };
        if (!response.ok || !payload.ok) throw new Error(payload.error || "Не вдалося отримати Facebook Pages");
        if (cancelled) return;
        const next = payload.accounts || [];
        setAccounts(next);
        setSelected((value) => value || currentPageId || next[0]?.pageId || "");
      } catch (error) {
        if (!cancelled) setMessage(error instanceof Error ? error.message : "Не вдалося отримати Facebook Pages");
      } finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [currentPageId]);

  async function apply() {
    if (!selected) return;
    setSaving(true); setMessage("");
    try {
      const response = await fetch("/api/settings/integrations/meta/accounts", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pageId: selected }),
      });
      const payload = await response.json() as { ok?: boolean; selected?: { pageName?: string; subscriptionWarning?: string }; error?: string };
      if (!response.ok || !payload.ok) throw new Error(payload.error || "Не вдалося застосувати Facebook Page");
      setMessage(payload.selected?.subscriptionWarning ? `Сторінку вибрано. Webhook: ${payload.selected.subscriptionWarning}` : `Сторінку ${payload.selected?.pageName || "Meta"} вибрано.`);
      await onChanged?.();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Не вдалося застосувати Facebook Page"); }
    finally { setSaving(false); }
  }

  if (loading) return <div className={styles.accountPickerHint}>Завантажуємо доступні Facebook Pages…</div>;
  if (!accounts.length) return <div className={styles.accountPickerHint}>{message || "Для авторизованого Meta акаунта не знайдено доступних Facebook Pages."}</div>;

  return <div className={styles.accountPicker}>
    <label><span>Facebook Page / Instagram</span><select value={selected} onChange={(event) => setSelected(event.target.value)}>
      {accounts.map((account) => <option key={account.pageId} value={account.pageId}>{account.pageName}{account.instagramAccountName ? ` · @${account.instagramAccountName}` : ""}</option>)}
    </select></label>
    <button type="button" className={styles.secondary} disabled={saving || !selected || selected === currentPageId} onClick={() => void apply()}>{saving ? "Зберігаємо…" : "Використовувати"}</button>
    {message ? <small>{message}</small> : null}
  </div>;
}
