import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";
import { canAccessWorkOrder } from "@/src/security/work-order-scope";
import { getPrisma } from "@/src/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(request: Request, context: { params: Promise<{ photoId: string }> }) {
  const access = await authorize(PERMISSIONS.WORK_ORDERS_READ, { request, minimumScope: "ASSIGNED" });
  if (!access.allowed) return access.response!;

  const { photoId } = await context.params;
  const prisma = getPrisma();
  const photo = await prisma.workOrderCompletionPhoto.findUnique({
    where: { id: photoId },
    select: { id: true, workOrderId: true, fileName: true, mimeType: true, fileSize: true, fileData: true, updatedAt: true },
  });
  if (!photo) return Response.json({ ok: false, error: "PHOTO_NOT_FOUND" }, { status: 404 });

  const allowed = await canAccessWorkOrder(access.context, access.grantedScope, photo.workOrderId);
  if (!allowed) return Response.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });

  return new Response(Buffer.from(photo.fileData), {
    status: 200,
    headers: {
      "Content-Type": photo.mimeType || "application/octet-stream",
      "Content-Length": String(photo.fileSize),
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(photo.fileName)}`,
      "Cache-Control": "private, max-age=300, must-revalidate",
      "Last-Modified": photo.updatedAt.toUTCString(),
      "X-Content-Type-Options": "nosniff",
    },
  });
}
