"use client";

import { useEffect } from "react";
import styles from "./system-feedback.module.css";

const PLANNER_RECOVERY_KEY = "turbolev:planner-error-recovery";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    const url = new URL(window.location.href);
    const message = String(error?.message ?? "");
    const isPlannerChunkFailure = url.searchParams.get("section") === "planner"
      && /ChunkLoadError|Loading chunk|dynamically imported module|Failed to fetch|module script/i.test(message);

    if (!isPlannerChunkFailure || window.sessionStorage.getItem(PLANNER_RECOVERY_KEY)) return;

    window.sessionStorage.setItem(PLANNER_RECOVERY_KEY, "1");
    window.location.reload();
  }, [error]);

  const retry = () => {
    if (new URL(window.location.href).searchParams.get("section") === "planner") {
      window.sessionStorage.setItem(PLANNER_RECOVERY_KEY, "1");
      window.location.reload();
      return;
    }
    reset();
  };

  return <main className={styles.screen} role="main">
    <section className={styles.card} role="alert" aria-live="assertive">
      <p className={styles.eyebrow}>TURBO LEV OS</p>
      <h1 className={styles.title}>Не вдалося відкрити розділ</h1>
      <p className={styles.copy}>CRM зберегла поточну сторінку. Спробуйте повторити дію; якщо збій повториться, передайте код помилки адміністратору.</p>
      <div className={styles.actions}>
        <button type="button" className={styles.primary} onClick={retry}>Спробувати ще раз</button>
        <button type="button" className={styles.secondary} onClick={() => window.location.assign("/")}>На огляд станції</button>
      </div>
      {error.digest ? <p className={styles.digest}>Код: {error.digest}</p> : null}
    </section>
  </main>;
}
