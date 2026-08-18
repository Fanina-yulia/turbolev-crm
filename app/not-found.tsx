import Link from "next/link";
import styles from "./system-feedback.module.css";

export default function NotFound() {
  return <main className={styles.screen}>
    <section className={styles.card}>
      <p className={styles.eyebrow}>TURBO LEV OS · 404</p>
      <h1 className={styles.title}>Сторінку не знайдено</h1>
      <p className={styles.copy}>Посилання застаріло, було змінено або такого розділу CRM не існує.</p>
      <div className={styles.actions}>
        <Link className={styles.primary} href="/">На огляд станції</Link>
      </div>
    </section>
  </main>;
}
