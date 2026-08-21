import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/src/generated/prisma/client";
import { getPrisma } from "@/src/lib/prisma";
import { PERMISSIONS } from "@/src/security/permissions";
import { authorizeScopedLocation } from "@/src/security/scoped-location-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type MoneyAccountType = "CASH" | "BANK" | "CARD" | "ACQUIRING" | "OTHER";
const ACCOUNT_TYPES = new Set<MoneyAccountType>(["CASH", "BANK", "CARD", "ACQUIRING", "OTHER"]);

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function isAccountType(value: string): value is MoneyAccountType {
  return ACCOUNT_TYPES.has(value as MoneyAccountType);
}

function parseOpeningBalance(value: unknown) {
  if (value == null || value === "") return new Prisma.Decimal(0);
  if (typeof value !== "number" && typeof value !== "string") throw new Error("INVALID_OPENING_BALANCE");
  try {
    const amount = new Prisma.Decimal(String(value)).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    if (!amount.isFinite()) throw new Error("INVALID_OPENING_BALANCE");
    return amount;
  } catch {
    throw new Error("INVALID_OPENING_BALANCE");
  }
}

export async function GET(request: NextRequest) {
  const requestedLocationId = request.nextUrl.searchParams.get("locationId")?.trim() || null;
  const access = await authorizeScopedLocation(PERMISSIONS.FINANCE_READ, request, requestedLocationId);
  if (!access.ok) return access.response;

  try {
    const prisma = getPrisma();
    const accounts = await prisma.moneyAccount.findMany({
      where: access.locationWhere,
      orderBy: [{ isActive: "desc" }, { sortOrder: "asc" }, { name: "asc" }],
    });
    return NextResponse.json({ ok: true, accounts }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[finance-accounts:get]", error);
    return NextResponse.json({ ok: false, error: "ACCOUNTS_LOAD_FAILED" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = asRecord(await request.json().catch(() => null));
    if (!body) {
      return NextResponse.json({ ok: false, error: "INVALID_JSON_BODY" }, { status: 400 });
    }

    const name = typeof body.name === "string" ? body.name.trim() : "";
    const type = typeof body.type === "string" ? body.type.trim().toUpperCase() : "";
    const currency = typeof body.currency === "string" && body.currency.trim()
      ? body.currency.trim().toUpperCase()
      : "UAH";
    const locationId = typeof body.locationId === "string" && body.locationId.trim() ? body.locationId.trim() : null;
    const openingBalance = parseOpeningBalance(body.openingBalance);
    const openingBalanceAt = typeof body.openingBalanceAt === "string" && body.openingBalanceAt
      ? new Date(body.openingBalanceAt)
      : new Date();

    const access = await authorizeScopedLocation(PERMISSIONS.FINANCE_WRITE, request, locationId);
    if (!access.ok) return access.response;

    if (!name) return NextResponse.json({ ok: false, error: "NAME_REQUIRED" }, { status: 400 });
    if (!isAccountType(type)) return NextResponse.json({ ok: false, error: "INVALID_ACCOUNT_TYPE" }, { status: 400 });
    if (!/^[A-Z]{3}$/.test(currency)) return NextResponse.json({ ok: false, error: "INVALID_CURRENCY" }, { status: 400 });
    if (Number.isNaN(openingBalanceAt.getTime())) return NextResponse.json({ ok: false, error: "INVALID_OPENING_DATE" }, { status: 400 });

    const prisma = getPrisma();
    if (locationId) {
      const location = await prisma.serviceLocation.findUnique({ where: { id: locationId }, select: { id: true } });
      if (!location) return NextResponse.json({ ok: false, error: "LOCATION_NOT_FOUND" }, { status: 404 });
    }

    const account = await prisma.moneyAccount.create({
      data: {
        name: name.slice(0, 160),
        type,
        currency,
        openingBalance,
        openingBalanceAt,
        locationId,
      },
    });

    await prisma.auditEvent.create({
      data: {
        actorName: access.context.user?.name || access.context.user?.email || "CRM / Фінанси",
        entityType: "MoneyAccount",
        entityId: account.id,
        action: "MONEY_ACCOUNT_CREATED",
        after: {
          id: account.id,
          name: account.name,
          type: account.type,
          currency: account.currency,
          openingBalance: account.openingBalance.toString(),
          openingBalanceAt: account.openingBalanceAt.toISOString(),
          locationId: account.locationId,
        },
      },
    });

    return NextResponse.json({ ok: true, account }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === "INVALID_OPENING_BALANCE") {
      return NextResponse.json({ ok: false, error: "INVALID_OPENING_BALANCE" }, { status: 400 });
    }
    console.error("[finance-accounts:post]", error);
    return NextResponse.json({ ok: false, error: "ACCOUNT_CREATE_FAILED" }, { status: 500 });
  }
}
