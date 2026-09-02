"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import styles from "./page.module.css";

type MoneyLine = {
  id: string;
  type: string;
  status: string;
  description: string;
  code?: string | null;
  article?: string | null;
  brand?: string | null;
  unit: string;
  currency: string;
  quantity: string;
  unitPrice: string;
  discount: string;
  total: string;
  completedAt?: string | null;
};

type PackageData = {
  generatedAt: string;
  workOrder: {
    id: string;
    displayNumber: string;
    statusLabel: string;
    createdAt: string | null;
    closedAt: string | null;
    client: { name: string | null; phone: string };
    vehicle: { brand: string | null; model: string | null; year: number | null; plateNumber: string | null; vin: string | null; mileageKm: number | null };
  };
  documents: {
    diagnosticCard: { available: boolean; number: string | null; revision: number | null; finalizedAt: string | null; snapshot: any };
    recommendations: { available: boolean; items: any };
    estimate: { available: boolean; revision?: number; status?: string; currency?: string; subtotal?: string; discountAmount?: string; totalAmount?: string; lineSnapshot?: any; sentAt?: string | null; approvedAt?: string | null; approvedByName?: string | null; approvalNote?: string | null };
    invoice: { available: boolean; state: string; currency: string; totalAmount: string; receivable: string | null; paid: string; outstanding: string; fullyPaid: boolean; actualFinalized: boolean; lines: MoneyLine[] };
    act: { available: boolean; state: string; currency: string; totalAmount: string; completedAt: string | null; lines: MoneyLine[] };
    warranty: { available: boolean; items: Array<{ lineId: string; description: string; warrantyKm: number | null; warrantyDays: number | null; startsAt: string | null; expiresAt: string | null; mileageStartKm: number | null; mileageLimitKm: number | null; status: string }> };
    history: { available: boolean; items: Array<{ id: string; occurredAt: string | null; kind: string; title: string; detail: string | null; actor: string | null; amount: number | null; currency: string | null }> };
  };
};

type Tab = "diagnostic" | "estimate" | "invoice" | "act" | "warranty" | "history";

const TABS: Array<[Tab, string]> = [
  ["diagnostic", "Діагностична карта"],
  ["estimate", "Комерційна пропозиція"],
  ["invoice", "Рахунок"],
  ["act", "Акт виконаних робіт"],
  ["warranty", "Гарантія"],
  ["history", "Історія"],
];

function date(value: string | null | undefined) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return new Intl.DateTimeFormat("uk-UA", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Kyiv" }).format(parsed);
}

function money(value: string | number | null | undefined, currency = "UAH") {
  const number = Number(value ?? 0);
  return new Intl.NumberFormat("uk-UA", { style: "currency", currency, maximumFractionDigits: 2 }).format(Number.isFinite(number) ? number : 0);
}

function vehicleLabel(vehicle: PackageData["workOrder"]["vehicle"]) {
  return [vehicle.brand, vehicle.model, vehicle.year].filter(Boolean).join(" ") || "Автомобіль";
}

function LinesTable({ lines }: { lines: MoneyLine[] }) {
  if (!lines.length) return <div className={styles.empty}>Позицій ще немає.</div>;
  return <div className={styles.tableWrap}><table className={styles.table}>
    <thead><tr><th>Позиція</th><th>К-ть</th><th>Ціна</th><th>Знижка</th><th>Сума</th></tr></thead>
    <tbody>{lines.map((line) => <tr key={line.id}>
      <td><b>{line.description}</b><small>{[line.brand, line.article, line.code].filter(Boolean).join(" · ")}</small></td>
      <td>{line.quantity} {line.unit}</td>
      <td>{money(line.unitPrice, line.currency)}</td>
      <td>{money(line.discount, line.currency)}</td>
      <td><b>{money(line.total, line.currency)}</b></td>
    </tr>)}</tbody>
  </table></div>;
}

export default function WorkOrderDocumentsPage() {
  const params = useParams<{ id: string }>();
  const id = Array.isArray(params?.id) ? params.id[0] : params?.id;
  const [data, setData] = useState<PackageData | null>(null);
  const [tab, setTab] = useState<Tab>("diagnostic");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setLoading(true);
    fetch(`/api/work-orders/${encodeURIComponent(id)}/documents`, { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json() as { ok?: boolean; package?: PackageData; error?: string };
        if (!response.ok || !payload.ok || !payload.package) throw new Error(payload.error || "Не вдалося завантажити документи.");
        if (!cancelled) setData(payload.package);
      })
      .catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : "Не вдалося завантажити документи."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [id]);

  const availability = useMemo(() => data ? {
    diagnostic: data.documents.diagnosticCard.available,
    estimate: data.documents.estimate.available,
    invoice: data.documents.invoice.available,
    act: data.documents.act.available,
    warranty: data.documents.warranty.available,
    history: data.documents.history.available,
  } : null, [data]);

  if (loading) return <main className={styles.state} data-crm-surface="public">Завантажую пакет документів…</main>;
  if (error || !data) return <main className={styles.state} data-crm-surface="public">{error || "Пакет документів недоступний."}</main>;

  const diagnostic = data.documents.diagnosticCard.snapshot;
  const recommendations = data.documents.recommendations.items || { works: [], parts: [] };

  return <main className={styles.page} data-crm-surface="public">
    <header className={styles.topbar}>
      <div><p>TURBO LEV · ДОКУМЕНТИ</p><h1>{data.workOrder.displayNumber}</h1><span>{vehicleLabel(data.workOrder.vehicle)} · {data.workOrder.vehicle.plateNumber || "без номера"} · {data.workOrder.client.name || data.workOrder.client.phone}</span></div>
      <div className={styles.actions}><button type="button" onClick={() => window.print()}>Друк / PDF</button><button type="button" onClick={() => window.close()}>Закрити</button></div>
    </header>

    <section className={styles.summary}>
      <div><span>Статус</span><b>{data.workOrder.statusLabel}</b></div>
      <div><span>VIN</span><b>{data.workOrder.vehicle.vin || "—"}</b></div>
      <div><span>Пробіг</span><b>{data.workOrder.vehicle.mileageKm ? `${data.workOrder.vehicle.mileageKm.toLocaleString("uk-UA")} км` : "—"}</b></div>
      <div><span>Оновлено</span><b>{date(data.generatedAt)}</b></div>
    </section>

    <nav className={styles.tabs}>{TABS.map(([key, label]) => <button key={key} type="button" className={tab === key ? styles.activeTab : ""} onClick={() => setTab(key)}><span>{label}</span><b>{availability?.[key] ? "✓" : "—"}</b></button>)}</nav>

    {tab === "diagnostic" && <section className={styles.document}>
      <div className={styles.docHeader}><div><p>ДІАГНОСТИЧНА КАРТА</p><h2>{data.documents.diagnosticCard.number || "Ще не сформована"}</h2></div><span>{date(data.documents.diagnosticCard.finalizedAt)}</span></div>
      {!diagnostic ? <div className={styles.empty}>FINAL-ревізії Діагностичної карти ще немає.</div> : <>
        <div className={styles.callout}><b>Технічний висновок</b><p>{diagnostic.technicalConclusion || "Висновок не вказано."}</p></div>
        <div className={styles.metrics}><div><span>Перевірено</span><b>{diagnostic.counts?.checked ?? 0}/{diagnostic.counts?.total ?? 0}</b></div><div><span>OK</span><b>{diagnostic.counts?.ok ?? 0}</b></div><div><span>Увага</span><b>{diagnostic.counts?.attention ?? 0}</b></div><div><span>Дефекти</span><b>{diagnostic.counts?.defect ?? 0}</b></div></div>
        {(diagnostic.inspections || []).map((inspection: any, i: number) => <div className={styles.group} key={`${inspection.name}-${i}`}><h3>{inspection.name}</h3>{(inspection.sections || []).map((section: any, j: number) => <div key={`${section.name}-${j}`}><h4>{section.name}</h4>{(section.items || []).map((item: any, k: number) => <div className={styles.check} key={`${item.name}-${k}`}><div><b>{item.name}</b><span>{[item.position, item.measurementValue && `${item.measurementValue} ${item.measurementUnit || ""}`, item.measurementText].filter(Boolean).join(" · ")}</span></div><strong>{item.state}</strong>{item.finding && <p>{[item.finding.text, item.finding.suggestedWorkName, item.finding.suggestedPartName].filter(Boolean).join(" · ")}</p>}</div>)}</div>)}</div>)}
        <div className={styles.twoCols}><div><h3>Рекомендовані роботи</h3>{(recommendations.works || []).length ? recommendations.works.map((item: any) => <p key={`${item.findingId}-${item.name}`}>{item.name} <small>· {item.urgency}</small></p>) : <span>Немає</span>}</div><div><h3>Рекомендовані деталі</h3>{(recommendations.parts || []).length ? recommendations.parts.map((item: any) => <p key={`${item.findingId}-${item.name}`}>{item.name} <small>· {item.urgency}</small></p>) : <span>Немає</span>}</div></div>
      </>}
    </section>}

    {tab === "estimate" && <section className={styles.document}>
      <div className={styles.docHeader}><div><p>КОМЕРЦІЙНА ПРОПОЗИЦІЯ</p><h2>{data.documents.estimate.available ? `Ревізія ${data.documents.estimate.revision}` : "Ще не сформована"}</h2></div><span>{data.documents.estimate.status || "—"}</span></div>
      {!data.documents.estimate.available ? <div className={styles.empty}>Комерційної пропозиції ще немає.</div> : <>
        <div className={styles.metrics}><div><span>Роботи</span><b>{money((data.documents.estimate as any).laborTotal, data.documents.estimate.currency)}</b></div><div><span>Запчастини</span><b>{money((data.documents.estimate as any).partsTotal, data.documents.estimate.currency)}</b></div><div><span>Знижка</span><b>{money(data.documents.estimate.discountAmount, data.documents.estimate.currency)}</b></div><div><span>Разом</span><b>{money(data.documents.estimate.totalAmount, data.documents.estimate.currency)}</b></div></div>
        <div className={styles.callout}><b>Погодження</b><p>{data.documents.estimate.approvedAt ? `Погоджено ${date(data.documents.estimate.approvedAt)}${data.documents.estimate.approvedByName ? ` · ${data.documents.estimate.approvedByName}` : ""}` : data.documents.estimate.sentAt ? `Відправлено ${date(data.documents.estimate.sentAt)}` : "Чернетка"}</p>{data.documents.estimate.approvalNote && <small>{data.documents.estimate.approvalNote}</small>}</div>
      </>}
    </section>}

    {tab === "invoice" && <section className={styles.document}>
      <div className={styles.docHeader}><div><p>РАХУНОК</p><h2>{data.workOrder.displayNumber}</h2></div><span>{data.documents.invoice.state === "FINAL" ? "Фінальний" : "Попередній"}</span></div>
      <LinesTable lines={data.documents.invoice.lines}/>
      <div className={styles.totals}><div><span>Разом</span><b>{money(data.documents.invoice.totalAmount, data.documents.invoice.currency)}</b></div><div><span>Сплачено</span><b>{money(data.documents.invoice.paid, data.documents.invoice.currency)}</b></div><div><span>До сплати</span><b>{money(data.documents.invoice.outstanding, data.documents.invoice.currency)}</b></div></div>
    </section>}

    {tab === "act" && <section className={styles.document}>
      <div className={styles.docHeader}><div><p>АКТ ВИКОНАНИХ РОБІТ</p><h2>{data.workOrder.displayNumber}</h2></div><span>{data.documents.act.available ? date(data.documents.act.completedAt) : "Ще не готовий"}</span></div>
      <LinesTable lines={data.documents.act.lines}/>
      <div className={styles.totals}><div><span>Виконано на суму</span><b>{money(data.documents.act.totalAmount, data.documents.act.currency)}</b></div></div>
    </section>}

    {tab === "warranty" && <section className={styles.document}>
      <div className={styles.docHeader}><div><p>ГАРАНТІЙНІ УМОВИ</p><h2>{data.workOrder.displayNumber}</h2></div><span>{data.documents.warranty.items.length} позицій</span></div>
      {data.documents.warranty.items.length ? <div className={styles.list}>{data.documents.warranty.items.map((item) => <article key={item.lineId}><h3>{item.description}</h3><p>{item.warrantyDays ? `${item.warrantyDays} днів` : ""}{item.warrantyDays && item.warrantyKm ? " · " : ""}{item.warrantyKm ? `${item.warrantyKm.toLocaleString("uk-UA")} км` : ""}</p><small>Початок: {date(item.startsAt)} · До: {date(item.expiresAt)}{item.mileageLimitKm ? ` · ліміт пробігу ${item.mileageLimitKm.toLocaleString("uk-UA")} км` : ""}</small></article>)}</div> : <div className={styles.empty}>Для виконаних робіт гарантійні умови ще не зафіксовані.</div>}
    </section>}

    {tab === "history" && <section className={styles.document}>
      <div className={styles.docHeader}><div><p>ІСТОРІЯ ОБСЛУГОВУВАННЯ</p><h2>{data.workOrder.displayNumber}</h2></div><span>{data.documents.history.items.length} подій</span></div>
      <div className={styles.timeline}>{data.documents.history.items.map((event) => <article key={event.id}><time>{date(event.occurredAt)}</time><div><b>{event.title}</b>{event.detail && <p>{event.detail}</p>}{event.actor && <small>{event.actor}</small>}</div></article>)}</div>
    </section>}

    <footer className={styles.footer}>СТО «Турбо ЛЕВ» · пакет сформовано з актуальних даних CRM · {date(data.generatedAt)}</footer>
  </main>;
}
