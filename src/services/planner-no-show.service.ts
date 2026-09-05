import "server-only";

import { PlannerAppointmentStatus } from "@/src/generated/prisma/client";
import { getPrisma } from "@/src/lib/prisma";
import {
  AUTO_NO_SHOW_BATCH_SIZE,
  AUTO_NO_SHOW_ROLLOUT_SETTING_KEY,
  automaticNoShowCutoff,
  isEligibleForAutomaticNoShow,
} from "@/src/services/planner-no-show-policy";

export {
  AUTO_NO_SHOW_AFTER_HOURS,
  AUTO_NO_SHOW_AFTER_MS,
  AUTO_NO_SHOW_BATCH_SIZE,
  AUTO_NO_SHOW_ROLLOUT_SETTING_KEY,
  automaticNoShowCutoff,
  isEligibleForAutomaticNoShow,
} from "@/src/services/planner-no-show-policy";

export type AutoNoShowRun = {
  checked: number;
  updated: number;
  appointmentIds: string[];
  cutoff: string;
  rolloutAt: string;
  ranAt: string;
};

/**
 * Moves only untouched BOOKED appointments older than 24 hours to NO_SHOW.
 *
 * Each update repeats the eligibility predicates so a concurrent arrival,
 * cancellation, reschedule, or manual decision wins over the background worker.
 */
export async function markExpiredBookedAppointmentsAsNoShow(
  now = new Date(),
  requestedLimit = AUTO_NO_SHOW_BATCH_SIZE,
): Promise<AutoNoShowRun> {
  const prisma = getPrisma();
  const rolloutSetting = await prisma.crmSetting.upsert({
    where: { key: AUTO_NO_SHOW_ROLLOUT_SETTING_KEY },
    create: {
      key: AUTO_NO_SHOW_ROLLOUT_SETTING_KEY,
      value: { enabledAt: now.toISOString() },
    },
    update: {},
    select: { value: true },
  });
  const enabledAtValue = rolloutSetting.value && typeof rolloutSetting.value === "object" && !Array.isArray(rolloutSetting.value)
    ? (rolloutSetting.value as { enabledAt?: unknown }).enabledAt
    : null;
  const enabledAt = typeof enabledAtValue === "string" ? new Date(enabledAtValue) : null;
  if (!enabledAt || !Number.isFinite(enabledAt.getTime())) {
    throw new Error("INVALID_AUTO_NO_SHOW_ROLLOUT_SETTING");
  }

  const cutoff = automaticNoShowCutoff(now);
  const limit = Math.min(
    AUTO_NO_SHOW_BATCH_SIZE,
    Math.max(1, Math.floor(Number(requestedLimit) || AUTO_NO_SHOW_BATCH_SIZE)),
  );

  const candidates = await prisma.serviceAppointment.findMany({
    where: {
      status: PlannerAppointmentStatus.BOOKED,
      plannedStartAt: { gte: enabledAt, lte: cutoff },
      actualArrivalAt: null,
      actualStartAt: null,
      actualEndAt: null,
      noShowAt: null,
      NOT: { id: { startsWith: "demo_" } },
    },
    select: { id: true },
    orderBy: { plannedStartAt: "asc" },
    take: limit,
  });

  if (!candidates.length) {
    return {
      checked: 0,
      updated: 0,
      appointmentIds: [],
      cutoff: cutoff.toISOString(),
      rolloutAt: enabledAt.toISOString(),
      ranAt: now.toISOString(),
    };
  }

  const results = await prisma.$transaction(
    candidates.map((candidate) =>
      prisma.serviceAppointment.updateMany({
        where: {
          id: candidate.id,
          status: PlannerAppointmentStatus.BOOKED,
          plannedStartAt: { gte: enabledAt, lte: cutoff },
          actualArrivalAt: null,
          actualStartAt: null,
          actualEndAt: null,
          noShowAt: null,
        },
        data: {
          status: PlannerAppointmentStatus.NO_SHOW,
          noShowAt: now,
        },
      }),
    ),
  );

  const appointmentIds = candidates
    .filter((_, index) => results[index]?.count === 1)
    .map((candidate) => candidate.id);

  return {
    checked: candidates.length,
    updated: appointmentIds.length,
    appointmentIds,
    cutoff: cutoff.toISOString(),
    rolloutAt: enabledAt.toISOString(),
    ranAt: now.toISOString(),
  };
}
