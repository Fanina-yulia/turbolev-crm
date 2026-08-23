"use client";

import { useEffect, useMemo, useState } from "react";
import { NAV_PERMISSION, type PermissionCode } from "@/src/security/permissions";

export type CrmAccessSnapshot = {
  authConfigured:boolean;
  authenticated:boolean;
  provisioningState:"ANONYMOUS"|"AUTHENTICATED_UNPROVISIONED"|"ACTIVE"|"INACTIVE";
  enforcementMode:"SHADOW"|"ENFORCED";
  user:{id:string;name:string|null;employeeId:string|null}|null;
  roles:Array<{code:string;name:string;locationId:string|null;isPrimary:boolean}>;
  permissions:Record<string,string>;
  locations:string[];
  viewAs:{
    active:true;
    readOnly:true;
    sessionId:string;
    expiresAt:string;
    owner:{id:string;name:string;employeeId:string|null};
    target:{id:string;name:string;employeeId:string|null};
  }|null;
};

export function useCrmAccess(){
  const [snapshot,setSnapshot]=useState<CrmAccessSnapshot|null>(null);
  const [loaded,setLoaded]=useState(false);

  useEffect(()=>{
    let alive=true;
    fetch("/api/auth/me",{cache:"no-store"})
      .then(async response=>{if(!response.ok)throw new Error(`auth/me ${response.status}`);return response.json();})
      .then(body=>{if(alive)setSnapshot(body as CrmAccessSnapshot);})
      .catch(error=>{console.warn("CRM access context unavailable",error);})
      .finally(()=>{if(alive)setLoaded(true);});
    return()=>{alive=false;};
  },[]);

  const enforced=snapshot?.enforcementMode==="ENFORCED";
  const activeUser=snapshot?.provisioningState==="ACTIVE";
  const can=useMemo(()=>((permission:PermissionCode)=>{
    // Security is fail-closed in both SHADOW and ENFORCED. SHADOW is now only
    // a diagnostic logging mode, so the navigation must never expose modules
    // that the server would deny for the current user.
    if(!activeUser)return false;
    return Boolean(snapshot?.permissions?.[permission]);
  }),[activeUser,snapshot]);
  const canOpenCabinet=(slug:string)=>{const permission=NAV_PERMISSION[slug];return permission?can(permission):true;};
  const primaryRole=snapshot?.roles.find(role=>role.isPrimary)||snapshot?.roles[0]||null;
  return {snapshot,loaded,enforced:Boolean(enforced),activeUser:Boolean(activeUser),primaryRole,can,canOpenCabinet};
}
