"use client";

import { useEffect, useMemo, useState } from "react";
import { useCrmAccess } from "./use-crm-access";
import styles from "./owner-view-as-control.module.css";

type EmployeeOption = {
  userId:string;
  employeeId:string;
  name:string;
  position:string|null;
  category:string|null;
  roleCode:string;
  roleName:string;
  locationId:string|null;
  locationName:string|null;
};

type EmployeesPayload = { ok:boolean; employees?:EmployeeOption[]; message?:string; error?:string };

export function OwnerViewAsControl() {
  const access=useCrmAccess();
  const snapshot=access.snapshot;
  const preview=snapshot?.viewAs||null;
  const isOwner=Boolean(preview)||Boolean(snapshot?.roles.some(role=>role.code==="OWNER"));
  const [open,setOpen]=useState(false);
  const [employees,setEmployees]=useState<EmployeeOption[]>([]);
  const [query,setQuery]=useState("");
  const [loading,setLoading]=useState(false);
  const [busyUserId,setBusyUserId]=useState<string|null>(null);
  const [error,setError]=useState("");

  useEffect(()=>{
    if(!isOwner||!open||employees.length||loading)return;
    let alive=true;
    setLoading(true);setError("");
    fetch("/api/owner/view-as/employees",{cache:"no-store",credentials:"include"})
      .then(async response=>{
        const body=await response.json().catch(()=>null) as EmployeesPayload|null;
        if(!response.ok||!body?.ok)throw new Error(body?.message||body?.error||"Не вдалося завантажити працівників");
        if(alive)setEmployees(body.employees||[]);
      })
      .catch(cause=>{if(alive)setError(cause instanceof Error?cause.message:"Помилка завантаження");})
      .finally(()=>{if(alive)setLoading(false);});
    return()=>{alive=false;};
  },[isOwner,open,employees.length,loading]);

  const filtered=useMemo(()=>{
    const needle=query.trim().toLowerCase();
    if(!needle)return employees;
    return employees.filter(item=>[item.name,item.position,item.roleName,item.locationName].filter(Boolean).join(" ").toLowerCase().includes(needle));
  },[employees,query]);

  if(!access.loaded||!isOwner)return null;

  const activate=async(employee:EmployeeOption)=>{
    setBusyUserId(employee.userId);setError("");
    try{
      const response=await fetch(preview?"/api/owner/view-as/switch":"/api/owner/view-as/start",{
        method:"POST",headers:{"Content-Type":"application/json"},credentials:"include",body:JSON.stringify({targetUserId:employee.userId}),
      });
      const body=await response.json().catch(()=>null) as {ok?:boolean;message?:string;error?:string}|null;
      if(!response.ok||!body?.ok)throw new Error(body?.message||body?.error||"Не вдалося відкрити кабінет працівника");
      window.location.assign("/");
    }catch(cause){setError(cause instanceof Error?cause.message:"Помилка перемикання");setBusyUserId(null);}
  };

  const stop=async()=>{
    setBusyUserId("__stop__");setError("");
    try{
      const response=await fetch("/api/owner/view-as/stop",{method:"POST",credentials:"include"});
      const body=await response.json().catch(()=>null) as {ok?:boolean;message?:string;error?:string}|null;
      if(!response.ok||!body?.ok)throw new Error(body?.message||body?.error||"Не вдалося повернутися в кабінет Власника");
      window.location.assign("/");
    }catch(cause){setError(cause instanceof Error?cause.message:"Помилка виходу з режиму перегляду");setBusyUserId(null);}
  };

  return <div className={preview?styles.previewBanner:styles.ownerControl}>
    {preview?<div className={styles.previewIdentity}>
      <span className={styles.eye}>👁</span>
      <div><strong>Перегляд як {preview.target.name}</strong><span>READ ONLY · реальні права працівника</span></div>
    </div>:<button type="button" className={styles.ownerButton} onClick={()=>setOpen(value=>!value)} aria-expanded={open}><span>👁</span><span>Переглянути як працівник</span></button>}

    {preview&&<div className={styles.previewActions}>
      <button type="button" onClick={()=>setOpen(value=>!value)}>{open?"Закрити":"Змінити працівника"}</button>
      <button type="button" className={styles.exitButton} onClick={()=>void stop()} disabled={busyUserId==="__stop__"}>{busyUserId==="__stop__"?"Повертаю…":"← Кабінет власника"}</button>
    </div>}

    {open&&<div className={`${styles.picker} ${preview?styles.pickerPreview:""}`}>
      <div className={styles.pickerHead}><strong>Кабінети працівників</strong><span>Відкриваються без права змінювати дані</span></div>
      <input value={query} onChange={event=>setQuery(event.target.value)} placeholder="Пошук за ім’ям, посадою або станцією…" autoFocus/>
      {error&&<div className={styles.error}>{error}</div>}
      {loading?<div className={styles.state}>Завантажую працівників…</div>:<div className={styles.employeeList}>
        {filtered.map(employee=><button type="button" key={employee.userId} className={styles.employee} onClick={()=>void activate(employee)} disabled={Boolean(busyUserId)}>
          <div><strong>{employee.name}</strong><span>{employee.position||employee.roleName}</span></div>
          <small>{employee.locationName||"Вся компанія"}</small>
          <b>{busyUserId===employee.userId?"Відкриваю…":"Переглянути →"}</b>
        </button>)}
        {!filtered.length&&!loading&&<div className={styles.state}>Працівників з активним кабінетом не знайдено.</div>}
      </div>}
    </div>}
  </div>;
}
