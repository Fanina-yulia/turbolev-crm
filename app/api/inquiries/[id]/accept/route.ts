import { NextRequest, NextResponse } from "next/server";
import { InquiryState } from "@/src/generated/prisma/client";
import { getPrisma } from "@/src/lib/prisma";
import { getAccessContext, hasPermission } from "@/src/security/access-context";
import { PERMISSIONS } from "@/src/security/permissions";

export const runtime = "nodejs";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const access = await getAccessContext(request);
    if (access.provisioningState !== "ACTIVE" || !access.user) return NextResponse.json({ ok: false, error: "Access denied" }, { status: 401 });
    if (access.enforcementMode === "ENFORCED" && !hasPermission(access, PERMISSIONS.COMMUNICATIONS_WRITE)) return NextResponse.json({ ok: false, error: "Access denied" }, { status: 403 });

    const { id } = await context.params;
    const prisma = getPrisma();
    const result = await prisma.$transaction(async (tx) => {
      const current = await tx.communicationInquiry.findUnique({ where: { id } });
      if (!current) return { kind: "missing" as const };
      if (![InquiryState.NEW, InquiryState.IN_WORK].includes(current.state)) return { kind: "closed" as const };
      if (current.assignedUserId && current.assignedUserId !== access.user!.id) return { kind: "assigned" as const };
      const inquiry = await tx.communicationInquiry.update({
        where: { id },
        data: {
          assignedUserId: access.user!.id,
          state: InquiryState.IN_WORK,
          unread: false,
        },
      });
      return { kind: "ok" as const, inquiry };
    });

    if (result.kind === "missing") return NextResponse.json({ ok: false, error: "Звернення не знайдено" }, { status: 404 });
    if (result.kind === "closed") return NextResponse.json({ ok: false, error: "Звернення вже опрацьовано" }, { status: 409 });
    if (result.kind === "assigned") return NextResponse.json({ ok: false, error: "Звернення вже прийняв інший співробітник" }, { status: 409 });
    return NextResponse.json({ ok: true, inquiry: result.inquiry });
  } catch (error) {
    console.error("POST /api/inquiries/[id]/accept failed", error);
    return NextResponse.json({ ok: false, error: "Не вдалося прийняти звернення" }, { status: 500 });
  }
}
