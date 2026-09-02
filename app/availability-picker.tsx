"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./availability-picker.module.css";

export type AvailabilitySelection = {
  time: string;
  postId: string;
  mechanicId: string;
  parallelCount?: number;
  startAt: string;
  endAt: string;
};

type ResourceState = { id: string; name: string; available: boolean; parallelCount?: number };
type AvailabilitySlot = {
  time: string;
  startAt: string;
  endAt: string;
  available: boolean;
  posts: ResourceState[];
  mechanics: ResourceState[];
};
type AvailabilityResponse = {
  status: string;
  message?: string;
  durationMinutes: number;
  slotMinutes: number;
  location: { id: string; name: string; timezone: string; openMinute: number; closeMinute: number };
  slots: AvailabilitySlot[];
};

export function AvailabilityPicker({
  date,
  locationId = "",
  durationMinutes = 60,
  excludeAppointmentId,
  selectedTime,
  selectedPostId,
  selectedMechanicId,
  onChange,
}: {
  date: string;
  locationId?: string;
  durationMinutes?: number;
  excludeAppointmentId?: string;
  selectedTime: string;
  selectedPostId: string;
  selectedMechanicId: string;
  onChange: (selection: AvailabilitySelection) => void;
}) {
  const [data, setData] = useState<AvailabilityResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setData(null);
    setError("");
    if (!date) return;
    const controller = new AbortController();
    void (async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ date, durationMinutes: String(durationMinutes) });
        if (locationId) params.set("locationId", locationId);
        if (excludeAppointmentId) params.set("excludeAppointmentId", excludeAppointmentId);
        const response = await fetch(`/api/planner/availability?${params}`, { cache: "no-store", signal: controller.signal });
        const payload = await response.json() as AvailabilityResponse;
        if (!response.ok || payload.status !== "OK") throw new Error(payload.message || "Не вдалося перевірити вільний час.");
        setData(payload);
      } catch (cause) {
        if ((cause as Error).name !== "AbortError") setError(cause instanceof Error ? cause.message : "Не вдалося перевірити вільний час.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [date, locationId, durationMinutes, excludeAppointmentId]);

  const selectedSlot = useMemo(() => data?.slots.find((slot) => slot.time === selectedTime) || null, [data, selectedTime]);
  const availableCount = useMemo(() => data?.slots.filter((slot) => slot.available).length || 0, [data]);

  function choosePost(slot: AvailabilitySlot, post: ResourceState) {
    if (!post.available) return;
    const currentMechanic = slot.mechanics.find((mechanic) => mechanic.id === selectedMechanicId && mechanic.available);
    const mechanic = currentMechanic || [...slot.mechanics]
      .filter((item) => item.available)
      .sort((a, b) => (a.parallelCount ?? 0) - (b.parallelCount ?? 0))[0];
    onChange({ time: slot.time, postId: post.id, mechanicId: mechanic?.id || "", parallelCount: mechanic?.parallelCount ?? 0, startAt: slot.startAt, endAt: slot.endAt });
  }

  function chooseMechanic(mechanic: ResourceState) {
    if (!selectedSlot || !selectedPostId || !mechanic.available) return;
    onChange({ time: selectedSlot.time, postId: selectedPostId, mechanicId: mechanic.id, parallelCount: mechanic.parallelCount ?? 0, startAt: selectedSlot.startAt, endAt: selectedSlot.endAt });
  }

  if (!date) return <div className={styles.picker}><div className={styles.state}>Оберіть дату — покажу вільні пости по 30 хвилин.</div></div>;

  return <div className={styles.picker}>
    <div className={styles.head}>
      <div><strong>Вільний час по постах</strong><span>{data ? `${data.location.name} · ${data.location.timezone} · ${durationMinutes} хв` : "Перевіряю завантаження…"}</span></div>
      {data && <div className={styles.legend}><i /> {availableCount} доступних стартів</div>}
    </div>
    {loading && !data ? <div className={styles.state}>Перевіряю вільні місця…</div>
      : error ? <div className={styles.state}>{error}</div>
      : !data?.slots.length ? <div className={styles.state}>На цей день немає інтервалів у робочому графіку.</div>
      : <>
        <div className={styles.body}>
          {data.slots.map((slot) => <div className={`${styles.slot} ${slot.available ? "" : styles.unavailable}`} key={slot.time}>
            <div className={styles.slotTime}>{slot.time}</div>
            <div className={styles.posts}>
              {slot.posts.map((post) => {
                const selected = selectedTime === slot.time && selectedPostId === post.id;
                return <button
                  type="button"
                  key={post.id}
                  className={`${styles.post} ${selected ? styles.selected : ""}`}
                  disabled={!post.available}
                  onClick={() => choosePost(slot, post)}
                  title={post.available ? `${post.name}: вільно` : `${post.name}: зайнято`}
                >{post.name}{post.available ? " · вільно" : " · зайнято"}</button>;
              })}
            </div>
          </div>)}
        </div>
        {selectedSlot && selectedPostId && <div className={styles.mechanics}>
          <span>Механік на {selectedSlot.time}</span>
          <div className={styles.mechanicList}>
            {selectedSlot.mechanics.map((mechanic) => <button
              type="button"
              key={mechanic.id}
              className={`${styles.mechanic} ${selectedMechanicId === mechanic.id ? styles.selected : ""}`}
              disabled={!mechanic.available}
              onClick={() => chooseMechanic(mechanic)}
            >
              <b>{mechanic.name}</b>
              <small>{!mechanic.available ? "завантажений: 2 авто" : (mechanic.parallelCount ?? 0) === 1 ? "паралельно 1 авто" : "вільний"}</small>
            </button>)}
          </div>
          {!selectedSlot.mechanics.length && <div className={styles.warning}>На локації немає активних механіків. Пост можна вибрати, але спочатку додайте механіків у CRM.</div>}
        </div>}
      </>}
  </div>;
}
