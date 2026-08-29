import type { Metadata } from "next";
import Link from "next/link";
import { ActivateClientPortal } from "./activate-client-portal";
import styles from "./access.module.css";
import { previewClientPortalAccess, ClientPortalSessionError } from "@/src/services/client-portal-session.service";
import { DiagnosticReportError } from "@/src/services/diagnostic-report.service";
import { VehiclePlate } from "../../../vehicle-plate";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Доступ до кабінету · Turbo LEV",
  description: "Захищений доступ до особистого кабінету власника авто Turbo LEV",
  robots: { index: false, follow: false, nocache: true },
};

export default async function ClientPortalAccessPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  try {
    const preview = await previewClientPortalAccess(token);
    return <main className={styles.page}>
      <section className={styles.card}>
        <header className={styles.brand}>
          <div className={styles.logo}>TL</div>
          <div><strong>ТУРБО <b>ЛЕВ</b></strong><span>Особистий кабінет власника авто</span></div>
        </header>
        <div className={styles.secure}>● ЗАХИЩЕНЕ MAGIC-ПОСИЛАННЯ</div>
        <h1>Ваш кабінет готовий</h1>
        <p className={styles.intro}>Після активації цей пристрій запам’ятає Вас. Надалі можна відкривати <b>«Мій гараж»</b> без нового посилання на кожен ремонт.</p>
        <div className={styles.vehicle}>
          <small>АВТОМОБІЛЬ</small>
          <strong>{preview.vehicleLabel}{preview.year ? ` ${preview.year}` : ""}</strong>
          <VehiclePlate value={preview.plateNumber} size="sm" />
        </div>
        <div className={styles.identity}>
          <span>Власник <b>{preview.clientName || "Клієнт Turbo LEV"}</b></span>
          <span>Телефон <b>{preview.phoneMasked}</b></span>
        </div>
        <ActivateClientPortal token={token} />
        <p className={styles.note}>Доступ зберігається тільки у цьому браузері через захищену HttpOnly-сесію. Не активуйте кабінет на чужому або публічному пристрої.</p>
        <Link className={styles.caseLink} href={`/r/${encodeURIComponent(token)}`}>Відкрити лише поточний сервісний випадок →</Link>
      </section>
    </main>;
  } catch (error) {
    const message = error instanceof ClientPortalSessionError || error instanceof DiagnosticReportError
      ? error.message
      : "Посилання недоступне.";
    return <main className={styles.page}><section className={styles.card}>
      <header className={styles.brand}><div className={styles.logo}>TL</div><div><strong>ТУРБО <b>ЛЕВ</b></strong><span>Особистий кабінет</span></div></header>
      <h1>Посилання недоступне</h1>
      <p className={styles.intro}>{message}</p>
      <p className={styles.note}>Зверніться до сервіс-менеджера Turbo LEV, щоб отримати нове захищене посилання.</p>
    </section></main>;
  }
}
