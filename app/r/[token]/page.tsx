import type { Metadata } from "next";
import { DiagnosticReportError, getDiagnosticReportByToken, type DiagnosticReportSnapshot } from "@/src/services/diagnostic-report.service";
import styles from "./diagnostic-report.module.css";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Звіт діагностики · Turbo LEV",
  description: "Результати діагностики автомобіля в Turbo LEV",
  robots: { index: false, follow: false, nocache: true },
};

const stateMeta: Record<string, { label: string; mark: string; tone: string }> = {
  OK: { label: "Норма", mark: "✓", tone: styles.ok },
  ATTENTION: { label: "Потребує уваги", mark: "!", tone: styles.attention },
  DEFECT: { label: "Дефект", mark: "×", tone: styles.defect },
};
const actionLabels: Record<string, string> = {
  NONE: "Потрібна оцінка",
  REPLACE: "Рекомендується заміна",
  REPAIR: "Рекомендується ремонт",
  ADJUST: "Потрібне регулювання",
  CLEAN: "Потрібне обслуговування / очищення",
  ADDITIONAL_DIAGNOSTICS: "Потрібна додаткова діагностика",
};
const urgencyLabels: Record<string, string> = {
  INFO: "Рекомендація",
  SOON: "Найближчим часом",
  CRITICAL: "Критично",
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("uk-UA", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Kyiv" }).format(new Date(value));
}
function formatMileage(value: number | null) {
  return value == null ? "Не вказано" : `${new Intl.NumberFormat("uk-UA").format(value)} км`;
}
function problemItems(snapshot: DiagnosticReportSnapshot) {
  return snapshot.inspections.flatMap((inspection) => inspection.sections.flatMap((section) => section.items.filter((item) => item.state === "ATTENTION" || item.state === "DEFECT")));
}

export default async function DiagnosticReportPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ pricing?: string }> }) {
  const { token } = await params;
  const query = await searchParams;
  try {
    const report = await getDiagnosticReportByToken(token);
    const snapshot = report.snapshot;
    const issues = problemItems(snapshot);
    const pricingRequested = Boolean(report.requestedPricingAt) || query.pricing === "requested";

    return <main className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.brandHeader}>
          <div className={styles.logo}>TL</div>
          <div><strong>Turbo LEV</strong><span>Автосервіс · звіт діагностики</span></div>
          <div className={styles.verified}>✓ Зафіксований звіт</div>
        </header>

        <section className={styles.hero}>
          <div>
            <p className={styles.eyebrow}>РЕЗУЛЬТАТ ДІАГНОСТИКИ</p>
            <h1>{snapshot.vehicle.label}</h1>
            <div className={styles.vehicleMeta}>
              <span className={styles.plate}>🇺🇦 {snapshot.vehicle.plateNumber || "БЕЗ НОМЕРА"}</span>
              <span>Пробіг: <b>{formatMileage(snapshot.vehicle.mileageKm)}</b></span>
            </div>
            {snapshot.client.name && <p className={styles.greeting}>{snapshot.client.name}, нижче — результати перевірки вашого автомобіля.</p>}
          </div>
          <div className={styles.reportMeta}><span>Сформовано</span><strong>{formatDate(snapshot.generatedAt)}</strong>{snapshot.stationName && <small>{snapshot.stationName}</small>}</div>
        </section>

        <section className={styles.metrics}>
          <div><span>Перевірено</span><strong>{snapshot.counts.checked}</strong><small>з {snapshot.counts.total} пунктів</small></div>
          <div className={styles.metricOk}><span>Норма</span><strong>{snapshot.counts.ok}</strong><small>без зауважень</small></div>
          <div className={styles.metricAttention}><span>Увага</span><strong>{snapshot.counts.attention}</strong><small>потрібно врахувати</small></div>
          <div className={styles.metricDefect}><span>Дефекти</span><strong>{snapshot.counts.defect}</strong><small>потребують рішення</small></div>
        </section>

        {(snapshot.problem || snapshot.technicalConclusion || snapshot.mechanicComment) && <section className={styles.summaryCard}>
          {snapshot.problem && <div><span>Звернення / скарга</span><p>{snapshot.problem}</p></div>}
          {snapshot.technicalConclusion && <div><span>Технічний висновок</span><p className={styles.preserve}>{snapshot.technicalConclusion}</p></div>}
          {snapshot.mechanicComment && <div><span>Коментар автомеханіка</span><p>{snapshot.mechanicComment}</p></div>}
          {snapshot.mechanicName && <small>Діагностику виконав: {snapshot.mechanicName}</small>}
        </section>}

        <section className={styles.results}>
          <div className={styles.sectionTitle}><div><p className={styles.eyebrow}>ЧЕКЛІСТ</p><h2>Що перевірили</h2></div><span>{issues.length ? `${issues.length} пунктів потребують уваги` : "Зауважень не виявлено"}</span></div>
          {snapshot.inspections.map((inspection, inspectionIndex) => <article className={styles.inspection} key={`${inspection.name}-${inspectionIndex}`}>
            <h3>{inspection.name}</h3>
            {inspection.sections.map((section, sectionIndex) => <div className={styles.reportSection} key={`${section.name}-${sectionIndex}`}>
              <div className={styles.reportSectionHead}><strong>{section.name}</strong><span>{section.items.length} перевірено</span></div>
              <div className={styles.itemList}>{section.items.map((item, itemIndex) => {
                const meta = stateMeta[item.state] || stateMeta.OK;
                return <div className={`${styles.item} ${meta.tone}`} key={`${item.name}-${itemIndex}`}>
                  <span className={styles.stateMark}>{meta.mark}</span>
                  <div className={styles.itemMain}>
                    <div className={styles.itemTop}><strong>{item.name}{item.position ? ` · ${item.position}` : ""}</strong><b>{meta.label}</b></div>
                    {item.measurement && <small>Замір: {item.measurement}</small>}
                    {(item.finding?.text || item.note) && <p>{item.finding?.text || item.note}</p>}
                    {item.finding && <div className={styles.tags}><span>{actionLabels[item.finding.action] || item.finding.action}</span><span className={item.finding.urgency === "CRITICAL" ? styles.criticalTag : ""}>{urgencyLabels[item.finding.urgency] || item.finding.urgency}</span></div>}
                    {item.finding?.suggestedWorkName && <div className={styles.recommendation}><span>🔧</span><div><small>Рекомендована робота</small><strong>{item.finding.suggestedWorkName}</strong></div></div>}
                    {item.finding?.suggestedPartName && <div className={styles.recommendation}><span>▣</span><div><small>Потрібна деталь / матеріал</small><strong>{item.finding.suggestedPartName}</strong></div></div>}
                    {item.finding?.mediaIds.length ? <div className={styles.photos}>{item.finding.mediaIds.map((mediaId) => <a href={`/api/public/diagnostic-report/${encodeURIComponent(token)}/media/${encodeURIComponent(mediaId)}`} target="_blank" rel="noreferrer" key={mediaId}><img src={`/api/public/diagnostic-report/${encodeURIComponent(token)}/media/${encodeURIComponent(mediaId)}`} alt={`Фото: ${item.name}`} /></a>)}</div> : null}
                  </div>
                </div>;
              })}</div>
            </div>)}
          </article>)}
        </section>

        <section className={styles.cta}>
          <div><p className={styles.eyebrow}>НАСТУПНИЙ КРОК</p><h2>{pricingRequested ? "Запит на кошторис отримано" : "Порахувати вартість ремонту?"}</h2><p>{pricingRequested ? "Сервіс-менеджер бачить ваш запит у CRM та підготує окремий кошторис робіт і запчастин." : "Натисніть кнопку — сервіс-менеджер отримає запит і сформує окремий кошторис за рекомендаціями діагностики."}</p></div>
          {pricingRequested ? <div className={styles.requested}>✓ Запит відправлено</div> : <form method="post" action={`/api/public/diagnostic-report/${encodeURIComponent(token)}/request-pricing`}><button type="submit">Попросити кошторис</button></form>}
        </section>

        <footer className={styles.footer}>
          <strong>Turbo LEV</strong>
          <p>Цей звіт фіксує результати діагностики на момент його формування. Рекомендації не є фінальним погодженням робіт. Перелік, ціна та обсяг ремонту погоджуються окремим кошторисом.</p>
          {report.expiresAt && <small>Посилання дійсне до {formatDate(report.expiresAt.toISOString())} або до відкликання сервісом.</small>}
        </footer>
      </div>
    </main>;
  } catch (error) {
    const message = error instanceof DiagnosticReportError ? error.message : "Не вдалося відкрити звіт.";
    return <main className={styles.page}><div className={styles.expired}><div className={styles.logo}>TL</div><h1>Звіт недоступний</h1><p>{message}</p><small>Зверніться до сервіс-менеджера Turbo LEV, щоб отримати актуальне посилання.</small></div></main>;
  }
}
