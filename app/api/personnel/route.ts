import { NextRequest, NextResponse } from "next/server";
import { randomBytes, randomUUID, scryptSync } from "node:crypto";
import { getPrisma } from "@/src/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function hashPassword(value: string) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(value, salt, 64).toString("hex")}`;
}
function n(value: unknown) {
  if (value === "" || value == null) return null;
  const x = Number(value);
  return Number.isFinite(x) ? x : null;
}
function payload(body: any) {
  return {
    firstName: String(body.firstName || "").trim(), lastName: String(body.lastName || "").trim(),
    birthDate: body.birthDate ? new Date(`${body.birthDate}T00:00:00`) : null,
    email: body.email ? String(body.email).trim() : null, phone: body.phone ? String(body.phone).trim() : null,
    phoneCountry: body.phoneCountry ? String(body.phoneCountry) : "UA", address: body.address ? String(body.address).trim() : null,
    photoUrl: body.photoUrl ? String(body.photoUrl) : null, personnelCategory: body.personnelCategory ? String(body.personnelCategory) : null,
    position: body.position ? String(body.position) : null, crmLogin: body.crmLogin ? String(body.crmLogin).trim() : null,
    isActive: body.isActive !== false, baseSalary: n(body.baseSalary), minimumSalary: n(body.minimumSalary), workPercent: n(body.workPercent),
    partsSalesPercent: n(body.partsSalesPercent), partsMarginPercent: n(body.partsMarginPercent), netProfitPercent: n(body.netProfitPercent),
    payrollRuleNote: body.payrollRuleNote ? String(body.payrollRuleNote) : null,
  };
}

export async function GET() {
  const prisma = getPrisma();
  try {
    const items = await prisma.$queryRawUnsafe<any[]>(`
      SELECT e.*, COALESCE(json_agg(json_build_object('id',d."id",'type',d."type",'name',d."name",'status',d."status",'fileUrl',d."fileUrl",'uploadedAt',d."uploadedAt") ORDER BY d."name") FILTER (WHERE d."id" IS NOT NULL), '[]'::json) AS documents
      FROM public."EmployeeProfile" e
      LEFT JOIN public."EmployeeDocument" d ON d."employeeId" = e."id"
      GROUP BY e."id" ORDER BY e."isActive" DESC, e."lastName", e."firstName"`);
    return NextResponse.json({ ok: true, items }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("personnel GET failed", error);
    return NextResponse.json({ ok: false, error: "Розділ персоналу очікує активації HR-схеми." }, { status: 503 });
  }
}

export async function POST(request: NextRequest) {
  const prisma = getPrisma();
  try {
    const body = await request.json(); const p = payload(body);
    if (!p.firstName || !p.lastName) return NextResponse.json({ ok: false, error: "Вкажіть ім’я та прізвище." }, { status: 400 });
    const id = randomUUID(); const passwordHash = body.password ? hashPassword(String(body.password)) : null;
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`INSERT INTO public."EmployeeProfile" ("id","firstName","lastName","birthDate","email","phone","phoneCountry","address","photoUrl","personnelCategory","position","crmLogin","crmPasswordHash","isActive","baseSalary","minimumSalary","workPercent","partsSalesPercent","partsMarginPercent","netProfitPercent","payrollRuleNote","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,now())`, id,p.firstName,p.lastName,p.birthDate,p.email,p.phone,p.phoneCountry,p.address,p.photoUrl,p.personnelCategory,p.position,p.crmLogin,passwordHash,p.isActive,p.baseSalary,p.minimumSalary,p.workPercent,p.partsSalesPercent,p.partsMarginPercent,p.netProfitPercent,p.payrollRuleNote);
      for (const d of Array.isArray(body.documents) ? body.documents : []) await tx.$executeRawUnsafe(`INSERT INTO public."EmployeeDocument" ("id","employeeId","type","name","status","fileUrl","uploadedAt","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,now())`, randomUUID(), id, String(d.type||"OTHER"), String(d.name||"Документ"), String(d.status||"MISSING"), d.fileUrl?String(d.fileUrl):null, d.status==="UPLOADED"?new Date():null);
    });
    return NextResponse.json({ ok: true, id });
  } catch (error) {
    console.error("personnel POST failed", error);
    return NextResponse.json({ ok: false, error: "Не вдалося створити співробітника. Перевірте унікальність e-mail/логіну." }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  const prisma = getPrisma();
  try {
    const body = await request.json(); const id = String(body.id || ""); const p = payload(body);
    if (!id) return NextResponse.json({ ok: false, error: "Не вказано співробітника." }, { status: 400 });
    const passwordHash = body.password ? hashPassword(String(body.password)) : null;
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`UPDATE public."EmployeeProfile" SET "firstName"=$2,"lastName"=$3,"birthDate"=$4,"email"=$5,"phone"=$6,"phoneCountry"=$7,"address"=$8,"photoUrl"=$9,"personnelCategory"=$10,"position"=$11,"crmLogin"=$12,"crmPasswordHash"=COALESCE($13,"crmPasswordHash"),"isActive"=$14,"baseSalary"=$15,"minimumSalary"=$16,"workPercent"=$17,"partsSalesPercent"=$18,"partsMarginPercent"=$19,"netProfitPercent"=$20,"payrollRuleNote"=$21,"updatedAt"=now() WHERE "id"=$1`, id,p.firstName,p.lastName,p.birthDate,p.email,p.phone,p.phoneCountry,p.address,p.photoUrl,p.personnelCategory,p.position,p.crmLogin,passwordHash,p.isActive,p.baseSalary,p.minimumSalary,p.workPercent,p.partsSalesPercent,p.partsMarginPercent,p.netProfitPercent,p.payrollRuleNote);
      await tx.$executeRawUnsafe(`DELETE FROM public."EmployeeDocument" WHERE "employeeId"=$1`, id);
      for (const d of Array.isArray(body.documents) ? body.documents : []) await tx.$executeRawUnsafe(`INSERT INTO public."EmployeeDocument" ("id","employeeId","type","name","status","fileUrl","uploadedAt","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,now())`, randomUUID(), id, String(d.type||"OTHER"), String(d.name||"Документ"), String(d.status||"MISSING"), d.fileUrl?String(d.fileUrl):null, d.status==="UPLOADED"?new Date():null);
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("personnel PUT failed", error);
    return NextResponse.json({ ok: false, error: "Не вдалося оновити співробітника." }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const prisma = getPrisma(); const id = request.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ ok: false, error: "Не вказано співробітника." }, { status: 400 });
  try { await prisma.$executeRawUnsafe(`DELETE FROM public."EmployeeProfile" WHERE "id"=$1`, id); return NextResponse.json({ ok: true }); }
  catch (error) { console.error("personnel DELETE failed", error); return NextResponse.json({ ok: false, error: "Не вдалося видалити співробітника." }, { status: 500 }); }
}
