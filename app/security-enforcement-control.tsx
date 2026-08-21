"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Catalog={
  config:{enforcementMode:"SHADOW"|"ENFORCED";bootstrapCompleted:boolean}|null;
  users:Array<{id:string;name:string;email:string|null;authLinked:boolean;isActive:boolean;lastLoginAt:string|null;lastSeenAt:string|null;roles:Array<{code:string}>}>;
};

export function SecurityEnforcementControl(){
  const [catalog,setCatalog]=useState<Catalog|null>(null);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");
  const [error,setError]=useState("");

  const load=useCallback(async()=>{
    try{
      const response=await fetch("/api/security/access-catalog",{cache:"no-store"});
      const body=await response.json();
      if(!response.ok)throw new Error(body?.message||body?.error||"Не вдалося прочитати режим доступу");
      setCatalog(body);setError("");
    }catch(e){setError(e instanceof Error?e.message:"Не вдалося прочитати режим доступу")}
  },[]);
  useEffect(()=>{void load()},[load]);

  const ownerReady=useMemo(()=>{
    const cutoff=Date.now()-60*60*1000;
    return Boolean(catalog?.users.some(user=>user.isActive&&user.authLinked&&user.roles.some(role=>role.code==="OWNER")&&Boolean(user.lastSeenAt)&&new Date(user.lastSeenAt!).getTime()>=cutoff));
  },[catalog]);
  const mode=catalog?.config?.enforcementMode||"SHADOW";

  async function change(next:"SHADOW"|"ENFORCED"){
    if(next===mode)return;
    const prompt=next==="ENFORCED"
      ?"Увімкнути стандартний режим ENFORCED? Сервер і далі блокуватиме всі дії без потрібних ролей, прав і scope."
      :"Увімкнути діагностичний SHADOW? Заборонені дії й надалі блокуватимуться; SHADOW лише додасть журналювання відмов для перевірки матриці доступу.";
    if(!window.confirm(prompt))return;
    setBusy(true);setMessage("");setError("");
    try{
      const response=await fetch("/api/security/config",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({enforcementMode:next})});
      const body=await response.json().catch(()=>null);
      if(!response.ok||!body?.ok)throw new Error(body?.message||body?.error||"Не вдалося змінити режим");
      setMessage(next==="ENFORCED"?"RBAC у режимі ENFORCED. Сервер блокує дії без потрібних прав.":"RBAC у діагностичному SHADOW. Блокування залишається активним, додано журналювання відмов.");
      await load();
    }catch(e){setError(e instanceof Error?e.message:"Не вдалося змінити режим")}
    finally{setBusy(false)}
  }

  return <section style={{border:"1px solid var(--border)",borderRadius:14,padding:14,marginBottom:16,background:"var(--surface)",color:"var(--text)"}}>
    <div style={{display:"flex",justifyContent:"space-between",gap:14,alignItems:"flex-start",flexWrap:"wrap"}}>
      <div style={{minWidth:240,flex:"1 1 420px"}}>
        <div style={{fontSize:11,fontWeight:800,letterSpacing:".11em",color:"var(--muted)"}}>ЗАХИСТ ДОСТУПУ</div>
        <h3 style={{margin:"5px 0"}}>Режим RBAC: {mode}</h3>
        <p style={{margin:0,color:"var(--muted)",lineHeight:1.45}}>{mode==="ENFORCED"?"Сервер перевіряє ролі, дозволи та scope і блокує заборонені дії. Приховування меню не є єдиним захистом.":"Діагностичний режим: сервер так само блокує дії без потрібних прав, а відмови додатково журналюються для перевірки матриці RBAC."}</p>
      </div>
      <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
        {mode==="SHADOW"?<button type="button" disabled={busy||!ownerReady} onClick={()=>void change("ENFORCED")} style={{border:0,borderRadius:10,padding:"10px 14px",fontWeight:800,cursor:ownerReady?"pointer":"not-allowed",background:ownerReady?"var(--accent)":"var(--border)",color:ownerReady?"white":"var(--muted)"}}>Увімкнути ENFORCED</button>:<button type="button" disabled={busy} onClick={()=>void change("SHADOW")} style={{border:"1px solid var(--border)",borderRadius:10,padding:"10px 14px",fontWeight:800,cursor:"pointer",background:"var(--surface)",color:"var(--text)"}}>Діагностичний SHADOW</button>}
      </div>
    </div>
    {mode==="SHADOW"&&!ownerReady?<div style={{marginTop:10,padding:"10px 12px",borderRadius:10,background:"color-mix(in srgb,#d59620 14%,transparent)"}}>SHADOW більше не вимикає захист. Щоб перейти в ENFORCED, активний Власник повинен активувати CRM-акаунт і успішно увійти; після цього кнопка доступна 60 хвилин.</div>:null}
    {message?<div style={{marginTop:10,padding:"9px 11px",borderRadius:9,background:"color-mix(in srgb,#159b60 14%,transparent)"}}>{message}</div>:null}
    {error?<div style={{marginTop:10,padding:"9px 11px",borderRadius:9,background:"color-mix(in srgb,#d43f4f 14%,transparent)"}}>{error}</div>:null}
  </section>;
}
