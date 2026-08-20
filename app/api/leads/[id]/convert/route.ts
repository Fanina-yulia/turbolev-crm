import { after, NextResponse } from "next/server";
import {
  convertLead,
  LeadConflictError,
  LeadNotFoundError,
} from "@/src/services/leads.service";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";
import { autoGenerateVehicleImage } from "@/src/services/vehicle-images/vehicle-image-auto.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 100;

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  const access = await authorize(PERMISSIONS.LEADS_WRITE, { request, minimumScope: "TEAM" });
  if (!access.allowed) return access.response!;

  try {
    const { id } = await context.params;
    const result = await convertLead(id, access.context.user?.name || "CRM");

    if (result.vehicle.brand && result.vehicle.model) {
      after(async () => {
        try {
          await autoGenerateVehicleImage(result.vehicle.id);
        } catch (error) {
          console.error("background vehicle image generation after lead conversion failed", {
            vehicleId: result.vehicle.id,
            message: error instanceof Error ? error.message : "unknown error",
          });
        }
      });
    }

    return NextResponse.json({ ok: true, ...result }, { status: 201 });
  } catch (error) {
    if (error instanceof LeadNotFoundError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 404 });
    }
    if (error instanceof LeadConflictError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 409 });
    }

    console.error("POST /api/leads/[id]/convert failed", {
      message: error instanceof Error ? error.message : "unknown error",
    });
    return NextResponse.json({ ok: false, error: "Failed to convert lead" }, { status: 500 });
  }
}
