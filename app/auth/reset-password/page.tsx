import { ResetPasswordForm } from "./reset-password-form";
import styles from "../sign-in/sign-in.module.css";

export const dynamic = "force-dynamic";

export default function ResetPasswordPage() {
  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <div className={styles.brand}>TURBO LEV</div>
        <p className={styles.eyebrow}>ЗАХИЩЕНИЙ ДОСТУП ДО CRM</p>
        <h1>Встановити пароль</h1>
        <p className={styles.lead}>Задайте пароль для входу через email. Роль і права власника в Turbo LEV CRM не змінюються.</p>
        <ResetPasswordForm />
      </section>
    </main>
  );
}
