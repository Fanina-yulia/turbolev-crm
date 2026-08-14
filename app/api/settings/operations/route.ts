import { NextResponse } from "next/server";
import { getPrisma } from "@/src/lib/prisma";

export const runtime = "nodejs";
export const maxDuration = 30;

type DirectoryCategory = "PERSONNEL" | "SUPPLIER" | "WAREHOUSE" | "WORK_PRICE" | "CASH";
type DirectoryRow = {
  id: string;
  category: DirectoryCategory;
  name: string;
  code: string | null;
  data: Record<string, unknown> | null;
  isActive: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
};
type SettingRow = { key: string; value: unknown; updatedAt: Date };
type ScheduleDay = { day: number; label: string; enabled: boolean; open: string; close: string };

const DIRECTORY_CATEGORIES = new Set<DirectoryCategory>(["PERSONNEL", "SUPPLIER", "WAREHOUSE", "WORK_PRICE", "CASH"]);
const SETTING_KEYS = new Set(["work_schedule", "markup", "client_rules", "cash_rules"]);
const POST_TYPES = new Set(["LIFT", "NO_LIFT", "PIT", "ALIGNMENT"]);

function clean(value: unknown, max = 180) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
function bool(value: unknown) { return value === true || value === "true"; }
function number(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
function timeToMinute(value: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}
function normalizeSchedule(input: unknown): ScheduleDay[] {
  if (!Array.isArray(input) || input.length !== 7) throw new Error("INVALID_SCHEDULE");
  return input.map((item, index) => {
    const row = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const open = clean(row.open, 5);
    const close = clean(row.close, 5);
    const openMinute = timeToMinute(open);
    const closeMinute = timeToMinute(close);
    if (openMinute == null || closeMinute == null || closeMinute <= openMinute) throw new Error("INVALID_SCHEDULE");
    return { day: index + 1, label: clean(row.label, 4) || ["Пн","Вт","Ср","Чт","Пт","Сб","Нд"][index], enabled: bool(row.enabled), open, close };
  });
}
function postCapabilities(type: string, color: string) {
  const safeType = POST_TYPES.has(type) ? type : "LIFT";
  const safeColor = /^#[0-9A-Fa-f]{6}$/.test(color) ? color.toUpperCase() : "#FF6600";
  return [`TYPE:${safeType}`, `COLOR:${safeColor}`];
}
async function saveSetting(key: string, value: unknown) {
  const prisma = getPrisma();
  if (!SETTING_KEYS.has(key)) throw new Error("UNKNOWN_SETTING");
  await prisma.$executeRawUnsafe(
    `INSERT INTO "CrmSetting" ("key","value","updatedAt") VALUES ($1,$2::jsonb,CURRENT_TIMESTAMP)
     ON CONFLICT ("key") DO UPDATE SET "value"=EXCLUDED."value", "updatedAt"=CURRENT_TIMESTAMP`,
    key,
    JSON.stringify(value),
  );
}
async function addDirectory(category: DirectoryCategory, name: string, code: string, data: Record<string, unknown>, sortOrder = 100) {
  const prisma = getPrisma();
  const id = `dir_${category.toLowerCase()}_${crypto.randomUUID()}`;
  await prisma.$executeRawUnsafe(
    `INSERT INTO "CrmDirectoryItem" ("id","category","name","code","data","isActive","sortOrder","updatedAt")
     VALUES ($1,$2,$3,$4,$5::jsonb,TRUE,$6,CURRENT_TIMESTAMP)`,
    id, category, name, code || null, JSON.stringify(data), sortOrder,
  );
  return id;
}
async function updateDirectory(id: string, name: string, code: string, data: Record<string, unknown>) {
  const prisma = getPrisma();
  const changed = await prisma.$executeRawUnsafe(
    `UPDATE "CrmDirectoryItem" SET "name"=$2,"code"=$3,"data"=$4::jsonb,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1`,
    id, name, code || null, JSON.stringify(data),
  );
  if (!changed) throw new Error("NOT_FOUND");
}
async function getDirectory(id: string) {
  const prisma = getPrisma();
  const rows = await prisma.$queryRawUnsafe<DirectoryRow[]>(`SELECT * FROM "CrmDirectoryItem" WHERE "id"=$1 LIMIT 1`, id);
  return rows[0] ?? null;
}

export async function GET() {
  const prisma = getPrisma();
  try {
    const [location, settingsRows, directory, clientCount, recentClients] = await Promise.all([
      prisma.serviceLocation.findFirst({
        where: { isActive: true },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        include: {
          posts: { orderBy: [{ sortOrder: "asc" }, { name: "asc" }] },
          mechanics: { orderBy: [{ sortOrder: "asc" }, { name: "asc" }] },
        },
      }),
      prisma.$queryRawUnsafe<SettingRow[]>(`SELECT "key","value","updatedAt" FROM "CrmSetting" ORDER BY "key"`),
      prisma.$queryRawUnsafe<DirectoryRow[]>(`SELECT * FROM "CrmDirectoryItem" ORDER BY "category","sortOrder","name"`),
      prisma.client.count(),
      prisma.client.findMany({
        orderBy: { updatedAt: "desc" },
        take: 12,
        select: { id: true, name: true, phone: true, updatedAt: true, _count: { select: { vehicles: true, workOrders: true } } },
      }),
    ]);
    const settings = Object.fromEntries(settingsRows.map((row) => [row.key, row.value]));
    return NextResponse.json({ ok: true, location, settings, directory, clientCount, recentClients }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Operational settings GET failed", error);
    return NextResponse.json({ ok: false, error: "Не вдалося завантажити операційні налаштування." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const prisma = getPrisma();
  try {
    const body = await request.json() as Record<string, unknown>;
    const action = clean(body.action, 48);

    if (action === "SAVE_SETTING") {
      const key = clean(body.key, 64);
      await saveSetting(key, body.value);
      return NextResponse.json({ ok: true });
    }

    if (action === "SAVE_SCHEDULE") {
      const locationId = clean(body.locationId, 80);
      const schedule = normalizeSchedule(body.schedule);
      await saveSetting("work_schedule", schedule);
      const reference = schedule.find((day) => day.enabled) ?? schedule[0];
      const openMinute = timeToMinute(reference.open)!;
      const closeMinute = timeToMinute(reference.close)!;
      if (locationId) await prisma.serviceLocation.update({ where: { id: locationId }, data: { openMinute, closeMinute } });
      return NextResponse.json({ ok: true, schedule });
    }

    if (action === "ADD_DIRECTORY") {
      const category = clean(body.category, 32) as DirectoryCategory;
      if (!DIRECTORY_CATEGORIES.has(category)) throw new Error("INVALID_CATEGORY");
      const name = clean(body.name, 180);
      if (!name) throw new Error("NAME_REQUIRED");
      const code = clean(body.code, 64);
      const data = body.data && typeof body.data === "object" ? body.data as Record<string, unknown> : {};
      const id = await addDirectory(category, name, code, data, number(body.sortOrder, 100));

      if (category === "PERSONNEL" && bool(data.workshopResource)) {
        const locationId = clean(data.locationId, 80);
        if (locationId) {
          const mechanic = await prisma.serviceMechanic.create({ data: { locationId, name, sortOrder: number(body.sortOrder, 100) } });
          await prisma.$executeRawUnsafe(
            `UPDATE "CrmDirectoryItem" SET "data"="data" || $2::jsonb,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1`,
            id, JSON.stringify({ mechanicId: mechanic.id }),
          );
        }
      }
      return NextResponse.json({ ok: true, id }, { status: 201 });
    }

    if (action === "UPDATE_DIRECTORY") {
      const id = clean(body.id, 120);
      const current = await getDirectory(id);
      if (!current) throw new Error("NOT_FOUND");
      const name = clean(body.name, 180) || current.name;
      const code = Object.prototype.hasOwnProperty.call(body, "code") ? clean(body.code, 64) : current.code ?? "";
      const data = body.data && typeof body.data === "object" ? body.data as Record<string, unknown> : current.data ?? {};
      await updateDirectory(id, name, code, data);
      const mechanicId = clean((data as Record<string, unknown>).mechanicId, 120);
      if (current.category === "PERSONNEL" && mechanicId) await prisma.serviceMechanic.update({ where: { id: mechanicId }, data: { name } }).catch(() => undefined);
      return NextResponse.json({ ok: true });
    }

    if (action === "TOGGLE_DIRECTORY") {
      const id = clean(body.id, 120);
      const active = bool(body.isActive);
      const current = await getDirectory(id);
      if (!current) throw new Error("NOT_FOUND");
      await prisma.$executeRawUnsafe(`UPDATE "CrmDirectoryItem" SET "isActive"=$2,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1`, id, active);
      const mechanicId = clean(current.data?.mechanicId, 120);
      if (current.category === "PERSONNEL" && mechanicId) await prisma.serviceMechanic.update({ where: { id: mechanicId }, data: { isActive: active } }).catch(() => undefined);
      return NextResponse.json({ ok: true });
    }

    if (action === "ADD_POST") {
      const locationId = clean(body.locationId, 80);
      const name = clean(body.name, 120);
      if (!locationId || !name) throw new Error("POST_REQUIRED");
      const type = clean(body.type, 24);
      const color = clean(body.color, 12);
      const post = await prisma.servicePost.create({ data: { locationId, name, sortOrder: number(body.sortOrder, 100), capabilities: postCapabilities(type, color) } });
      return NextResponse.json({ ok: true, post }, { status: 201 });
    }

    if (action === "UPDATE_POST") {
      const id = clean(body.id, 120);
      const name = clean(body.name, 120);
      const type = clean(body.type, 24);
      const color = clean(body.color, 12);
      const post = await prisma.servicePost.update({ where: { id }, data: { name: name || undefined, capabilities: postCapabilities(type, color) } });
      return NextResponse.json({ ok: true, post });
    }

    if (action === "TOGGLE_POST") {
      const id = clean(body.id, 120);
      const post = await prisma.servicePost.update({ where: { id }, data: { isActive: bool(body.isActive) } });
      return NextResponse.json({ ok: true, post });
    }

    if (action === "ADD_MECHANIC") {
      const locationId = clean(body.locationId, 80);
      const name = clean(body.name, 120);
      if (!locationId || !name) throw new Error("MECHANIC_REQUIRED");
      const mechanic = await prisma.serviceMechanic.create({ data: { locationId, name, sortOrder: number(body.sortOrder, 100) } });
      return NextResponse.json({ ok: true, mechanic }, { status: 201 });
    }

    if (action === "UPDATE_MECHANIC") {
      const id = clean(body.id, 120);
      const name = clean(body.name, 120);
      const mechanic = await prisma.serviceMechanic.update({ where: { id }, data: { name: name || undefined } });
      return NextResponse.json({ ok: true, mechanic });
    }

    if (action === "TOGGLE_MECHANIC") {
      const id = clean(body.id, 120);
      const mechanic = await prisma.serviceMechanic.update({ where: { id }, data: { isActive: bool(body.isActive) } });
      return NextResponse.json({ ok: true, mechanic });
    }

    return NextResponse.json({ ok: false, error: "Невідома дія налаштувань." }, { status: 400 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "UNKNOWN";
    const message = code === "INVALID_SCHEDULE" ? "Перевір години роботи: час закриття має бути пізніше відкриття."
      : code === "NAME_REQUIRED" ? "Вкажіть назву."
      : code === "POST_REQUIRED" ? "Вкажіть назву поста та локацію."
      : code === "MECHANIC_REQUIRED" ? "Вкажіть ім’я працівника та локацію."
      : code === "NOT_FOUND" ? "Запис не знайдено."
      : "Не вдалося зберегти налаштування.";
    console.error("Operational settings POST failed", error);
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
