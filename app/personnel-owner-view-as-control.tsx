"use client";

import { useEffect, useState } from "react";
import styles from "./personnel-owner-view-as-control.module.css";

type PreviewCurrent = {
  sessionId:string;
  targetUserId:string;
  targetEmployeeId:string;
  name:string;
  roleCode:string;
  roleName:string;
  locationId:string|null;
  locationName:string|null;
  expiresAt:string;
  readOnly:true;
};

type CurrentPayload = { ok:boolean; current?:PreviewCurrent|null; message?:string; error?:string };

const BASE="/api/personnel/owner-view-as";

export function OwnerViewAsControl() {
  const [resolved,setResolved]=useState(false);
  const [preview,setPreview]=useState<PreviewCurrent|null>(null);
  const [stopping,setStopping]=useState(false);
  const [error,setError]=useState("");

  useEffect(()=>{
    let alive=true;
    fetch(`${BASE}/current`,{cache:"no-store",credentials:"include"})
      .then(async response=>{
        const body=await response.json().catch(()=>null) as CurrentPayload|null;
        if(response.status===403){if(alive){setPreview(null);setResolved(true);}return;}
        if(!response.ok||!body?.ok)throw new Error(body?.message||body?.error||"Не вдалося перевірити режим перегляду");
        if(alive){setPreview(body.current||null);setResolved(true);}
      })
      .catch(()=>{if(alive){setPreview(null);setResolved(true);}});
    return()=>{alive=false;};
  },[]);

  const stop=async()=>{
    setStopping(true);setError("");
    try{
      const response=await fetch(`${BASE}/stop`,{method:"POST",credentials:"include"});
      const body=await response.json().catch(()=>null) as {ok?:boolean;message?:string;error?:string}|null;
      if(!response.ok||!body?.ok)throw new Error(body?.message||body?.error||"Не вдалося повернутися в кабінет Власника");
      window.location.assign("/");
    }catch(cause){
      setError(cause instanceof Error?cause.message:"Помилка виходу з режиму перегляду");
      setStopping(false);
    }
  };

  if(!resolved||!preview)return null;

  return <div className={styles.previewBanner}>
    <div className={styles.previewIdentity}>
      <span className={styles.eye}>👁</span>
      <div><strong>Перегляд як {preview.name}</strong><span>READ ONLY · реальні права працівника</span></div>
    </div>
    <div className={styles.previewActions}>
      <button type="button" className={styles.exitButton} onClick={()=>void stop()} disabled={stopping}>{stopping?"Повертаю…":"← Кабінет власника"}</button>
    </div>
    {error&&<div className={styles.error}>{error}</div>}
  </div>;
}
