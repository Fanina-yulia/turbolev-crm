import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getSqlPool } from "@/src/lib/sql";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";

export const dynamic = "force-dynamic";

const labels = new Set(["Основний","Чоловік","Дружина","Робочий","Інше"]);
function normalizePhone(value:string){
  let digits=value.replace(/\D/g,"");
  if(digits.startsWith("0"))digits=`38${digits}`;
  if(!digits.startsWith("380")&&digits.length===9)digits=`380${digits}`;
  return digits.slice(0,12);
}
function displayPhone(value:string){
  if(value.length!==12)return `+${value}`;
  return `+380 ${value.slice(3,5)} ${value.slice(5,8)} ${value.slice(8,10)} ${value.slice(10,12)}`;
}

async function resolveClientId(clientId:string, contextPhone:string){
  const pool=getSqlPool();
  if(clientId){const direct=await pool.query(`SELECT "id" FROM "Client" WHERE "id"=$1 LIMIT 1`,[clientId]);if(direct.rows[0])return direct.rows[0].id as string;}
  const normalized=normalizePhone(contextPhone);
  if(!normalized)return null;
  const result=await pool.query(`SELECT DISTINCT c."id" FROM "Client" c LEFT JOIN "ClientPhone" cp ON cp."clientId"=c."id" WHERE c."phoneNormalized"=$1 OR cp."phoneNormalized"=$1 LIMIT 1`,[normalized]);
  return result.rows[0]?.id as string|undefined || null;
}

export async function POST(request:NextRequest){
  const access = await authorize(PERMISSIONS.CLIENTS_WRITE, { request, strict: true, minimumScope: "TEAM" });
  if (!access.allowed) return access.response!;
  const body=await request.json().catch(()=>({}));
  const clientId=await resolveClientId(String(body.clientId||""),String(body.phone||""));
  const phoneNormalized=normalizePhone(String(body.newPhone||""));
  const requestedLabel=labels.has(String(body.label||""))?String(body.label):"Інше";
  if(!clientId)return NextResponse.json({error:"Клієнта не знайдено"},{status:404});
  if(phoneNormalized.length!==12||!phoneNormalized.startsWith("380"))return NextResponse.json({error:"Вкажіть коректний український номер"},{status:400});

  const pool=getSqlPool();const db=await pool.connect();
  try{
    await db.query("BEGIN");
    const clientResult=await db.query(`SELECT "id","phoneNormalized" FROM "Client" WHERE "id"=$1 LIMIT 1`,[clientId]);
    const client=clientResult.rows[0];
    if(!client){await db.query("ROLLBACK");return NextResponse.json({error:"Клієнта не знайдено"},{status:404});}
    const owner=await db.query(`SELECT DISTINCT c."id" FROM "Client" c LEFT JOIN "ClientPhone" cp ON cp."clientId"=c."id" WHERE c."phoneNormalized"=$1 OR cp."phoneNormalized"=$1 LIMIT 1`,[phoneNormalized]);
    if(owner.rows[0]&&owner.rows[0].id!==clientId){await db.query("ROLLBACK");return NextResponse.json({error:"Цей номер уже належить іншому клієнту"},{status:409});}

    const isPrimary=requestedLabel==="Основний"||client.phoneNormalized===phoneNormalized;
    const label=isPrimary?"Основний":requestedLabel;
    if(isPrimary){
      await db.query(`UPDATE "ClientPhone" SET "isPrimary"=false,"label"=CASE WHEN "label"='Основний' THEN 'Інше' ELSE "label" END,"updatedAt"=NOW() WHERE "clientId"=$1`,[clientId]);
      await db.query(`UPDATE "Client" SET "phone"=$2,"phoneNormalized"=$3,"updatedAt"=NOW() WHERE "id"=$1`,[clientId,displayPhone(phoneNormalized),phoneNormalized]);
    }
    await db.query(
      `INSERT INTO "ClientPhone" ("id","clientId","phone","phoneNormalized","label","isPrimary","createdAt","updatedAt")
       VALUES ($1,$2,$3,$4,$5,$6,NOW(),NOW())
       ON CONFLICT ("phoneNormalized") DO UPDATE SET "phone"=EXCLUDED."phone","label"=EXCLUDED."label","isPrimary"=EXCLUDED."isPrimary","updatedAt"=NOW()`,
      [`cp_${randomUUID()}`,clientId,displayPhone(phoneNormalized),phoneNormalized,label,isPrimary]);
    await db.query("COMMIT");
    return NextResponse.json({ok:true,phone:{phone:displayPhone(phoneNormalized),phoneNormalized,label,isPrimary}});
  }catch(error){await db.query("ROLLBACK").catch(()=>{});console.error("client phone save failed",error);return NextResponse.json({error:"Не вдалося зберегти телефон"},{status:500});}
  finally{db.release();}
}

export async function DELETE(request:NextRequest){
  const access = await authorize(PERMISSIONS.CLIENTS_WRITE, { request, strict: true, minimumScope: "TEAM" });
  if (!access.allowed) return access.response!;
  const body=await request.json().catch(()=>({}));
  const id=String(body.id||"");
  const clientId=String(body.clientId||"");
  if(!id||!clientId)return NextResponse.json({error:"Не вказаний телефон"},{status:400});
  try{
    const row=await getSqlPool().query(`SELECT "id","isPrimary" FROM "ClientPhone" WHERE "id"=$1 AND "clientId"=$2 LIMIT 1`,[id,clientId]);
    if(!row.rows[0])return NextResponse.json({error:"Телефон не знайдено"},{status:404});
    if(row.rows[0].isPrimary)return NextResponse.json({error:"Основний номер видалити не можна. Спочатку зробіть інший номер основним."},{status:400});
    await getSqlPool().query(`DELETE FROM "ClientPhone" WHERE "id"=$1 AND "clientId"=$2`,[id,clientId]);
    return NextResponse.json({ok:true});
  }catch(error){console.error("client phone delete failed",error);return NextResponse.json({error:"Не вдалося видалити телефон"},{status:500});}
}
