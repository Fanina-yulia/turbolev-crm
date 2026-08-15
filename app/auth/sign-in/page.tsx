import { SignInForm } from "./sign-in-form";
import styles from "./sign-in.module.css";

export const dynamic = "force-dynamic";

export default function SignInPage() {
  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <div className={styles.brand}>TURBO LEV</div>
        <p className={styles.eyebrow}>ЗАХИЩЕНИЙ ДОСТУП ДО CRM</p>
        <h1>Вхід до системи</h1>
        <p className={styles.lead}>Увійдіть робочим обліковим записом. Доступ до модулів визначається вашими ролями та повноваженнями Turbo LEV.</p>
        <SignInForm />
      </section>
    </main>
  );
}
