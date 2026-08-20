import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@/src/lib/prisma";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";
import { getTelegramClientState } from "@/src/services/telegram.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const access = await authorize(PERMISSIONS.CLIENTS_READ, { request, minimumScope: "TEAM" });
  if (!access.allowed) return access.response!;

  const rawClientId = (request.nextUrl.searchParams.get("clientId") || "").trim();
  const vehicleId = (request.nextUrl.searchParams.get("vehicleId") || "").trim();
  if (!rawClientId && !vehicleId) return NextResponse.json({ ok: false, error: "CLIENT_OR_VEHICLE_REQUIRED" }, { status: 400 });

  try {
    const prisma = getPrisma();
    const vehicle = vehicleId ? await prisma.vehicle.findUnique({ where: { id: vehicleId }, select: { id: true, clientId: true } }) : null;
    const clientId = rawClientId || vehicle?.clientId || "";
    if (!clientId) return NextResponse.json({ ok: false, error: "CLIENT_NOT_FOUND" }, { status: 404 });

    const client = await prisma.client.findUnique({ where: { id: clientId }, select: { id: true, phone: true, phoneNormalized: true } });
    if (!client) return NextResponse.json({ ok: false, error: "CLIENT_NOT_FOUND" }, { status: 404 });

    const diagnostics = await prisma.diagnosticRequest.findMany({
      where: { clientId, ...(vehicleId ? { vehicleId } : {}) },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      take: 25,
      select: { id: true, vehicleId: true },
    });
    const diagnosticIds = diagnostics.map((item) => item.id);
    const reviews = diagnosticIds.length ? await prisma.diagnosticReview.findMany({
      where: { diagnosticRequestId: { in: diagnosticIds }, state: { in: ["SUBMITTED", "CONFIRMED"] } },
      select: { diagnosticRequestId: true },
    }) : [];
    const shareableIds = new Set(reviews.map((item) => item.diagnosticRequestId));
    const cabinetDiagnostic = diagnostics.find((item) => shareableIds.has(item.id)) || null;
    const cabinetOpened = cabinetDiagnostic ? await prisma.auditEvent.findFirst({
      where: { entityType: "DiagnosticRequest", entityId: cabinetDiagnostic.id, action: "CLIENT_PORTAL_OPENED" },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }) : null;

    const [telegram, viberIdentity, lastCall] = await Promise.all([
      getTelegramClientState(clientId).catch(() => ({ configured: false, linked: false, contact: null })),
      prisma.externalContactIdentity.findFirst({
        where: { clientId, provider: "VIBER" },
        orderBy: { updatedAt: "desc" },
        select: { handle: true, updatedAt: true },
      }).catch(() => null),
      prisma.callHistory.findFirst({ where: { clientId }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    ]);

    const phone = client.phone || (client.phoneNormalized ? `+${client.phoneNormalized}` : "");
    const digits = String(client.phoneNormalized || phone).replace(/\D/g, "");
    const viberChatUri = process.env.VIBER_BOT_CHAT_URI?.trim() || "";
    const viberBotHref = viberChatUri ? `viber://pa?chatURI=${encodeURIComponent(viberChatUri)}&context=${encodeURIComponent(`client_${clientId}`)}` : null;
    const viberDirectHref = digits ? `viber://chat?number=${encodeURIComponent(`+${digits}`)}` : null;

    return NextResponse.json({
      ok: true,
      clientId,
      vehicleId: vehicleId || null,
      phone,
      viber: {
        configured: Boolean(viberChatUri),
        connected: Boolean(viberIdentity),
        active: Boolean(viberIdentity),
        href: viberBotHref || viberDirectHref,
        botHref: viberBotHref,
        fallbackDirect: !viberBotHref && Boolean(viberDirectHref),
        lastActivityAt: viberIdentity?.updatedAt?.toISOString() || null,
      },
      telegram: {
        configured: Boolean(telegram.configured),
        connected: Boolean(telegram.linked),
        active: Boolean(telegram.linked),
        username: telegram.contact?.username || null,
        lastActivityAt: telegram.contact?.lastInboundAt || telegram.contact?.lastOutboundAt || telegram.contact?.linkedAt || null,
      },
      cabinet: {
        available: Boolean(cabinetDiagnostic),
        diagnosticId: cabinetDiagnostic?.id || null,
        active: Boolean(cabinetOpened),
        lastVisitedAt: cabinetOpened?.createdAt?.toISOString() || null,
      },
      phoneChannel: {
        available: Boolean(phone),
        active: Boolean(lastCall),
        lastCallAt: lastCall?.createdAt?.toISOString() || null,
      },
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("GET /api/client-communication/status failed", error);
    return NextResponse.json({ ok: false, error: "CLIENT_COMMUNICATION_STATUS_FAILED" }, { status: 500 });
  }
}
