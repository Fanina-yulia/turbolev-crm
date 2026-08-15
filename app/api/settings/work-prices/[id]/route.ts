import { NextResponse } from "next/server";
import { getPrisma } from "@/src/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type DirectoryRow = {
  id:string;
  category:string;
  name:string;
  code:string|null;
  data:Record<string,unknown>|null;
  isActive:boolean;
  sortOrder:number;
};

function clean(value:unknown,max=180){return typeof value==="string"?value.trim().slice(0,max):"";}
function finite(value:unknown,fallback:number|null=null){const parsed=Number(value);return Number.isFinite(parsed)?parsed:fallback;}
function bool(value:unknown){return value===true||value==="true";}

async function getWorkPrice(id:string){
  const prisma=getPrisma();
  const rows=await prisma.$queryRawUnsafe<DirectoryRow[]>(
    `SELECT "id","category","name","code","data","isActive","sortOrder" FROM "CrmDirectoryItem" WHERE "id"=$1 AND "category"='WORK_PRICE' LIMIT 1`,
    id,
  );
  return rows[0]??null;
}

export async function PUT(request:Request,{params}:{params:Promise<{id:string}>}){
  const prisma=getPrisma();
  try{
    const {id}=await params;
    const current=await getWorkPrice(clean(id,120));
    if(!current)return NextResponse.json({ok:false,error:"Роботу не знайдено."},{status:404});
    const body=await request.json() as Record<string,unknown>;
    const name=clean(body.name,180);
    const code=clean(body.code,64);
    const category=clean(body.category,100);
    const unit=clean(body.unit,32);
    const price=finite(body.price);
    const normHours=body.normHours===""||body.normHours==null?null:finite(body.normHours);
    const complexSurcharge=body.complexSurcharge===""||body.complexSurcharge==null?null:finite(body.complexSurcharge);
    const note=clean(body.note,500);
    if(!name)return NextResponse.json({ok:false,error:"Вкажіть назву роботи."},{status:400});
    if(price==null||price<0)return NextResponse.json({ok:false,error:"Вкажіть коректну базову ціну."},{status:400});
    if(normHours!=null&&normHours<0)return NextResponse.json({ok:false,error:"Нормо-години не можуть бути від’ємними."},{status:400});
    if(code){
      const duplicate=await prisma.$queryRawUnsafe<Array<{id:string}>>(
        `SELECT "id" FROM "CrmDirectoryItem" WHERE "category"='WORK_PRICE' AND "code"=$1 AND "id"<>$2 LIMIT 1`,
        code,current.id,
      );
      if(duplicate.length)return NextResponse.json({ok:false,error:`Код ${code} вже використовується іншою роботою.`},{status:409});
    }
    const data={...(current.data??{}),category,unit,price,normHours,complexSurcharge,note};
    const isActive=Object.prototype.hasOwnProperty.call(body,"isActive")?bool(body.isActive):current.isActive;
    await prisma.$executeRawUnsafe(
      `UPDATE "CrmDirectoryItem" SET "name"=$2,"code"=$3,"data"=$4::jsonb,"isActive"=$5,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1 AND "category"='WORK_PRICE'`,
      current.id,name,code||null,JSON.stringify(data),isActive,
    );
    return NextResponse.json({ok:true,item:{...current,name,code:code||null,data,isActive}});
  }catch(error){
    console.error("work price PUT failed",error);
    return NextResponse.json({ok:false,error:"Не вдалося зберегти роботу."},{status:500});
  }
}

export async function PATCH(request:Request,{params}:{params:Promise<{id:string}>}){
  const prisma=getPrisma();
  try{
    const {id}=await params;
    const current=await getWorkPrice(clean(id,120));
    if(!current)return NextResponse.json({ok:false,error:"Роботу не знайдено."},{status:404});
    const body=await request.json() as Record<string,unknown>;
    const isActive=bool(body.isActive);
    await prisma.$executeRawUnsafe(
      `UPDATE "CrmDirectoryItem" SET "isActive"=$2,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1 AND "category"='WORK_PRICE'`,
      current.id,isActive,
    );
    return NextResponse.json({ok:true,isActive});
  }catch(error){
    console.error("work price PATCH failed",error);
    return NextResponse.json({ok:false,error:"Не вдалося змінити статус роботи."},{status:500});
  }
}

export async function DELETE(_:Request,{params}:{params:Promise<{id:string}>}){
  const prisma=getPrisma();
  try{
    const {id}=await params;
    const current=await getWorkPrice(clean(id,120));
    if(!current)return NextResponse.json({ok:false,error:"Роботу не знайдено."},{status:404});
    await prisma.$executeRawUnsafe(`DELETE FROM "CrmDirectoryItem" WHERE "id"=$1 AND "category"='WORK_PRICE'`,current.id);
    return NextResponse.json({ok:true,id:current.id});
  }catch(error){
    console.error("work price DELETE failed",error);
    return NextResponse.json({ok:false,error:"Не вдалося видалити роботу."},{status:500});
  }
}
