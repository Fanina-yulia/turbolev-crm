import { getPrisma } from "@/src/lib/prisma";
import type { VehicleStatusItem } from "@/src/lib/contracts/crm-core";

function statusItem(
  state: string,
  label: string,
  tone: VehicleStatusItem["tone"],
  targetId: string | null,
  updatedAt: Date | null | undefined,
): VehicleStatusItem {
  return { state, label, tone, targetId, updatedAt: updatedAt ? updatedAt.toISOString() : null };
}

function newestDate(...values: Array<Date | null | undefined>) {
  return values.reduce<Date | null>((latest, value) => {
    if (!value) return latest;
    return !latest || value.getTime() > latest.getTime() ? value : latest;
  }, null);
}

export async function getDiagnosticVehicleStatuses(vehicleIds: string[]) {
  const ids = [...new Set(vehicleIds.filter(Boolean))];
  const result = new Map<string, VehicleStatusItem>();
  if (!ids.length) return result;

  const prisma = getPrisma();
  const requests = await prisma.diagnosticRequest.findMany({
    where: { vehicleId: { in: ids } },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    select: { id: true, vehicleId: true, status: true, confirmedAt: true, updatedAt: true },
  });

  const latestByVehicle = new Map<string, (typeof requests)[number]>();
  for (const request of requests) {
    if (!latestByVehicle.has(request.vehicleId)) latestByVehicle.set(request.vehicleId, request);
  }

  const requestIds = [...latestByVehicle.values()].map((request) => request.id);
  const [reviews, cards] = requestIds.length
    ? await Promise.all([
        prisma.diagnosticReview.findMany({
          where: { diagnosticRequestId: { in: requestIds } },
          select: { diagnosticRequestId: true, state: true, updatedAt: true },
        }),
        prisma.diagnosticCard.findMany({
          where: { diagnosticRequestId: { in: requestIds } },
          select: { diagnosticRequestId: true, currentRevision: true, finalizedAt: true, updatedAt: true },
        }),
      ])
    : [[], []];

  const reviewByRequest = new Map(reviews.map((review) => [review.diagnosticRequestId, review]));
  const cardByRequest = new Map(cards.map((card) => [card.diagnosticRequestId, card]));

  for (const vehicleId of ids) {
    const request = latestByVehicle.get(vehicleId) || null;
    if (!request || request.status === "CANCELLED") {
      result.set(vehicleId, statusItem("not_started", "Не було", "danger", request?.id || null, request?.updatedAt));
      continue;
    }

    const review = reviewByRequest.get(request.id) || null;
    const card = cardByRequest.get(request.id) || null;
    const updatedAt = newestDate(request.updatedAt, review?.updatedAt, card?.updatedAt);

    if (review?.state === "RETURNED") {
      result.set(vehicleId, statusItem("in_progress", "На доопрацюванні", "warning", request.id, updatedAt));
      continue;
    }

    const finalCard = request.status === "CONFIRMED" || Boolean(request.confirmedAt) || Boolean(card?.finalizedAt);
    const reviewCardFormed = review?.state === "SUBMITTED" && Boolean(card && card.currentRevision > 0);
    if (finalCard || reviewCardFormed) {
      result.set(vehicleId, statusItem("completed", "Сформована", "success", request.id, updatedAt));
      continue;
    }

    result.set(vehicleId, statusItem("in_progress", "Триває", "warning", request.id, updatedAt));
  }

  return result;
}
