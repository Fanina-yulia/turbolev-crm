"use client";

import { useMemo, useState } from "react";
import type {
  PlannerAppointmentContract as Appointment,
  PlannerLocationContract as Location,
} from "@/src/lib/contracts/planner";
import styles from "./planner-detail-drawer.module.css";

type Tab = "details" | "works" | "parts" | "history";

const STATUS_LABEL: Record<string, string> = {
  RESERVE: "Резерв",
  BOOKED: "Записаний",
  ARRIVED: "Приїхав",
  DIAGNOSTICS: "Діагностика",
  WAITING_PARTS_SELECTION: "Підбір деталей",
  WAITING_CALCULATION: "Калькуляція",
  WAITING_APPROVAL: "Погодження",
  WAITING_PARTS: "Очікує деталі",
  READY_FOR_REPAIR: "Готовий до ремонту",
  IN_REPAIR: "У роботі",
  PAUSED: "Пауза",
  WAITING_QC: "Контроль якості",
  WAITING_PAYMENT: "Очікує оплату",
  READY_FOR_PICKUP: "Готовий до видачі",
  COMPLETED: "Виданий",
  WARRANTY: "Гарантія",
  NO_SHOW: "Не приїхав",
  CANCELLED: "Скасований",
};

function money(value: unknown) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("uk-UA", { style: "currency", currency: "UAH", maximumFractionDigits: 0 }).format(n);
}

function clock(iso: string | null | undefined, timeZone: string) {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("uk-UA", {
    timeZone,
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(iso));
}

function durationMinutes(item: Appointment) {
  return Math.max(30, Math.round((+new Date(item.plannedEndAt) - +new Date(item.plannedStartAt)) / 60000));
}

export function PlannerDetailDrawer({
  appointment,
  location,
  timeZone,
  busy,
  onClose,
  onArrive,
  onEdit,
  onOpenVehicle,
  onOpenWork,
  onOpenParts,
  onOpenPayment,
  onCompleteFlow,
  onCancel,
}: {
  appointment: Appointment;
  location: Location;
  timeZone: string;
  busy?: boolean;
  onClose: () => void;
  onArrive: () => void;
  onEdit: () => void;
  onOpenVehicle: () => void;
  onOpenWork: () => void;
  onOpenParts: () => void;
  onOpenPayment: () => void;
  onCompleteFlow: () => void;
  onCancel: () => void;
}) {
  const [tab, setTab] = useState<Tab>("details");
  const [moreOpen, setMoreOpen] = useState(false);

  const paymentTone = appointment.payment.status === "PAID"
    ? "paid"
    : appointment.payment.status === "PARTIAL"
      ? "partial"
      : appointment.payment.status === "OVERDUE"
        ? "overdue"
        : "unpaid";

  const processLabel = appointment.processLabel || STATUS_LABEL[appointment.status] || appointment.status;
  const isReserve = appointment.status === "RESERVE";
  const canArrive = appointment.status === "BOOKED";
  const isClosed = ["COMPLETED", "NO_SHOW", "CANCELLED"].includes(appointment.status);

  const history = useMemo(() => [
    { label: "Заплановано", value: clock(appointment.plannedStartAt, timeZone), done: true },
    { label: "Авто прибуло", value: clock(appointment.actualArrivalAt, timeZone), done: Boolean(appointment.actualArrivalAt) },
    { label: "Роботу розпочато", value: clock(appointment.actualStartAt, timeZone), done: Boolean(appointment.actualStartAt) },
    { label: "Роботу завершено", value: clock(appointment.actualEndAt, timeZone), done: Boolean(appointment.actualEndAt) },
  ], [appointment, timeZone]);

  return <aside className={styles.drawer} aria-label="Картка запису">
    <header className={styles.header}>
      <div className={styles.vehicleGlyph}>▣</div>
      <div className={styles.title}>
        <strong>{isReserve ? "Блокування поста" : appointment.vehicleLabel || "Автомобіль"}</strong>
        <span>{appointment.plateNumber || (isReserve ? appointment.post?.name || "Ресурс" : "Без держномера")}</span>
      </div>
      <span className={styles.status}>{STATUS_LABEL[appointment.status] || appointment.status}</span>
      <button className={styles.close} onClick={onClose} aria-label="Закрити">×</button>
    </header>

    <nav className={styles.tabs} aria-label="Розділи картки">
      <button className={tab === "details" ? styles.activeTab : ""} onClick={() => setTab("details")}>Деталі</button>
      <button className={tab === "works" ? styles.activeTab : ""} onClick={() => setTab("works")}>Роботи</button>
      <button className={tab === "parts" ? styles.activeTab : ""} onClick={() => setTab("parts")}>Запчастини</button>
      <button className={tab === "history" ? styles.activeTab : ""} onClick={() => setTab("history")}>Історія</button>
    </nav>

    <div className={styles.body}>
      {tab === "details" && <>
        <section className={styles.rows}>
          <div><span>Клієнт</span><strong>{appointment.customerName || (isReserve ? "Службове блокування" : "Не вказано")}</strong><small>{appointment.phone || "—"}</small></div>
          <div><span>Автомобіль</span><strong>{appointment.vehicleLabel || (isReserve ? "Пост недоступний" : "Не вказано")}</strong><small>{appointment.plateNumber || "—"}</small></div>
          <div><span>Роботи</span><strong>{appointment.problem || (isReserve ? "Блокування ресурсу" : "Опис не додано")}</strong><small>{processLabel}</small></div>
          <div><span>Пост</span><strong>{appointment.post?.name || "Зона приймання"}</strong><small>{location.name}</small></div>
          <div><span>Виконавець</span><strong>{appointment.mechanic?.name || "Не призначено"}</strong><small>{appointment.source || "CRM"}</small></div>
          <div><span>Час</span><strong>{clock(appointment.plannedStartAt, timeZone)}–{new Intl.DateTimeFormat("uk-UA",{timeZone,hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).format(new Date(appointment.plannedEndAt))}</strong><small>{durationMinutes(appointment)} хв</small></div>
        </section>

        <section className={styles.finance}>
          <div>
            <span>Оплата</span>
            <strong className={styles[paymentTone]}>{appointment.payment.status === "PAID" ? "Оплачено" : appointment.payment.status === "PARTIAL" ? "Частково оплачено" : appointment.payment.status === "OVERDUE" ? "Прострочено" : "Не оплачено"}</strong>
          </div>
          <div><span>Нараховано</span><strong>{money(appointment.payment.amount ?? appointment.estimatedAmount)}</strong></div>
          <div><span>Оплачено</span><strong>{money(appointment.payment.paid)}</strong></div>
          <div><span>До сплати</span><strong>{money(appointment.payment.outstanding)}</strong></div>
          {!isReserve && <button type="button" onClick={onOpenPayment}>+ Додати / відкрити оплату</button>}
        </section>

        {appointment.comment && <section className={styles.note}><span>Примітка</span><p>{appointment.comment}</p></section>}
      </>}

      {tab === "works" && <section className={styles.panel}>
        <div className={styles.panelHead}><span>Поточний етап</span><strong>{processLabel}</strong></div>
        <h3>{appointment.problem || (isReserve ? "Пост недоступний" : "Роботи ще не описані")}</h3>
        <p>{appointment.comment || "Додаткових приміток немає."}</p>
        {!isReserve && <button type="button" onClick={onOpenWork}>Відкрити робочий процес →</button>}
      </section>}

      {tab === "parts" && <section className={styles.panel}>
        <div className={styles.panelHead}><span>Запчастини</span><strong>{["WAITING_PARTS_SELECTION","WAITING_PARTS"].includes(appointment.status) ? "Потребують уваги" : "За процесом"}</strong></div>
        <p>{appointment.workOrderId ? "Відкрийте вкладку запчастин замовлення-наряду: там підбір, закупівля та отримання." : "До запису ще не прив'язано замовлення-наряд."}</p>
        {!isReserve && <button type="button" onClick={onOpenParts}>Відкрити запчастини →</button>}
      </section>}

      {tab === "history" && <section className={styles.timeline}>
        {history.map((item) => <div key={item.label} className={item.done ? styles.done : ""}>
          <i />
          <div><strong>{item.label}</strong><span>{item.value}</span></div>
        </div>)}
      </section>}
    </div>

    <footer className={styles.footer}>
      {canArrive && <button className={styles.primary} disabled={busy} onClick={onArrive}>✓ Авто прибуло</button>}
      {!isClosed && !isReserve && <button className={styles.primary} disabled={busy} onClick={onOpenWork}>▶ Почати роботу</button>}
      {!isClosed && !isReserve && <button className={styles.secondary} disabled={busy} onClick={onCompleteFlow}>✓ Завершити</button>}
      <button className={styles.secondary} disabled={busy || isClosed} onClick={onEdit}>▣ Перенести</button>
      <div className={styles.more}>
        <button className={styles.secondary} onClick={() => setMoreOpen((value) => !value)}>••• Ще дії</button>
        {moreOpen && <div className={styles.menu}>
          {appointment.vehicleId && <button onClick={onOpenVehicle}>Карта автомобіля</button>}
          {!isReserve && <button onClick={onOpenPayment}>Оплата</button>}
          <button disabled={isClosed} onClick={onEdit}>Редагувати запис</button>
          <button className={styles.danger} disabled={isClosed} onClick={onCancel}>Скасувати запис</button>
        </div>}
      </div>
    </footer>
  </aside>;
}
