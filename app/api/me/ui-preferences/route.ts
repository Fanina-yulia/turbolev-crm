import { NextResponse } from "next/server";
import {
  MechanicControlScale,
  MechanicInterfaceContrast,
  MechanicSpacing,
  MechanicTextMode,
  MechanicTextScale,
} from "@/src/generated/prisma/client";
import { getPrisma } from "@/src/lib/prisma";
import { getAccessContext } from "@/src/security/access-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function currentUser(request: Request) {
  const context = await getAccessContext(request);
  if (!context.authenticated || !context.user) return null;
  return context.user;
}

function pickEnum<T extends string>(values: readonly T[], value: unknown, fallback: T): T {
  const normalized = String(value || "").trim().toUpperCase() as T;
  return values.includes(normalized) ? normalized : fallback;
}

export async function GET(request: Request) {
  const user = await currentUser(request);
  if (!user) return NextResponse.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 });
  const prisma = getPrisma();
  const preferences = await prisma.userUiPreference.upsert({
    where: { userId: user.id },
    create: { userId: user.id },
    update: {},
  });
  return NextResponse.json({ ok: true, preferences }, { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(request: Request) {
  const user = await currentUser(request);
  if (!user) return NextResponse.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 });
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const prisma = getPrisma();
  const preferences = await prisma.userUiPreference.upsert({
    where: { userId: user.id },
    create: {
      userId: user.id,
      textScale: pickEnum(Object.values(MechanicTextScale), body.textScale, MechanicTextScale.M),
      controlScale: pickEnum(Object.values(MechanicControlScale), body.controlScale, MechanicControlScale.STANDARD),
      textMode: pickEnum(Object.values(MechanicTextMode), body.textMode, MechanicTextMode.STANDARD),
      interfaceContrast: pickEnum(Object.values(MechanicInterfaceContrast), body.interfaceContrast, MechanicInterfaceContrast.NORMAL),
      spacing: pickEnum(Object.values(MechanicSpacing), body.spacing, MechanicSpacing.NORMAL),
      largeTouchTargets: body.largeTouchTargets !== false,
    },
    update: {
      textScale: pickEnum(Object.values(MechanicTextScale), body.textScale, MechanicTextScale.M),
      controlScale: pickEnum(Object.values(MechanicControlScale), body.controlScale, MechanicControlScale.STANDARD),
      textMode: pickEnum(Object.values(MechanicTextMode), body.textMode, MechanicTextMode.STANDARD),
      interfaceContrast: pickEnum(Object.values(MechanicInterfaceContrast), body.interfaceContrast, MechanicInterfaceContrast.NORMAL),
      spacing: pickEnum(Object.values(MechanicSpacing), body.spacing, MechanicSpacing.NORMAL),
      largeTouchTargets: body.largeTouchTargets !== false,
    },
  });
  return NextResponse.json({ ok: true, preferences });
}
