"use client";

import { FormEvent, useMemo, useState } from "react";
import styles from "./mechanic-walk-in-form.module.css";

type ExistingClient = { id: string; name: string | null; phone: string };

type Props = {
  plate: string;
  vehicleLabel: string;
  existingClient?: ExistingClient | null;
  mileageKm?: number | null;
  onCancel: () => void;
  onStarted: (diagnosticId: string) => void;
};

type WalkInResponse = {
  ok?: boolean;
  diagnosticRequestId?: string;
  message?: string;
  error?: string;
};

function phoneForInput(value?: string | null) {
  if (!value) return "+380";
  const digits = value.replace(/\D+/g, "");
  if (digits.startsWith("380")) return `+${digits}`;
  if (digits.length === 10 && digits.startsWith("0")) return `+38${digits}`;
  return value;
}

export function MechanicWalkInForm({ plate, vehicleLabel, existingClient, mileageKm, onCancel, onStarted }: Props) {
  const [phone, setPhone] = useState(() => phoneForInput(existingClient?.phone));
  const [clientName, setClientName] = useState(existingClient?.name || "");
  const [mileage, setMileage] = useState(mileageKm ? String(mileageKm) : "");
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const valid = useMemo(() => {
    const digits = phone.replace(/\D+/g, "");
    const mileageValue = Number(mileage);
    return digits.length >= 10
      && clientName.trim().length >= 2
      && Number.isInteger(mileageValue)
      && mileageValue > 0
      && mileageValue <= 2_000_000;
  }, [clientName, mileage, phone]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/cabinet/mechanic/tasks/walk-in", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plate,
          phone,
          clientName: clientName.trim(),
          mileageKm: Number(mileage),
          problem: problem.trim() || null,
        }),
      });
      const body = await response.json().catch(() => null) as WalkInResponse | null;
      if (!response.ok || !body?.ok || !body.diagnosticRequestId) {
        throw new Error(body?.message || body?.error || "Не вдалося оформити позаплановий заїзд");
      }
      onStarted(body.diagnosticRequestId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не вдалося оформити позаплановий заїзд");
    } finally {
      setBusy(false);
    }
  }

  return <form className={styles.form} onSubmit={submit}>
    <div className={styles.summary}>
      <small>ПОЗАПЛАНОВИЙ ЗАЇЗД</small>
      <strong>{plate}</strong>
      <span>{vehicleLabel || "Автомобіль"}</span>
    </div>

    {existingClient && <div className={styles.existing}>
      <b>✓ Клієнта знайдено в базі</b>
      <span>{existingClient.name || "Клієнт"} · {existingClient.phone}</span>
      <small>Клієнта й автомобіль повторно не створюємо.</small>
    </div>}

    <label>
      <span>Телефон клієнта *</span>
      <input
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        value={phone}
        readOnly={Boolean(existingClient)}
        onChange={(event) => setPhone(event.target.value)}
        placeholder="+380671234567"
      />
    </label>

    <label>
      <span>Ім’я та прізвище *</span>
      <input
        type="text"
        autoComplete="name"
        value={clientName}
        readOnly={Boolean(existingClient)}
        onChange={(event) => setClientName(event.target.value)}
        placeholder="Ім’я та прізвище"
      />
    </label>

    <label>
      <span>Пробіг *</span>
      <div className={styles.mileage}>
        <input
          type="number"
          inputMode="numeric"
          min={1}
          max={2_000_000}
          step={1}
          value={mileage}
          onChange={(event) => setMileage(event.target.value)}
          placeholder="125400"
        />
        <b>км</b>
      </div>
    </label>

    <label>
      <span>Що перевіряємо?</span>
      <textarea
        rows={3}
        maxLength={1000}
        value={problem}
        onChange={(event) => setProblem(event.target.value)}
        placeholder="Наприклад: стук у передній підвісці"
      />
    </label>

    {error && <div className={styles.error}>{error}</div>}

    <button className={styles.primary} type="submit" disabled={!valid || busy}>
      {busy ? "Оформлюю заїзд…" : "ПРОВЕСТИ ДІАГНОСТИКУ →"}
    </button>
    <button className={styles.secondary} type="button" onClick={onCancel} disabled={busy}>Назад</button>
  </form>;
}
