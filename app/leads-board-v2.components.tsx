"use client";

import { AvailabilityPicker } from "./availability-picker";
import {
  businessStatusLabel,
  carLabel,
  isOverdue,
  leadBusinessStatus,
  leadColumns,
  leadSourceLabels,
  rejectReasonLabels,
  toLocalInput,
} from "./leads-board-v2.model";
import type {
  BookingState,
  Lead,
  LeadPatch,
  PlannerLocation,
  UserOption,
} from "./leads-board-v2.types";

export function LeadKpi({ active, danger, label, value, sub, onClick }: {
  active: boolean;
  danger?: boolean;
  label: string;
  value: string | number;
  sub: string;
  onClick: () => void;
}) {
  return <button type="button" className={`${active ? "activeKpi" : ""} ${danger ? "dangerKpi" : ""}`} onClick={onClick}>
    <span>{label}</span><strong>{value}</strong><small>{sub}</small>
  </button>;
}

export function LeadCard({ lead, slaMinutes, users, onPatch, onAttempt, onBook, onCancel, onOpenPlanner }: {
  lead: Lead;
  slaMinutes: number;
  users: UserOption[];
  onPatch: (id: string, patch: LeadPatch, success?: string) => Promise<void>;
  onAttempt: (lead: Lead) => Promise<void>;
  onBook: (lead: Lead) => Promise<void>;
  onCancel: (lead: Lead) => Promise<void>;
  onOpenPlanner: () => void;
}) {
  const overdue = isOverdue(lead, slaMinutes);
  const businessStatus = leadBusinessStatus(lead);
  const isNew = businessStatus === "NEW";
  const isBooked = businessStatus === "BOOKED";
  const isCancelled = businessStatus === "CANCELLED";
  return <article className={`leadCard ${overdue ? "leadCardOverdue" : ""}`}>
    <div className="leadCardTop">
      <span className="leadId">{lead.id.slice(-8).toUpperCase()}</span>
      {isNew
        ? <span className={`leadSla ${overdue ? "late" : "ok"}`}>{overdue ? "ПОТРІБНА ДІЯ" : "SLA OK"}</span>
        : <span className="leadSla ok">{businessStatusLabel(lead).toUpperCase()}</span>}
    </div>
    <strong className="leadName">{lead.name || "Без імені"}</strong>
    <a className="leadPhone" href={`tel:${lead.phoneNormalized}`}>{lead.phone}</a>
    <div className="leadVehicle">
      <b>{lead.plateNumber || "БЕЗ НОМЕРА"}</b>
      <span>{carLabel(lead)}</span>
      {lead.vin && <span>VIN {lead.vin}</span>}
    </div>
    <p className="leadNeed">{lead.need || "Потреба ще не описана"}</p>
    {isCancelled && <p className="leadNeed"><strong>Причина:</strong> {lead.rejectReason ? rejectReasonLabels[lead.rejectReason] : "Не вказана"}{lead.comment ? ` · ${lead.comment}` : ""}</p>}
    <div className="leadMeta">
      <span>{leadSourceLabels[lead.source] || lead.source}</span>
      <span>{lead.assignedUser?.name || "Не призначено"}</span>
      <span>{lead._count?.calls || 0} дзв.</span>
    </div>
    {isNew && <>
      <label className="leadNextLabel">
        <span>Наступна дія</span>
        <input
          key={`${lead.id}-${lead.nextAction || ""}`}
          defaultValue={lead.nextAction || ""}
          onBlur={(event) => void onPatch(lead.id, { nextAction: event.target.value })}
          placeholder="Що зробити далі"
        />
      </label>
      <label className="leadNextLabel">
        <span>Наступний контакт</span>
        <input
          key={`${lead.id}-${lead.nextContactAt || ""}`}
          type="datetime-local"
          defaultValue={toLocalInput(lead.nextContactAt)}
          onBlur={(event) => void onPatch(lead.id, {
            nextContactAt: event.target.value ? new Date(event.target.value).toISOString() : null,
          })}
        />
      </label>
      <div className="attempts">
        <span>Спроби: {lead.contactAttempts}</span>
        <button type="button" onClick={() => void onAttempt(lead)}>+ зафіксувати дзвінок</button>
      </div>
      <select
        className="leadStatusSelect"
        value="NEW"
        onChange={(event) => {
          const nextStatus = event.target.value;
          if (nextStatus === "BOOKED") void onBook(lead);
          else if (nextStatus === "CANCELLED") void onCancel(lead);
        }}
      >
        {leadColumns.map((column) => <option key={column.key} value={column.key}>{column.statusLabel}</option>)}
      </select>
    </>}
    {isBooked && <button type="button" className="leadStatusSelect" onClick={onOpenPlanner}>Записаний · відкрити Планувальник →</button>}
    {isCancelled && <button type="button" className="leadStatusSelect" onClick={() => void onPatch(lead.id, { status: "NEW", rejectReason: null }, "Звернення повернуто в Нове.")}>Повернути в Нове</button>}
    <select
      className="leadStatusSelect"
      value={lead.assignedUserId || ""}
      onChange={(event) => void onPatch(lead.id, { assignedUserId: event.target.value || null })}
    >
      <option value="">Не призначено</option>
      {users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}
    </select>
  </article>;
}

export function LeadBookingModal({ booking, bookingLocation, locations, saving, onChange, onClose, onSave }: {
  booking: BookingState;
  bookingLocation: PlannerLocation | null;
  locations: PlannerLocation[];
  saving: boolean;
  onChange: (next: BookingState) => void;
  onClose: () => void;
  onSave: () => Promise<void>;
}) {
  function resetSelection(next: Partial<BookingState>) {
    onChange({ ...booking, ...next, time: "", postId: "", mechanicId: "" });
  }

  return <div className="leadModalBackdrop" onMouseDown={onClose}>
    <section className="leadModal" onMouseDown={(event) => event.stopPropagation()}>
      <header>
        <div>
          <p className="eyebrow">ЗВЕРНЕННЯ → ПЛАНУВАЛЬНИК</p>
          <h2>Записати {booking.lead.name || "клієнта"}</h2>
          {bookingLocation && <span>{bookingLocation.name} · оберіть реальне вільне місце</span>}
        </div>
        <button type="button" aria-label="Закрити" onClick={onClose}>×</button>
      </header>
      <div className="leadFormGrid">
        <label><span>Дата</span><input type="date" value={booking.date} onChange={(event) => resetSelection({ date: event.target.value })} /></label>
        <label>
          <span>Локація</span>
          <select value={booking.locationId} onChange={(event) => resetSelection({ locationId: event.target.value })}>
            {locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
          </select>
        </label>
        <label>
          <span>Тривалість</span>
          <select value={booking.duration} onChange={(event) => resetSelection({ duration: event.target.value })}>
            {[30, 60, 90, 120, 180, 240].map((minutes) => <option key={minutes} value={minutes}>{minutes < 60 ? `${minutes} хв` : `${minutes / 60} год`}</option>)}
          </select>
        </label>
      </div>

      <AvailabilityPicker
        date={booking.date}
        locationId={booking.locationId}
        durationMinutes={Number(booking.duration) || 60}
        selectedTime={booking.time}
        selectedPostId={booking.postId}
        selectedMechanicId={booking.mechanicId}
        onChange={(selection) => onChange({ ...booking, time: selection.time, postId: selection.postId, mechanicId: selection.mechanicId })}
      />

      <footer>
        <button type="button" className="secondary" onClick={onClose}>Скасувати</button>
        <button
          type="button"
          className="primary"
          disabled={saving || !booking.locationId || !booking.date || !booking.time || !booking.postId || !booking.mechanicId}
          onClick={() => void onSave()}
        >
          {saving ? "Записую…" : "Записати в планувальник"}
        </button>
      </footer>
    </section>
  </div>;
}
