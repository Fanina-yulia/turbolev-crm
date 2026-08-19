import { getPrisma } from "@/src/lib/prisma";
import { getAccessContext } from "@/src/security/access-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

function forbidden(status = 403) {
  return Response.json({ ok: false, error: status === 401 ? "UNAUTHENTICATED" : "FORBIDDEN" }, { status });
}

export async function GET(request: Request, context: { params: Promise<{ findingId: string; mediaId: string }> }) {
  const { findingId, mediaId } = await context.params;
  const access = await getAccessContext(request);
  if (!access.authenticated) return forbidden(401);
  if (access.provisioningState !== "ACTIVE" || !access.user) return forbidden(403);

  const prisma = getPrisma();
  const media = await prisma.mechanicWorkFindingMedia.findFirst({
    where: { id: mediaId, findingId },
    include: { finding: { select: { id: true, workOrderId: true, mechanicUserId: true } } },
  });
  if (!media) return Response.json({ ok: false, error: "MEDIA_NOT_FOUND" }, { status: 404 });

  let allowed = media.finding.mechanicUserId === access.user.id;
  const roleCodes = new Set(access.roles.map((role) => role.code));
  if (!allowed && (roleCodes.has("OWNER") || roleCodes.has("EXECUTIVE_DIRECTOR"))) allowed = true;

  if (!allowed && (roleCodes.has("SERVICE_ADVISOR") || roleCodes.has("STATION_MANAGER"))) {
    const roleLocationIds = access.roles
      .filter((role) => ["SERVICE_ADVISOR", "STATION_MANAGER"].includes(role.code) && role.locationId)
      .map((role) => role.locationId as string);
    const locationIds = Array.from(new Set([...access.locationIds, ...roleLocationIds]));
    if (locationIds.length) {
      const appointment = await prisma.serviceAppointment.findFirst({
        where: { workOrderId: media.finding.workOrderId, locationId: { in: locationIds } },
        select: { id: true },
      });
      allowed = Boolean(appointment);
    }
  }

  if (!allowed) return forbidden(403);

  return new Response(media.fileData, {
    status: 200,
    headers: {
      "Content-Type": media.mimeType,
      "Content-Length": String(media.fileSize),
      "Content-Disposition": `inline; filename="${media.fileName.replace(/[\r\n"\\]/g, "_")}"`,
      "Cache-Control": "private, max-age=300",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
