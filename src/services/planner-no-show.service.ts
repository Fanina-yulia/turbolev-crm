import "server-only";

import { PlannerAppointmentStatus } from "@/src/generated/prisma/client";
import { getPrisma } from "@/src/lib/prisma";

export const AUTO_NO_SHOW_AFTER_HOURS = 24;
export const AUTO_NO_SHOW_AFTER_MS = AUTO_NO_SHOW_AFTER_HOURS * 60 * 60 * 1000;
export const AUTO_NO_SHOW_BATCH_SIZE = 250;

type AppointmentNoShowCandidate = {
  status: PlannerAppointmentStatus | string;
  plannedStartAt: Date;
  actualArrivalAt: Date | null;
  actualStartAt: Date | null;
  actualEndAt: Date | null;
  noShowAt: Date | null;
};

export type AutoNoShowRun = {
  checked: number;
  updated: number;
  appointmentIds: string[];
  cutoff: string;
  ranAt: string;
};

export function automaticNoShowCutoff(now = new Date()) {
  return new Date(now.getTime() - AUTO_NO_SHOW_AFTER_MS);
}

export function isEligibleForAutomaticNoShow(candidate: AppointmentNoShowCandidate, now = new Date()) {
  return candidate.status === PlannerAppointmentStatus.BOOKED
    && candidate.plannedStartAt.getTime() <= automaticNoShowCutoff(now).getTime()
    && !candidate.actualArrivalAt
    && !candidate.actualStartAt
    && !candidate.actualEndAt
    && !candidate.noShowAt;
}

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
  const cutoff = automaticNoShowCutoff(now);
  const limit = Math.min(
    AUTO_NO_SHOW_BATCH_SIZE,
    Math.max(1, Math.floor(Number(requestedLimit) || AUTO_NO_SHOW_BATCH_SIZE)),
  );

  const candidates = await prisma.serviceAppointment.findMany({
    where: {
      status: PlannerAppointmentStatus.BOOKED,
      plannedStartAt: { lte: cutoff },
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
      ranAt: now.toISOString(),
    };
  }

  const results = await prisma.$transaction(
    candidates.map((candidate) =>
      prisma.serviceAppointment.updateMany({
        where: {
          id: candidate.id,
          status: PlannerAppointmentStatus.BOOKED,
          plannedStartAt: { lte: cutoff },
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
    ranAt: now.toISOString(),
  };
}
