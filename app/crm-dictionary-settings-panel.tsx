"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CrmPageHeader } from "./crm-page-header";
import styles from "./settings-operations-page.module.css";

type EntryType = "PART" | "SERVICE" | "SYMPTOM" | "PROCESS";
type DictionaryEntry = {
  id: string;
  type: EntryType;
  category: string;
  canonicalName: string;
  canonicalCode?: string;
  aliases: string[];
  notes?: string;
  requiresFitmentCheck?: boolean;
};
type Dictionary = { version: 1; updatedBy: string; entries: DictionaryEntry[] };
type UnknownTerm = { rawTerm: string; normalizedTerm: string; count: number; source: string; firstSeenAt: string; lastSeenAt: string };
type OperationsResponse = { ok: boolean; settings: Record<string, unknown>; error?: string };

const TYPE_LABELS: Record<EntryType, string> = {
  PART: "Деталі",
  SERVICE: "Послуги",
  SYMPTOM: "Симптоми",
  PROCESS: "CRM-процеси",
};

function isEntry(value: unknown): value is DictionaryEntry {
  return Boolean(value && typeof value === "object"
    && typeof (value as DictionaryEntry).id === "string"
    && typeof (value as DictionaryEntry).canonicalName === "string"
    && Array.isArray((value as DictionaryEntry).aliases));
}

function normalizeDictionary(value: unknown): Dictionary {
  const source = value && typeof value === "object" ? value as Partial<Dictionary> : {};
  return {
    version: 1,
    updatedBy: typeof source.updatedBy === "string" ? source.updatedBy : "CRM",
    entries: Array.isArray(source.entries) ? source.entries.filter(isEntry) : [],
  };
}

function normalizeTerm(value: string) {
  return value
    .trim()
    .toLocaleLowerCase("uk-UA")
    .replace(/[ё]/gu, "е")
    .replace(/[’'`]/gu, "")
    .replace(/[_-]+/g, " ")
    .replace(/[^a-zа-яіїєґ0-9]+/giu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function matches(entry: DictionaryEntry, query: string) {
  const normalizedQuery = normalizeTerm(query);
  if (!normalizedQuery) return true;
  const source = [entry.canonicalName, entry.canonicalCode || "", entry.category, ...entry.aliases].map(normalizeTerm).join(" ");
  return source.includes(normalizedQuery);
}

export function CrmDictionarySettingsPanel() {
  const [dictionary, setDictionary] = useState<Dictionary | null>(null);
  const [unknownTerms, setUnknownTerms] = useState<UnknownTerm[]>([]);
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    setMessage("");
    const response = await fetch("/api/settings/operations", { cache: "no-store" });
    const body = await response.json() as OperationsResponse;
    if (!response.ok || !body.ok) throw new Error(body.error || "Не вдалося завантажити словник");
    setDictionary(normalizeDictionary(body.settings.crm_dictionary));
    const queue = body.settings.crm_dictionary_unknown_terms;
    const terms = queue && typeof queue === "object" && Array.isArray((queue as { terms?: unknown }).terms)
      ? (queue as { terms: unknown[] }).terms.filter((term): term is UnknownTerm => Boolean(term && typeof term === "object" && typeof (term as UnknownTerm).rawTerm === "string"))
      : [];
    setUnknownTerms(terms);
  }, []);

  useEffect(() => { void load().catch((error) => setMessage(error instanceof Error ? error.message : "Помилка завантаження")); }, [load]);

  const entries = dictionary?.entries || [];
  const filtered = useMemo(() => entries.filter((entry) => matches(entry, query)), [entries, query]);
  const grouped = useMemo(() => {
    const map = new Map<string, DictionaryEntry[]>();
    for (const entry of filtered) {
      const key = `${TYPE_LABELS[entry.type] || entry.type} · ${entry.category}`;
      map.set(key, [...(map.get(key) || []), entry]);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b, "uk"));
  }, [filtered]);

  return <div className={styles.page} data-settings-tab="crmDictionary">
    <CrmPageHeader eyebrow="TURBO LEV · НАЛАШТУВАННЯ · СЛОВНИК" title="Словник CRM" description="Тотожні назви, російські/українські варіанти, помилки введення, симптоми та CRM-скорочення."/>
    {message ? <div className={styles.message}>{message}</div> : null}
    <div className={styles.formBox}>
      <div className={styles.formGrid}>
        <label><span>Перевірити слово або фразу</span><input value={query} placeholder="Наприклад: рычаг, рьічаг, торможа, накінечник" onChange={(event) => setQuery(event.target.value)}/></label>
      </div>
    </div>
    {unknownTerms.length > 0 && <section>
      <h2 className={styles.sectionTitle}>Черга невідомих термінів</h2>
      <div className={styles.cards}>{unknownTerms.slice(0, 20).map((term) => <article className={styles.card} key={term.normalizedTerm}>
        <div className={styles.cardHead}>
          <div><strong>{term.rawTerm}</strong><small>Нормалізовано: {term.normalizedTerm} · джерело: {term.source}</small></div>
          <span className={styles.badge}>{term.count}×</span>
        </div>
        <small>Перший раз: {new Date(term.firstSeenAt).toLocaleString("uk-UA")} · останній раз: {new Date(term.lastSeenAt).toLocaleString("uk-UA")}</small>
      </article>)}</div>
    </section>}
    {grouped.length ? grouped.map(([title, items]) => <section key={title}>
      <h2 className={styles.sectionTitle}>{title}</h2>
      <div className={styles.cards}>{items.map((entry) => <article className={styles.card} key={entry.id}>
        <div className={styles.cardHead}>
          <div><strong>{entry.canonicalName}</strong><small>{entry.canonicalCode || entry.type} · {entry.requiresFitmentCheck ? "потрібна перевірка сумісності" : "можна використовувати як словник назв"}</small></div>
          <span className={styles.badge}>{TYPE_LABELS[entry.type]}</span>
        </div>
        <small>{entry.aliases.join(", ")}</small>
        {entry.notes ? <small>{entry.notes}</small> : null}
      </article>)}</div>
    </section>) : <div className={styles.empty}>Нічого не знайдено за цим запитом.</div>}
  </div>;
}
