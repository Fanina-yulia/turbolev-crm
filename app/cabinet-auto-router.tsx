"use client";

import { useEffect } from "react";

const ROLE_START:Record<string,string|null>={
  OWNER:null,
  EXECUTIVE_DIRECTOR:null,
  STATION_MANAGER:null,
  SERVICE_ADVISOR:null,
  MECHANIC:null,
  HEAD_OF_SALES:"leads",
  SALES:"leads",
  PARTS_SPECIALIST:"parts",
  ACCOUNTANT:"finance",
  ADMINISTRATOR:"planner",
};

export function CabinetAutoRouter(){
  useEffect(()=>{
    let cancelled=false;
    const run=async()=>{
      try{
        const response=await fetch("/api/auth/me",{cache:"no-store"});
        const access=await response.json();
        if(cancelled||!response.ok||access?.enforcementMode!=="ENFORCED"||access?.provisioningState!=="ACTIVE")return;
        const url=new URL(window.location.href);
        if(url.searchParams.has("section"))return;
        const primary=access.roles?.find((role:any)=>role.isPrimary)||access.roles?.[0];
        const target=primary?.code?ROLE_START[primary.code]:null;
        if(target){url.searchParams.set("section",target);window.history.replaceState({},"",`${url.pathname}${url.search}${url.hash}`);window.setTimeout(()=>window.dispatchEvent(new PopStateEvent("popstate")),0);}
      }catch{}
    };
    void run();
    return()=>{cancelled=true};
  },[]);
  return null;
}
