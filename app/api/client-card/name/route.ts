import { NextRequest, NextResponse } from "next/server";
import { getSqlPool } from "@/src/lib/sql";

export const dynamic = "force-dynamic";

function normalizePhone(value:string){
  let digits=value.replace(/\D/g,"");
  if(digits.startsWith("0"))digits=`38${digits}`;
  if(!digits.startsWith("380")&&digits.length===9)digits=`380${digits}`;
  return digits.slice(0,12);
}

export async function PUT(request:NextRequest){
  const body=await request.json().catch(()=>({}));
  const phoneNormalized=normalizePhone(String(body.phone||""));
  const name=String(body.name||"").trim();
  if(phoneNormalized.length!==12||!phoneNormalized.startsWith("380"))return NextResponse.json({error:"Не вказаний коректний телефон клієнта"},{status:400});
  if(!name)return NextResponse.json({error:"Вкажіть ім’я клієнта"},{status:400});
  try{
    const result=await getSqlPool().query(
      `WITH target AS (
         SELECT c."id" FROM "Client" c
         LEFT JOIN "ClientPhone" cp ON cp."clientId"=c."id"
         WHERE c."phoneNormalized"=$1 OR cp."phoneNormalized"=$1
         LIMIT 1
       )
       UPDATE "Client" c SET "name"=$2,"updatedAt"=NOW()
       FROM target t WHERE c."id"=t."id"
       RETURNING c."id",c."name",c."phone"`,[phoneNormalized,name]);
    if(!result.rows[0])return NextResponse.json({error:"Клієнта не знайдено"},{status:404});
    return NextResponse.json({ok:true,client:result.rows[0]});
  }catch(error){console.error("client name update failed",error);return NextResponse.json({error:"Не вдалося оновити ім’я клієнта"},{status:500})}
}
