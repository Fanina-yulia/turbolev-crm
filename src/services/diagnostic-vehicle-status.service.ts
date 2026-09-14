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
    where: { vehicleId: { in: ids }, status: { not: "CANCELLED" } },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    select: { id: true, vehicleId: true, status: true, confirmedAt: true, updatedAt: true },
  });

  const latestByVehicle = new Map<string, (typeof requests)[number]>();
  for (const request of requests) {
    if (!latestByVehicle.has(request.vehicleId)) latestByVehicle.set(request.vehicleId, request);
  }

  const requestIds = [...latestByVehicle.values()].map((request) => request.id);
  const [reviews, cards, shares] = requestIds.length
    ? await Promise.all([
        prisma.diagnosticReview.findMany({
          where: { diagnosticRequestId: { in: requestIds } },
          select: { diagnosticRequestId: true, state: true, submittedAt: true, updatedAt: true },
        }),
        prisma.diagnosticCard.findMany({
          where: { diagnosticRequestId: { in: requestIds } },
          select: { diagnosticRequestId: true, currentRevision: true, finalizedAt: true, updatedAt: true },
        }),
        prisma.diagnosticReportShare.findMany({
          where: { diagnosticRequestId: { in: requestIds } },
          orderBy: { createdAt: "desc" },
          select: { diagnosticRequestId: true, createdAt: true },
        }),
      ])
    : [[], [], []];

  const reviewByRequest = new Map(reviews.map((review) => [review.diagnosticRequestId, review]));
  const cardByRequest = new Map(cards.map((card) => [card.diagnosticRequestId, card]));
  const shareByRequest = new Map<string, (typeof shares)[number]>();
  for (const share of shares) {
    if (!shareByRequest.has(share.diagnosticRequestId)) shareByRequest.set(share.diagnosticRequestId, share);
  }

  for (const vehicleId of ids) {
    const request = latestByVehicle.get(vehicleId) || null;
    if (!request) {
      result.set(vehicleId, statusItem("not_created", "Не створена", "neutral", null, null));
      continue;
    }

    const review = reviewByRequest.get(request.id) || null;
    const card = cardByRequest.get(request.id) || null;
    const share = shareByRequest.get(request.id) || null;
    const updatedAt = newestDate(request.updatedAt, review?.submittedAt, review?.updatedAt, card?.updatedAt, share?.createdAt);

    if (share) {
      result.set(vehicleId, statusItem("sent", "Відправлена клієнту", "success", request.id, updatedAt));
      continue;
    }

    const cardExists = Boolean(card)
      || request.status === "CONFIRMED"
      || Boolean(request.confirmedAt)
      || review?.state === "SUBMITTED"
      || review?.state === "RETURNED"
      || review?.state === "CONFIRMED";

    result.set(vehicleId, statusItem(
      cardExists ? "created_not_sent" : "in_progress_not_sent",
      cardExists ? "Не відправлена клієнту" : "Формується · не відправлена",
      "warning",
      request.id,
      updatedAt,
    ));
  }

  return result;
}
