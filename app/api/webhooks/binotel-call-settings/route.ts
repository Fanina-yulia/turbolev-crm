import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { LeadStatus } from "@/src/generated/prisma/client";
import { getPrisma } from "@/src/lib/prisma";
import { normalizePhone, phoneVariants } from "@/src/lib/phone";
import { getIntegrationCredential } from "@/src/services/integration-credentials.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACTIVE_LEAD_STATUSES: LeadStatus[] = [
  LeadStatus.NEW,
  LeadStatus.CONTACTED,
  LeadStatus.QUALIFIED,
  LeadStatus.ESTIMATE,
  LeadStatus.WAITING,
  LeadStatus.NO_ANSWER,
  LeadStatus.BOOKED,
  LeadStatus.ARRIVED,
  LeadStatus.QUALIFYING,
  LeadStatus.WARM_LEAD,
];

function secureEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

async function webhookToken() {
  const stored = await getIntegrationCredential("BINOTEL").catch(() => null);
  return stored?.webhookToken?.trim() || process.env.BINOTEL_WEBHOOK_TOKEN?.trim() || "";
}

async function readBody(request: NextRequest): Promise<Record<string, string>> {
  const contentType = request.headers.get("content-type")?.toLowerCase() || "";
  if (contentType.includes("application/json")) {
    const body = await request.json().catch(() => ({}));
    if (!body || typeof body !== "object" || Array.isArray(body)) return {};
    return Object.fromEntries(
      Object.entries(body as Record<string, unknown>)
        .filter(([, value]) => typeof value === "string" || typeof value === "number")
        .map(([key, value]) => [key, String(value)]),
    );
  }

  const form = await request.formData().catch(() => null);
  if (!form) return {};
  const result: Record<string, string> = {};
  for (const [key, value] of form.entries()) {
    if (typeof value === "string") result[key] = value;
  }
  return result;
}

function trimForBinotel(value: string | null | undefined, limit: number): string | undefined {
  const text = value?.trim();
  if (!text) return undefined;
  return text.slice(0, limit);
}

export async function POST(request: NextRequest) {
  const expected = await webhookToken();
  if (process.env.NODE_ENV === "production" && !expected) {
    return NextResponse.json({ status: "error", error: "BINOTEL_WEBHOOK_TOKEN_MISSING" }, { status: 503 });
  }

  const supplied = request.headers.get("x-binotel-webhook-token")?.trim()
    || request.nextUrl.searchParams.get("token")?.trim()
    || "";
  const authorized = expected ? Boolean(supplied && secureEqual(supplied, expected)) : process.env.NODE_ENV !== "production";
  if (!authorized) return NextResponse.json({ status: "error" }, { status: 401 });

  const body = await readBody(request);
  const requestType = (body.requestType || "apiCallSettings").trim();
  if (requestType && requestType.toLowerCase() !== "apicallsettings") {
    return NextResponse.json({ status: "error", error: "UNSUPPORTED_REQUEST_TYPE" }, { status: 422 });
  }

  const normalizedNumber = normalizePhone(body.externalNumber || body.srcNumber || "");
  if (!normalizedNumber) return NextResponse.json({}, { headers: { "Cache-Control": "no-store" } });

  const variants = phoneVariants(normalizedNumber);
  const prisma = getPrisma();

  const [client, lead] = await Promise.all([
    prisma.client.findFirst({
      where: {
        OR: [
          { phoneNormalized: normalizedNumber },
          ...(variants.length ? [{ phone: { in: variants } }] : []),
          { phones: { some: { phoneNormalized: normalizedNumber } } },
        ],
      },
      select: { id: true, name: true },
    }),
    prisma.lead.findFirst({
      where: {
        status: { in: ACTIVE_LEAD_STATUSES },
        OR: [
          { phoneNormalized: normalizedNumber },
          ...(variants.length ? [{ phone: { in: variants } }] : []),
        ],
      },
      select: {
        id: true,
        name: true,
        carBrand: true,
        carModel: true,
        assignedUser: { select: { id: true, email: true, internalNumber: true } },
      },
      orderBy: { updatedAt: "desc" },
    }),
  ]);

  let manager = lead?.assignedUser || null;
  if (!manager) {
    const previousCall = await prisma.callHistory.findFirst({
      where: {
        managerId: { not: null },
        OR: [
          ...(client ? [{ clientId: client.id }] : []),
          { externalNumber: normalizedNumber },
        ],
      },
      select: { manager: { select: { id: true, email: true, internalNumber: true } } },
      orderBy: { createdAt: "desc" },
    });
    manager = previousCall?.manager || null;
  }

  const displayName = trimForBinotel(client?.name || lead?.name || `Клієнт ${body.externalNumber || normalizedNumber}`, 43);
  const vehicle = trimForBinotel([lead?.carBrand, lead?.carModel].filter(Boolean).join(" "), 70);
  const section = client ? "clients" : lead ? "leads" : "communications";
  const origin = request.nextUrl.origin.replace(/\/$/, "");

  return NextResponse.json({
    customerData: {
      ...(displayName ? { name: displayName } : {}),
      ...(vehicle ? { description: vehicle } : {}),
      ...(manager?.email ? { assignedToEmployeeEmail: manager.email } : {}),
      ...(manager?.internalNumber ? { assignedToEmployeeNumber: manager.internalNumber } : {}),
      linkToCrmUrl: `${origin}/?section=${section}`,
      linkToCrmTitle: client ? "Відкрити клієнта в Turbo LEV" : lead ? "Відкрити лід у Turbo LEV" : "Відкрити Turbo LEV CRM",
    },
  }, { headers: { "Cache-Control": "private, no-store" } });
}
