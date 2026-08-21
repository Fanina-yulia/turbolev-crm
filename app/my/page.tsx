import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import {
  CLIENT_PORTAL_SESSION_COOKIE,
  getClientGarageSnapshot,
  resolveClientPortalSession,
  type ClientGarageVehicle,
} from "@/src/services/client-portal-session.service";
import { LogoutButton } from "./logout-button";
import styles from "./client-garage.module.css";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Мій гараж · Turbo LEV",
  description: "Постійний особистий кабінет власника авто Turbo LEV",
  robots: { index: false, follow: false, nocache: true },
};

function dateTime(value?: string | null) {
  if (!value) return "уточнюється";
  return new Intl.DateTimeFormat("uk-UA", {
    timeZone: "Europe/Kyiv",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function date(value?: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("uk-UA", {
    timeZone: "Europe/Kyiv",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function money(value: number | null, currency: string | null) {
  if (value == null) return null;
  try {
    return new Intl.NumberFormat("uk-UA", {
      style: "currency",
      currency: currency || "UAH",
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    return `${new Intl.NumberFormat("uk-UA").format(value)} ${currency || "UAH"}`;
  }
}

function toneClass(vehicle: ClientGarageVehicle) {
  if (vehicle.status.tone === "success") return styles.statusSuccess;
  if (vehicle.status.tone === "warning") return styles.statusWarning;
  if (vehicle.status.tone === "danger") return styles.statusDanger;
  if (vehicle.status.tone === "info") return styles.statusInfo;
  return styles.statusNeutral;
}

export default async function MyGaragePage({ searchParams }: { searchParams: Promise<{ vehicle?: string }> }) {
  const store = await cookies();
  const rawSession = store.get(CLIENT_PORTAL_SESSION_COOKIE)?.value || null;
  const session = await resolveClientPortalSession(rawSession);

  if (!session) {
    return <main className={styles.page}>
      <section className={styles.guestCard}>
        <div className={styles.logo}>TL</div>
        <p className={styles.eyebrow}>ТУРБО ЛЕВ · ОСОБИСТИЙ КАБІНЕТ</p>
        <h1>Мій гараж</h1>
        <p>На цьому пристрої ще немає активного доступу. Відкрийте захищене magic-посилання, яке надіслав сервіс-менеджер Turbo LEV, і один раз активуйте постійний кабінет.</p>
        <small>Після активації тут будуть усі Ваші авто, поточний статус, історія сервісу та важливі дії.</small>
      </section>
    </main>;
  }

  const garage = await getClientGarageSnapshot(session.clientId);
  const params = await searchParams;
  const requested = params.vehicle || "";
  const selected = garage.vehicles.find((item) => item.id === requested) || garage.vehicles[0] || null;

  return <main className={styles.page}>
    <div className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.brand}>
          <div className={styles.logo}>TL</div>
          <div><strong>ТУРБО <b>ЛЕВ</b></strong><span>Мій гараж</span></div>
        </div>
        <LogoutButton />
      </header>

      <section className={styles.welcome}>
        <div><p>ВІТАЄМО У ВАШОМУ КАБІНЕТІ</p><h1>{garage.client.name || "Клієнт Turbo LEV"}</h1><span>{garage.client.phoneMasked} · доступ збережено на цьому пристрої</span></div>
        <div className={styles.vehicleCount}><b>{garage.vehicles.length}</b><span>{garage.vehicles.length === 1 ? "авто" : "автомобілів"}</span></div>
      </section>

      {selected?.action ? <section className={`${styles.priority} ${selected.action.kind === "READY" ? styles.priorityReady : ""}`}>
        <div className={styles.priorityMark}>{selected.action.kind === "READY" ? "✓" : "!"}</div>
        <div>
          <p>ЩО ЗАРАЗ ВАЖЛИВО</p>
          <h2>{selected.action.title}</h2>
          <span>{selected.action.description}</span>
          {selected.action.amount != null ? <strong>{money(selected.action.amount, selected.action.currency)}</strong> : null}
          <Link href={`/my/vehicle/${encodeURIComponent(selected.id)}`} style={{ display: "inline-block", marginTop: 10, color: "#ff8b47", fontSize: 12, fontWeight: 900, textDecoration: "none" }}>Відкрити автомобіль →</Link>
        </div>
      </section> : selected && selected.status.code !== "OUTSIDE_SERVICE" ? <section className={styles.priorityCalm}>
        <div className={styles.priorityMark}>✓</div><div><p>ЩО ЗАРАЗ ВАЖЛИВО</p><h2>Все гаразд. Авто в процесі</h2><span>Поточний етап: {selected.status.label}. Ми покажемо тут дію, щойно від Вас щось буде потрібно.</span><Link href={`/my/vehicle/${encodeURIComponent(selected.id)}`} style={{ display: "inline-block", marginTop: 10, color: "#78d8a6", fontSize: 12, fontWeight: 900, textDecoration: "none" }}>Переглянути ремонт →</Link></div>
      </section> : null}

      <section className={styles.section}>
        <div className={styles.sectionHead}><div><p>МОЇ АВТО</p><h2>Гараж</h2></div><span>{garage.vehicles.length}</span></div>
        {garage.vehicles.length ? <div className={styles.garageGrid}>
          {garage.vehicles.map((vehicle) => <Link href={`/my/vehicle/${encodeURIComponent(vehicle.id)}`} className={`${styles.vehicleCard} ${selected?.id === vehicle.id ? styles.vehicleSelected : ""}`} key={vehicle.id}>
            <div className={styles.vehicleCardTop}>
              <div className={styles.carGlyph}>◆</div>
              <span className={`${styles.status} ${toneClass(vehicle)}`}>{vehicle.status.label}</span>
            </div>
            <h3>{vehicle.label}{vehicle.year ? ` ${vehicle.year}` : ""}</h3>
            <p>{vehicle.plateNumber || "Без держномера"}</p>
            <div className={styles.vehicleStats}>
              <span><b>{vehicle.mileageKm != null ? new Intl.NumberFormat("uk-UA").format(vehicle.mileageKm) : "—"}</b> км</span>
              <span><b>{vehicle.counts.services}</b> сервісів</span>
              <span><b>{vehicle.counts.diagnostics}</b> діагностик</span>
            </div>
          </Link>)}
        </div> : <div className={styles.empty}>У CRM ще немає автомобілів, прив’язаних до Вашого клієнтського профілю.</div>}
      </section>

      {selected ? <>
        <section className={styles.vehicleHero}>
          <div className={styles.vehicleHeroTitle}>
            <div><p>ОБРАНИЙ АВТОМОБІЛЬ</p><h2>{selected.label}{selected.year ? ` ${selected.year}` : ""}</h2><span>{selected.plateNumber || "Без держномера"}{selected.vin ? ` · VIN ${selected.vin}` : ""}</span></div>
            <span className={`${styles.statusLarge} ${toneClass(selected)}`}>{selected.status.label}</span>
          </div>
          <div className={styles.currentGrid}>
            <div><span>Пробіг</span><b>{selected.mileageKm != null ? `${new Intl.NumberFormat("uk-UA").format(selected.mileageKm)} км` : "—"}</b></div>
            <div><span>Орієнтовна готовність</span><b>{selected.eta ? dateTime(selected.eta) : "—"}</b></div>
            <div><span>Остання активність</span><b>{selected.current.updatedAt ? dateTime(selected.current.updatedAt) : "—"}</b></div>
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHead}><div><p>ІСТОРІЯ АВТО</p><h2>Сервісна історія</h2></div><span>{selected.history.length}</span></div>
          {selected.history.length ? <div className={styles.history}>
            {selected.history.map((item) => <article key={`${item.kind}:${item.id}`}>
              <div className={styles.historyMark}>{item.kind === "SERVICE" ? "🔧" : item.kind === "DIAGNOSTIC" ? "✓" : "◷"}</div>
              <div className={styles.historyBody}><small>{date(item.date)}</small><strong>{item.title}</strong><p>{item.subtitle}</p><span>{item.status}</span></div>
              {item.amount != null ? <b className={styles.historyAmount}>{money(item.amount, item.currency)}</b> : null}
            </article>)}
          </div> : <div className={styles.empty}>Історія цього автомобіля ще порожня.</div>}
        </section>
      </> : null}

      <footer className={styles.footer}>
        <strong>Turbo LEV</strong><span>Ваші авто та сервісна історія в одному кабінеті</span>
      </footer>
    </div>
  </main>;
}
