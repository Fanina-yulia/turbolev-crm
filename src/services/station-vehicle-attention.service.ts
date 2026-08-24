import "server-only";

import { PlannerAppointmentStatus } from "@/src/generated/prisma/client";
import { getPrisma } from "@/src/lib/prisma";

const MINUTE_MS = 60_000;

export type StationVehicleAttentionLevel = "CRITICAL" | "HIGH" | "MEDIUM";

export type StationVehicleAttentionIssue = {
  code: string;
  title: string;
  reason: string;
  action: string;
  level: StationVehicleAttentionLevel;
  dueAt: string;
};

export type StationAttentionVehicle = {
  id: string;
  appointmentId: string;
  clientId: string | null;
  vehicleId: string | null;
  workOrderId: string | null;
  plate: string;
  vehicle: string;
  status: string;
  problem: string | null;
  plannedStartAt: string;
  plannedEndAt: string;
  post: string | null;
  mechanic: string | null;
  attentionLevel: StationVehicleAttentionLevel;
  attentionTitle: string;
  attentionReason: string;
  nextAction: string;
  attentionAt: string;
  issueCount: number;
  issues: StationVehicleAttentionIssue[];
};

type IssueDraft = Omit<StationVehicleAttentionIssue, "dueAt"> & { dueAt: Date };

const ACTIVE_STATUSES: PlannerAppointmentStatus[] = [
  PlannerAppointmentStatus.BOOKED,
  PlannerAppointmentStatus.ARRIVED,
  PlannerAppointmentStatus.DIAGNOSTICS,
  PlannerAppointmentStatus.WAITING_PARTS_SELECTION,
  PlannerAppointmentStatus.WAITING_CALCULATION,
  PlannerAppointmentStatus.WAITING_APPROVAL,
  PlannerAppointmentStatus.WAITING_PARTS,
  PlannerAppointmentStatus.READY_FOR_REPAIR,
  PlannerAppointmentStatus.IN_REPAIR,
  PlannerAppointmentStatus.WAITING_QC,
  PlannerAppointmentStatus.WAITING_PAYMENT,
  PlannerAppointmentStatus.READY_FOR_PICKUP,
  PlannerAppointmentStatus.WARRANTY,
  PlannerAppointmentStatus.PAUSED,
  PlannerAppointmentStatus.NO_SHOW,
];

const PHYSICAL_WORK_STATUSES = new Set<PlannerAppointmentStatus>([
  PlannerAppointmentStatus.ARRIVED,
  PlannerAppointmentStatus.DIAGNOSTICS,
  PlannerAppointmentStatus.READY_FOR_REPAIR,
  PlannerAppointmentStatus.IN_REPAIR,
  PlannerAppointmentStatus.WAITING_QC,
  PlannerAppointmentStatus.PAUSED,
  PlannerAppointmentStatus.WARRANTY,
]);

function minutesBetween(from: Date, to: Date) {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / MINUTE_MS));
}

function humanDelay(minutes: number) {
  if (minutes < 60) return `${Math.max(1, minutes)} хв`;
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  if (hours < 24) return restMinutes ? `${hours} год ${restMinutes} хв` : `${hours} год`;
  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return restHours ? `${days} д ${restHours} год` : `${days} д`;
}

function levelRank(level: StationVehicleAttentionLevel) {
  return level === "CRITICAL" ? 0 : level === "HIGH" ? 1 : 2;
}

function addIssue(items: IssueDraft[], issue: IssueDraft, now: Date) {
  if (issue.dueAt.getTime() > now.getTime()) return;
  items.push(issue);
}

function overdueLevel(dueAt: Date, now: Date, criticalAfterMinutes: number): StationVehicleAttentionLevel {
  return minutesBetween(dueAt, now) >= criticalAfterMinutes ? "CRITICAL" : "HIGH";
}

export async function listStationAttentionVehicles(now = new Date(), locationId?: string | null): Promise<StationAttentionVehicle[]> {
  const prisma = getPrisma();
  const rows = await prisma.serviceAppointment.findMany({
    where: {
      ...(locationId ? { locationId } : {}),
      status: { in: ACTIVE_STATUSES },
      NOT: { id: { startsWith: "demo_" } },
    },
    select: {
      id: true,
      clientId: true,
      vehicleId: true,
      workOrderId: true,
      status: true,
      customerName: true,
      vehicleLabel: true,
      plateNumber: true,
      problem: true,
      plannedStartAt: true,
      plannedEndAt: true,
      actualArrivalAt: true,
      actualStartAt: true,
      partsEtaAt: true,
      noShowAt: true,
      updatedAt: true,
      post: { select: { name: true } },
      mechanic: { select: { name: true } },
    },
    orderBy: [{ plannedStartAt: "asc" }],
    take: 500,
  });

  const result: StationAttentionVehicle[] = [];

  for (const row of rows) {
    const issues: IssueDraft[] = [];
    const label = row.plateNumber || row.vehicleLabel || row.customerName || "Авто";
    const status = row.status;

    if (status === PlannerAppointmentStatus.NO_SHOW) {
      const dueAt = row.noShowAt || row.plannedStartAt;
      addIssue(issues, {
        code: "NO_SHOW",
        title: `${label}: no-show`,
        reason: "Клієнт не приїхав на запланований запис. Потрібно зв’язатися та визначити наступну дію.",
        action: "Зв’язатися з клієнтом",
        level: "CRITICAL",
        dueAt,
      }, now);
    }

    if (status === PlannerAppointmentStatus.BOOKED && !row.actualArrivalAt) {
      const dueAt = new Date(row.plannedStartAt.getTime() + 15 * MINUTE_MS);
      if (dueAt <= now) {
        const late = minutesBetween(dueAt, now);
        addIssue(issues, {
          code: "MISSED_ARRIVAL",
          title: `${label}: не підтверджено приїзд`,
          reason: `Запланований час приїзду минув. Авто не позначене як прибуле вже ${humanDelay(late)}.`,
          action: "Уточнити приїзд / статус клієнта",
          level: late >= 60 ? "CRITICAL" : "HIGH",
          dueAt,
        }, now);
      }
    }

    if (status === PlannerAppointmentStatus.ARRIVED && !row.actualStartAt) {
      const anchor = row.actualArrivalAt || row.updatedAt;
      const dueAt = new Date(anchor.getTime() + 15 * MINUTE_MS);
      if (dueAt <= now) {
        const late = minutesBetween(dueAt, now);
        addIssue(issues, {
          code: "ARRIVED_STALLED",
          title: `${label}: авто прибуло, але процес не стартував`,
          reason: `Після прибуття минуло понад 15 хв. Без наступного етапу — ${humanDelay(late)}.`,
          action: "Розпочати діагностику / роботу",
          level: late >= 60 ? "CRITICAL" : "HIGH",
          dueAt,
        }, now);
      }
    }

    if (PHYSICAL_WORK_STATUSES.has(status)) {
      const anchor = row.actualArrivalAt || row.actualStartAt || row.updatedAt;
      const dueAt = new Date(anchor.getTime() + 15 * MINUTE_MS);
      if (!row.mechanic) {
        addIssue(issues, {
          code: "NO_MECHANIC",
          title: `${label}: немає відповідального механіка`,
          reason: "Авто вже в операційному процесі, але відповідальний механік не призначений.",
          action: "Призначити механіка",
          level: overdueLevel(dueAt, now, 60),
          dueAt,
        }, now);
      }
      if (!row.post) {
        addIssue(issues, {
          code: "NO_POST",
          title: `${label}: авто не закріплене за постом`,
          reason: "Активне авто не має визначеного сервісного поста.",
          action: "Призначити пост",
          level: overdueLevel(dueAt, now, 60),
          dueAt,
        }, now);
      }
    }

    if (status === PlannerAppointmentStatus.WAITING_PARTS_SELECTION) {
      const dueAt = new Date(row.updatedAt.getTime() + 30 * MINUTE_MS);
      addIssue(issues, {
        code: "PARTS_SELECTION_STALLED",
        title: `${label}: завис підбір деталей`,
        reason: "Підбір запчастин не завершений протягом 30 хв після переходу на цей етап.",
        action: "Завершити підбір деталей",
        level: overdueLevel(dueAt, now, 120),
        dueAt,
      }, now);
    }

    if (status === PlannerAppointmentStatus.WAITING_CALCULATION) {
      const dueAt = new Date(row.updatedAt.getTime() + 30 * MINUTE_MS);
      addIssue(issues, {
        code: "CALCULATION_STALLED",
        title: `${label}: завис розрахунок`,
        reason: "Розрахунок робіт/кошторис не завершений протягом 30 хв.",
        action: "Завершити розрахунок",
        level: overdueLevel(dueAt, now, 120),
        dueAt,
      }, now);
    }

    if (status === PlannerAppointmentStatus.WAITING_APPROVAL) {
      const dueAt = new Date(row.updatedAt.getTime() + 60 * MINUTE_MS);
      addIssue(issues, {
        code: "APPROVAL_STALLED",
        title: `${label}: очікує погодження клієнта`,
        reason: "Рішення клієнта не зафіксовано протягом години після відправлення/переходу на погодження.",
        action: "Отримати рішення клієнта",
        level: overdueLevel(dueAt, now, 240),
        dueAt,
      }, now);
    }

    if (status === PlannerAppointmentStatus.WAITING_PARTS) {
      if (row.partsEtaAt) {
        if (row.partsEtaAt <= now) {
          addIssue(issues, {
            code: "PARTS_ETA_OVERDUE",
            title: `${label}: прострочена поставка деталей`,
            reason: `Очікуваний час поставки минув ${humanDelay(minutesBetween(row.partsEtaAt, now))} тому, але авто все ще чекає деталі.`,
            action: "Уточнити поставку / новий ETA",
            level: overdueLevel(row.partsEtaAt, now, 240),
            dueAt: row.partsEtaAt,
          }, now);
        }
      } else {
        const dueAt = new Date(row.updatedAt.getTime() + 120 * MINUTE_MS);
        addIssue(issues, {
          code: "PARTS_ETA_MISSING",
          title: `${label}: немає ETA деталей`,
          reason: "Авто очікує запчастини понад 2 години, але очікуваний час поставки не встановлений.",
          action: "Встановити ETA деталей",
          level: overdueLevel(dueAt, now, 360),
          dueAt,
        }, now);
      }
    }

    if (status === PlannerAppointmentStatus.READY_FOR_REPAIR) {
      const dueAt = new Date(row.updatedAt.getTime() + 30 * MINUTE_MS);
      addIssue(issues, {
        code: "READY_FOR_REPAIR_STALLED",
        title: `${label}: готове до ремонту, але ремонт не стартував`,
        reason: "Усі передумови для ремонту виконані, але статус не перейшов у роботу протягом 30 хв.",
        action: "Запустити ремонт",
        level: overdueLevel(dueAt, now, 120),
        dueAt,
      }, now);
    }

    if (status === PlannerAppointmentStatus.IN_REPAIR && row.plannedEndAt <= now) {
      addIssue(issues, {
        code: "REPAIR_OVERRUN",
        title: `${label}: ремонт вийшов за плановий час`,
        reason: `Плановий час завершення ремонту минув ${humanDelay(minutesBetween(row.plannedEndAt, now))} тому.`,
        action: "Перевірити стан ремонту",
        level: overdueLevel(row.plannedEndAt, now, 120),
        dueAt: row.plannedEndAt,
      }, now);
    }

    if (status === PlannerAppointmentStatus.WAITING_QC) {
      const dueAt = new Date(row.updatedAt.getTime() + 30 * MINUTE_MS);
      addIssue(issues, {
        code: "QC_STALLED",
        title: `${label}: очікує контроль якості`,
        reason: "Авто очікує QC понад 30 хв без переходу далі.",
        action: "Провести контроль якості",
        level: overdueLevel(dueAt, now, 120),
        dueAt,
      }, now);
    }

    if (status === PlannerAppointmentStatus.WAITING_PAYMENT) {
      const dueAt = new Date(row.updatedAt.getTime() + 60 * MINUTE_MS);
      addIssue(issues, {
        code: "PAYMENT_STALLED",
        title: `${label}: очікує оплату`,
        reason: "Оплата/закриття розрахунку не зафіксовані протягом години.",
        action: "Закрити оплату",
        level: overdueLevel(dueAt, now, 240),
        dueAt,
      }, now);
    }

    if (status === PlannerAppointmentStatus.READY_FOR_PICKUP) {
      const dueAt = new Date(row.updatedAt.getTime() + 60 * MINUTE_MS);
      addIssue(issues, {
        code: "PICKUP_STALLED",
        title: `${label}: готове авто очікує видачі`,
        reason: "Авто готове до видачі понад годину, але процес не завершений.",
        action: "Зв’язатися з клієнтом / видати авто",
        level: overdueLevel(dueAt, now, 240),
        dueAt,
      }, now);
    }

    if (status === PlannerAppointmentStatus.PAUSED) {
      const dueAt = new Date(row.updatedAt.getTime() + 120 * MINUTE_MS);
      addIssue(issues, {
        code: "PAUSED_STALLED",
        title: `${label}: робота стоїть на паузі`,
        reason: "Статус PAUSED не змінювався понад 2 години. Потрібне рішення або новий план.",
        action: "Прийняти рішення по паузі",
        level: overdueLevel(dueAt, now, 360),
        dueAt,
      }, now);
    }

    if (status === PlannerAppointmentStatus.WARRANTY) {
      const dueAt = new Date(row.updatedAt.getTime() + 30 * MINUTE_MS);
      addIssue(issues, {
        code: "WARRANTY_OPEN",
        title: `${label}: гарантійне звернення`,
        reason: "Гарантійний кейс є винятком із звичайного потоку і має залишатися під контролем до рішення.",
        action: "Опрацювати гарантійний кейс",
        level: overdueLevel(dueAt, now, 180),
        dueAt,
      }, now);
    }

    const planOverrunStatuses = new Set<PlannerAppointmentStatus>([
      PlannerAppointmentStatus.ARRIVED,
      PlannerAppointmentStatus.DIAGNOSTICS,
      PlannerAppointmentStatus.WAITING_PARTS_SELECTION,
      PlannerAppointmentStatus.WAITING_CALCULATION,
      PlannerAppointmentStatus.WAITING_APPROVAL,
      PlannerAppointmentStatus.READY_FOR_REPAIR,
      PlannerAppointmentStatus.WAITING_QC,
      PlannerAppointmentStatus.PAUSED,
      PlannerAppointmentStatus.WARRANTY,
    ]);
    if (planOverrunStatuses.has(status) && row.plannedEndAt <= now) {
      addIssue(issues, {
        code: "PLAN_OVERRUN",
        title: `${label}: авто вийшло за плановий час`,
        reason: `Плановий час етапу завершився ${humanDelay(minutesBetween(row.plannedEndAt, now))} тому, але авто досі не перейшло далі.`,
        action: "Перевірити та визначити наступну дію",
        level: overdueLevel(row.plannedEndAt, now, 120),
        dueAt: row.plannedEndAt,
      }, now);
    }

    if (!issues.length) continue;

    issues.sort((a, b) => levelRank(a.level) - levelRank(b.level) || a.dueAt.getTime() - b.dueAt.getTime());
    const primary = issues[0];
    result.push({
      id: row.id,
      appointmentId: row.id,
      clientId: row.clientId,
      vehicleId: row.vehicleId,
      workOrderId: row.workOrderId,
      plate: row.plateNumber || "БЕЗ НОМЕРА",
      vehicle: row.vehicleLabel || "Автомобіль",
      status: row.status,
      problem: row.problem,
      plannedStartAt: row.plannedStartAt.toISOString(),
      plannedEndAt: row.plannedEndAt.toISOString(),
      post: row.post?.name || null,
      mechanic: row.mechanic?.name || null,
      attentionLevel: primary.level,
      attentionTitle: primary.title,
      attentionReason: primary.reason,
      nextAction: primary.action,
      attentionAt: primary.dueAt.toISOString(),
      issueCount: issues.length,
      issues: issues.map((issue) => ({ ...issue, dueAt: issue.dueAt.toISOString() })),
    });
  }

  result.sort((a, b) => {
    const level = levelRank(a.attentionLevel) - levelRank(b.attentionLevel);
    if (level) return level;
    return new Date(a.attentionAt).getTime() - new Date(b.attentionAt).getTime();
  });

  return result.slice(0, 30);
}
