"use client";

import { useState } from "react";
import type { PersonnelDirectoryItem } from "@/src/lib/contracts/personnel-payload.parsers";
import { PERMISSIONS } from "@/src/security/permissions";
import { useCrmAccess } from "./use-crm-access";

type Props = {
  employee: PersonnelDirectoryItem;
  className?: string;
};

const BASE="/api/personnel/owner-view-as";

export function PersonnelOwnerViewButton({employee,className}:Props){
  const {can}=useCrmAccess();
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");

  const targetUserId=employee.access?.userId||null;
  const canPreview=can(PERMISSIONS.OWNER_EMPLOYEE_VIEW_AS);
  const unavailableReason=!employee.isActive
    ?"Працівник неактивний. Активуйте його, щоб переглянути кабінет."
    :!employee.access?.cabinetEnabled
      ?"CRM-кабінет працівника вимкнений. Спочатку увімкніть його на кроці «Доступ»."
      :!targetUserId
        ?"Кабінет ще не створений. Збережіть працівника після увімкнення CRM-доступу."
        :"";

  if(!canPreview)return null;

  const openCabinet=async()=>{
    if(busy)return;
    if(unavailableReason||!targetUserId){setError(unavailableReason||"Кабінет працівника ще недоступний.");return}
    setBusy(true);setError("");
    try{
      const response=await fetch(`${BASE}/start`,{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        credentials:"include",
        body:JSON.stringify({targetUserId}),
      });
      const body=await response.json().catch(()=>null) as {ok?:boolean;message?:string;error?:string}|null;
      if(!response.ok||!body?.ok)throw new Error(body?.message||body?.error||"Не вдалося відкрити кабінет працівника");
      window.location.assign("/");
    }catch(cause){
      setError(cause instanceof Error?cause.message:"Не вдалося відкрити кабінет працівника");
      setBusy(false);
    }
  };

  return <span>
    <button type="button" className={className} onClick={()=>void openCabinet()} disabled={busy} title={unavailableReason||"Відкрити CRM так, як її бачить цей працівник — без права змінювати дані"}>
      {busy?"Відкриваю…":"👁 Переглянути його кабінет"}
    </button>
    {error?<small role="alert" style={{display:"block",marginTop:6,maxWidth:260}}>{error}</small>:null}
  </span>;
}
