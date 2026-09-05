import { PlannerAppointmentStatus } from "@/src/generated/prisma/client";

export const AUTO_NO_SHOW_AFTER_HOURS = 24;
export const AUTO_NO_SHOW_AFTER_MS = AUTO_NO_SHOW_AFTER_HOURS * 60 * 60 * 1000;
export const AUTO_NO_SHOW_BATCH_SIZE = 250;
export const AUTO_NO_SHOW_ROLLOUT_SETTING_KEY = "planner_auto_no_show_rollout";

export type AppointmentNoShowCandidate = {
  status: PlannerAppointmentStatus | string;
  plannedStartAt: Date;
  actualArrivalAt: Date | null;
  actualStartAt: Date | null;
  actualEndAt: Date | null;
  noShowAt: Date | null;
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
