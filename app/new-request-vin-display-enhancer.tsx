"use client";

import { useEffect } from "react";

function normalize(value:string){return value.trim().toUpperCase()}

function refreshFoundVehicleIdentity(){
  const card=document.querySelector<HTMLElement>(".vehicleFoundCompact");
  if(!card)return;
  const identity=card.children.item(1) as HTMLElement|null;
  if(!identity)return;
  const line=identity.querySelector("span");
  if(!line)return;

  const plateInput=document.querySelector<HTMLInputElement>(".vehicleIdentityStep .uaPlateText");
  const vinInput=document.querySelector<HTMLInputElement>(".vehicleIdentityStep .fastVinInput");
  const plate=normalize(plateInput?.value||"");
  const vin=normalize(vinInput?.value||"");
  const next=`Держномер: ${plate||"—"} · VIN: ${vin||"не знайдено"}`;
  if(line.textContent!==next)line.textContent=next;
}

export function NewRequestVinDisplayEnhancer(){
  useEffect(()=>{
    let frame=0;
    const schedule=()=>{
      window.cancelAnimationFrame(frame);
      frame=window.requestAnimationFrame(refreshFoundVehicleIdentity);
    };
    schedule();
    const observer=new MutationObserver(schedule);
    observer.observe(document.body,{childList:true,subtree:true,characterData:true});
    document.addEventListener("input",schedule,true);
    document.addEventListener("change",schedule,true);
    return()=>{
      observer.disconnect();
      document.removeEventListener("input",schedule,true);
      document.removeEventListener("change",schedule,true);
      window.cancelAnimationFrame(frame);
    };
  },[]);
  return null;
}
