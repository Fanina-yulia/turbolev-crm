import { NextRequest } from "next/server";
import {
  CLIENT_PORTAL_SESSION_COOKIE,
  ClientPortalSessionError,
  resolveClientPortalSession,
} from "@/src/services/client-portal-session.service";
import { getClientVehicleFindingMedia } from "@/src/services/client-portal-vehicle.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ vehicleId: string; findingId: string; mediaId: string }> }) {
  try {
    const session = await resolveClientPortalSession(request.cookies.get(CLIENT_PORTAL_SESSION_COOKIE)?.value || null);
    if (!session) return Response.json({ ok: false, message: "Сесія особистого кабінету завершилась." }, { status: 401 });
    const { vehicleId, findingId, mediaId } = await context.params;
    const media = await getClientVehicleFindingMedia(session.clientId, vehicleId, findingId, mediaId);
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
  } catch (error) {
    const known = error instanceof ClientPortalSessionError;
    return Response.json({ ok: false, message: known ? error.message : "Файл недоступний." }, { status: known ? error.status : 500 });
  }
}
