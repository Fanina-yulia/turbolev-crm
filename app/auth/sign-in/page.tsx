import { redirect } from "next/navigation";
import { getAccessContext } from "@/src/security/access-context";
import { SignInForm } from "./sign-in-form";
import styles from "./sign-in.module.css";

export const dynamic = "force-dynamic";

type SignInPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function safeNextPath(value: string | string[] | undefined) {
  const selected = Array.isArray(value) ? value[0] : value;
  if (!selected || !selected.startsWith("/") || selected.startsWith("//")) return "/";
  return selected;
}

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const params = await searchParams;
  const nextPath = safeNextPath(params.next);
  const access = await getAccessContext();

  if (access.provisioningState === "ACTIVE") redirect(nextPath);

  return (
    <main className={styles.page} data-crm-surface="public">
      <section className={styles.card}>
        <header className={styles.header}>
          <img className={styles.brandMark} data-crm-logo-slot="public" data-crm-default-src="/brand/turbolev-logo.png" src="/brand/turbolev-logo.png" alt="Turbo LEV" />
          <div>
            <div className={styles.brand}>TURBO LEV</div>
            <p className={styles.eyebrow}>СИСТЕМА УПРАВЛІННЯ СТО</p>
          </div>
        </header>
        <div className={styles.intro}>
          <h1>Вхід до кабінету</h1>
          <p className={styles.lead}>Увійдіть під своїм робочим обліковим записом.</p>
        </div>
        <SignInForm />
        <footer className={styles.footer}>Захищений доступ · Turbo LEV CRM</footer>
      </section>
    </main>
  );
}
