import assert from "node:assert/strict";
import {
  buildPlannerAvailability,
  plannerLocalDateTimeToUtc,
  validateAppointmentAgainstSchedule,
} from "../src/services/planner-availability.service";

const scheduleValue = [
  { day: 1, label: "Пн", enabled: true, open: "09:00", close: "21:00" },
  { day: 2, label: "Вт", enabled: true, open: "09:00", close: "21:00" },
  { day: 3, label: "Ср", enabled: true, open: "09:00", close: "21:00" },
  { day: 4, label: "Чт", enabled: true, open: "09:00", close: "21:00" },
  { day: 5, label: "Пт", enabled: true, open: "09:00", close: "21:00" },
  { day: 6, label: "Сб", enabled: true, open: "10:00", close: "18:00" },
  { day: 7, label: "Нд", enabled: false, open: "10:00", close: "18:00" },
];

const availability = buildPlannerAvailability({
  locationId: "glevakha",
  timezone: "Europe/Kyiv",
  openMinute: 540,
  closeMinute: 1260,
  scheduleValue,
});

function local(day: string, time: string) {
  const value = plannerLocalDateTimeToUtc(day, time, availability.timezone);
  assert.ok(value, `Expected valid local date/time ${day} ${time}`);
  return value;
}

const mondayStart = local("2026-08-17", "09:00");
assert.equal(mondayStart.toISOString(), "2026-08-17T06:00:00.000Z", "Summer Kyiv offset must be UTC+3");
assert.equal(
  validateAppointmentAgainstSchedule(availability, mondayStart, local("2026-08-17", "10:00")).ok,
  true,
  "Appointment inside working hours must be accepted",
);

const beforeOpen = validateAppointmentAgainstSchedule(
  availability,
  local("2026-08-17", "08:45"),
  local("2026-08-17", "09:45"),
);
assert.equal(beforeOpen.ok, false, "Appointment before opening must be blocked");
if (!beforeOpen.ok) assert.equal(beforeOpen.conflict.resourceType, "SCHEDULE");

const afterClose = validateAppointmentAgainstSchedule(
  availability,
  local("2026-08-17", "20:30"),
  local("2026-08-17", "21:30"),
);
assert.equal(afterClose.ok, false, "Appointment after closing must be blocked");

const sunday = validateAppointmentAgainstSchedule(
  availability,
  local("2026-08-16", "11:00"),
  local("2026-08-16", "12:00"),
);
assert.equal(sunday.ok, false, "Disabled work day must be blocked");
if (!sunday.ok) assert.equal(sunday.conflict.enabled, false);

const crossDay = validateAppointmentAgainstSchedule(
  availability,
  local("2026-08-17", "20:30"),
  local("2026-08-18", "09:30"),
);
assert.equal(crossDay.ok, false, "Production slot crossing a local calendar day must be blocked");

const winterStart = plannerLocalDateTimeToUtc("2027-01-11", "09:00", "Europe/Kyiv");
assert.ok(winterStart);
assert.equal(winterStart.toISOString(), "2027-01-11T07:00:00.000Z", "Winter Kyiv offset must be UTC+2");

console.log("Planner availability smoke tests passed", {
  scheduleDays: availability.schedule.length,
  summerTimezone: mondayStart.toISOString(),
  winterTimezone: winterStart.toISOString(),
  hardScheduleGate: true,
});
