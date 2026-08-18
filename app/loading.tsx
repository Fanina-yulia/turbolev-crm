import styles from "./system-feedback.module.css";

export default function Loading() {
  return <main className={styles.screen} role="status" aria-live="polite" aria-label="Завантаження CRM">
    <section className={styles.loadingCard}>
      <div className={styles.loadingTitle}/>
      <div className={styles.loadingGrid}>
        <div className={styles.loadingBlock}/>
        <div className={styles.loadingBlock}/>
        <div className={styles.loadingBlock}/>
      </div>
      <span className={styles.srOnly}>Завантаження Turbo LEV OS…</span>
    </section>
  </main>;
}
