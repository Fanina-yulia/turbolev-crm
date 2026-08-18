"use client";

import styles from "./system-feedback.module.css";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main className={styles.screen} role="main">
    <section className={styles.card} role="alert" aria-live="assertive">
      <p className={styles.eyebrow}>TURBO LEV OS</p>
      <h1 className={styles.title}>Не вдалося відкрити розділ</h1>
      <p className={styles.copy}>CRM зберегла поточну сторінку. Спробуйте повторити дію; якщо збій повториться, передайте код помилки адміністратору.</p>
      <div className={styles.actions}>
        <button type="button" className={styles.primary} onClick={reset}>Спробувати ще раз</button>
        <button type="button" className={styles.secondary} onClick={() => window.location.assign("/")}>На огляд станції</button>
      </div>
      {error.digest ? <p className={styles.digest}>Код: {error.digest}</p> : null}
    </section>
  </main>;
}
