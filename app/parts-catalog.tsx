"use client";

import { useState } from "react";
import styles from "./parts-catalog.module.css";

type Part = { name?: string; slug?: string; category?: string; description?: string };

export function PartsCatalog() {
  const [q, setQ] = useState("");
  const [parts, setParts] = useState<Part[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("Пошук по безкоштовному довідковому каталогу деталей.");

  async function search() {
    const query = q.trim();
    if (query.length < 2) return setMessage("Введіть щонайменше 2 символи.");
    setBusy(true);
    try {
      const response = await fetch(`/api/parts/free-catalog?q=${encodeURIComponent(query)}`, { cache: "no-store" });
      const data = await response.json();
      setParts(Array.isArray(data.parts) ? data.parts : []);
      setMessage(data.warning ?? "Готово.");
    } catch {
      setParts([]);
      setMessage("Каталог тимчасово недоступний.");
    } finally { setBusy(false); }
  }

  return <div className={styles.page}>
    <div className={styles.head}><div><p>TURBO LEV · PARTS</p><h1>Підбір запчастин</h1></div><span className={styles.badge}>FREE CATALOG · MIT</span></div>
    <section className={styles.panel}>
      <div className={styles.search}><input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && search()} placeholder="Напр.: амортизатор, колодки, bearing, filter…" /><button type="button" onClick={search} disabled={busy}>{busy ? "Шукаю…" : "Знайти"}</button></div>
      <div className={styles.note}>{message}</div>
      <div className={styles.note}><b>Важливо:</b> це безкоштовний довідковий аналог каталогу, а не TecDoc-рівень сумісності. Він не підтверджує OEM-кроси по VIN. Точну деталь менеджер має підтвердити каталогом виробника/постачальника.</div>
      {parts.length ? <div className={styles.grid}>{parts.map((part, index) => <article className={styles.card} key={`${part.slug ?? part.name}-${index}`}><b>{part.name ?? "Деталь"}</b>{part.category && <span>{part.category}</span>}{part.slug && <small>{part.slug}</small>}{part.description && <small>{part.description}</small>}</article>)}</div> : <div className={styles.empty}>Результати з’являться тут.</div>}
    </section>
  </div>;
}
