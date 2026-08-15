import { NextRequest, NextResponse } from "next/server";
import { getSqlPool } from "@/src/lib/sql";

export const dynamic = "force-dynamic";

function normalizePhone(value:string){return value.replace(/\D/g,"")}

export async function PUT(request:NextRequest){
  const body=await request.json().catch(()=>({}));
  const phone=String(body.phone||"");
  const phoneNormalized=normalizePhone(phone);
  const name=String(body.name||"").trim();
  if(!phoneNormalized)return NextResponse.json({error:"Не вказаний телефон клієнта"},{status:400});
  if(!name)return NextResponse.json({error:"Вкажіть ім’я клієнта"},{status:400});
  try{
    const result=await getSqlPool().query(`UPDATE "Client" SET "name"=$2,"updatedAt"=NOW() WHERE "phoneNormalized"=$1 RETURNING "id","name","phone"`,[phoneNormalized,name]);
    if(!result.rows[0])return NextResponse.json({error:"Клієнта не знайдено"},{status:404});
    return NextResponse.json({ok:true,client:result.rows[0]});
  }catch(error){console.error("client name update failed",error);return NextResponse.json({error:"Не вдалося оновити ім’я клієнта"},{status:500})}
}
