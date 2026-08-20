import { NextRequest, NextResponse } from "next/server";
import { InquiryState, LeadStatus } from "@/src/generated/prisma/client";
import { getPrisma } from "@/src/lib/prisma";
import { getAccessContext, hasPermission } from "@/src/security/access-context";
import { PERMISSIONS } from "@/src/security/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function normalizePhone(value?: string | null) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length === 10 && digits.startsWith("0")) return `38${digits}`;
  return digits;
}

function priorityFor(item: { channel: string; subject: string; preview: string; receivedAt: Date; metadata: unknown }) {
  if (item.metadata && typeof item.metadata === "object" && !Array.isArray(item.metadata)) {
    const priority = String((item.metadata as Record<string, unknown>).priority || "").toUpperCase();
    if (["CRITICAL", "HIGH", "MEDIUM", "LOW"].includes(priority)) return priority;
  }
  const text = `${item.subject} ${item.preview}`.toLocaleLowerCase("uk-UA");
  if (item.channel === "BINOTEL" && text.includes("пропущ")) return "CRITICAL";
  const ageMinutes = (Date.now() - item.receivedAt.getTime()) / 60_000;
  if (ageMinutes >= 30) return "HIGH";
  return "MEDIUM";
}

export async function GET(request: NextRequest) {
  try {
    const access = await getAccessContext(request);
    if (access.provisioningState !== "ACTIVE" || !access.user) return NextResponse.json({ ok: false, error: "Access denied" }, { status: 401 });
    if (access.enforcementMode === "ENFORCED" && !hasPermission(access, PERMISSIONS.COMMUNICATIONS_READ)) return NextResponse.json({ ok: false, error: "Access denied" }, { status: 403 });

    const prisma = getPrisma();
    const inquiries = await prisma.communicationInquiry.findMany({
      where: { state: InquiryState.NEW },
      include: {
        lead: { select: { id: true, name: true, status: true, assignedUserId: true } },
        assignedUser: { select: { id: true, name: true } },
      },
      orderBy: { receivedAt: "desc" },
      take: 250,
    });

    const phones = [...new Set(inquiries.map((item) => normalizePhone(item.phoneNormalized || item.phone)).filter(Boolean))];
    const [clients, clientPhones, activeLeads] = phones.length ? await Promise.all([
      prisma.client.findMany({ where: { phoneNormalized: { in: phones } }, select: { id: true, name: true, phoneNormalized: true } }),
      prisma.clientPhone.findMany({ where: { phoneNormalized: { in: phones } }, select: { phoneNormalized: true, clientId: true } }),
      prisma.lead.findMany({
        where: {
          phoneNormalized: { in: phones },
          status: { notIn: [LeadStatus.ARRIVED, LeadStatus.LOST, LeadStatus.REJECTED, LeadStatus.SPAM_WRONG, LeadStatus.SUPPLIER_PARTNER] },
        },
        select: { id: true, name: true, phoneNormalized: true, status: true, assignedUserId: true, updatedAt: true },
        orderBy: { updatedAt: "desc" },
      }),
    ]) : [[], [], []];

    const clientMap = new Map<string, { id: string; name: string | null }>();
    for (const client of clients) clientMap.set(client.phoneNormalized, { id: client.id, name: client.name });
    if (clientPhones.length) {
      const linkedIds = [...new Set(clientPhones.map((item) => item.clientId))];
      const linkedClients = linkedIds.length ? await prisma.client.findMany({ where: { id: { in: linkedIds } }, select: { id: true, name: true } }) : [];
      const byId = new Map(linkedClients.map((client) => [client.id, client]));
      for (const phone of clientPhones) {
        const client = byId.get(phone.clientId);
        if (client && !clientMap.has(phone.phoneNormalized)) clientMap.set(phone.phoneNormalized, { id: client.id, name: client.name });
      }
    }

    const leadMap = new Map<string, (typeof activeLeads)[number]>();
    for (const lead of activeLeads) if (!leadMap.has(lead.phoneNormalized)) leadMap.set(lead.phoneNormalized, lead);
    const clientIds = [...new Set([...clientMap.values()].map((item) => item.id))];
    const vehicles = clientIds.length ? await prisma.vehicle.findMany({
      where: { clientId: { in: clientIds } },
      select: { id: true, clientId: true, brand: true, model: true, year: true, plateNumber: true, vin: true },
      orderBy: { updatedAt: "desc" },
    }) : [];
    const vehiclesByClient = new Map<string, typeof vehicles>();
    for (const vehicle of vehicles) {
      const list = vehiclesByClient.get(vehicle.clientId) || [];
      list.push(vehicle);
      vehiclesByClient.set(vehicle.clientId, list);
    }

    const items = inquiries.map((item) => {
      const phoneKey = normalizePhone(item.phoneNormalized || item.phone);
      const client = phoneKey ? clientMap.get(phoneKey) || null : null;
      const duplicateLead = item.lead || (phoneKey ? leadMap.get(phoneKey) || null : null);
      return {
        id: item.id,
        channel: item.channel,
        state: item.state,
        name: client?.name || item.name || "Без імені",
        phone: item.phone,
        handle: item.handle,
        subject: item.subject,
        preview: item.preview,
        vehicle: item.vehicle,
        plate: item.plate,
        receivedAt: item.receivedAt,
        sourceDetail: item.sourceDetail,
        campaign: item.campaign,
        assignedUser: item.assignedUser,
        priority: priorityFor(item),
        existingClient: client,
        vehicles: client ? (vehiclesByClient.get(client.id) || []).slice(0, 4) : [],
        existingLead: duplicateLead ? {
          id: duplicateLead.id,
          name: duplicateLead.name,
          status: duplicateLead.status,
          assignedUserId: duplicateLead.assignedUserId,
        } : null,
      };
    });

    return NextResponse.json({
      ok: true,
      items,
      stats: {
        total: items.length,
        critical: items.filter((item) => item.priority === "CRITICAL").length,
        high: items.filter((item) => item.priority === "HIGH").length,
        existingClients: items.filter((item) => item.existingClient).length,
        withActiveLead: items.filter((item) => item.existingLead).length,
      },
    });
  } catch (error) {
    console.error("GET /api/inquiries failed", error);
    return NextResponse.json({ ok: false, error: "Не вдалося завантажити нові звернення" }, { status: 500 });
  }
}
