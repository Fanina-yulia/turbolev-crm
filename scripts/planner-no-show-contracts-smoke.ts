import assert from "node:assert/strict";

import { PlannerAppointmentStatus } from "@/src/generated/prisma/client";
import {
  automaticNoShowCutoff,
  isEligibleForAutomaticNoShow,
} from "@/src/services/planner-no-show.service";

const now = new Date("2026-09-05T12:00:00.000Z");
const exactlyAtCutoff = automaticNoShowCutoff(now);
const almostAtCutoff = new Date(exactlyAtCutoff.getTime() + 1);

const base = {
  status: PlannerAppointmentStatus.BOOKED,
  actualArrivalAt: null,
  actualStartAt: null,
  actualEndAt: null,
  noShowAt: null,
};

assert.equal(
  isEligibleForAutomaticNoShow({ ...base, plannedStartAt: exactlyAtCutoff }, now),
  true,
  "a BOOKED appointment at the 24-hour boundary must be eligible",
);
assert.equal(
  isEligibleForAutomaticNoShow({ ...base, plannedStartAt: almostAtCutoff }, now),
  false,
  "an appointment younger than 24 hours must remain BOOKED",
);
assert.equal(
  isEligibleForAutomaticNoShow({
    ...base,
    plannedStartAt: exactlyAtCutoff,
    actualArrivalAt: new Date("2026-09-04T12:00:01.000Z"),
  }, now),
  false,
  "an appointment with an arrival timestamp must not become NO_SHOW",
);
assert.equal(
  isEligibleForAutomaticNoShow({
    ...base,
    status: PlannerAppointmentStatus.ARRIVED,
    plannedStartAt: exactlyAtCutoff,
  }, now),
  false,
  "a non-BOOKED appointment must not become NO_SHOW",
);

console.log("planner no-show contract smoke passed");
