"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { PersonnelV2 } from "./personnel-v2";

export function SettingsPersonnelBridge(){
  const [target,setTarget]=useState<HTMLElement|null>(null);
  const [active,setActive]=useState(false);

  useEffect(()=>{
    let personnelButton:HTMLButtonElement|null=null;
    let settingsMain:HTMLElement|null=null;
    const cleanups:Array<()=>void>=[];
    const normalizeTarget=(node:HTMLElement)=>{
      node.style.setProperty("position","relative","important");
      node.style.setProperty("min-height","calc(100vh - 150px)","important");
      node.style.setProperty("overflow","visible","important");
      node.style.setProperty("background","var(--bg)","important");
    };
    const wire=()=>{
      cleanups.splice(0).forEach(fn=>fn());personnelButton=null;settingsMain=null;
      const buttons=Array.from(document.querySelectorAll<HTMLButtonElement>("button"));
      personnelButton=buttons.find(btn=>{const text=(btn.textContent||"").replace(/\s+/g," ").trim();return text.includes("Персонал")&&text.includes("Працівники й ресурси")})||null;
      if(!personnelButton){setActive(false);setTarget(null);return;}
      const tabs=personnelButton.closest("aside");settingsMain=tabs?.parentElement?.querySelector<HTMLElement>(":scope > main")||null;
      if(!settingsMain){setActive(false);setTarget(null);return;}
      normalizeTarget(settingsMain);setTarget(settingsMain);
      const activate=()=>window.setTimeout(()=>{if(settingsMain)normalizeTarget(settingsMain);setActive(true)},0);
      personnelButton.addEventListener("click",activate);cleanups.push(()=>personnelButton?.removeEventListener("click",activate));
      Array.from(tabs?.querySelectorAll<HTMLButtonElement>("button")||[]).filter(btn=>btn!==personnelButton).forEach(btn=>{const deactivate=()=>setActive(false);btn.addEventListener("click",deactivate);cleanups.push(()=>btn.removeEventListener("click",deactivate))});
    };
    const observer=new MutationObserver(()=>wire());observer.observe(document.body,{childList:true,subtree:true});wire();
    return()=>{observer.disconnect();cleanups.splice(0).forEach(fn=>fn())};
  },[]);

  if(!active||!target)return null;
  return createPortal(<div style={{position:"absolute",inset:"0 0 auto 0",zIndex:20,minHeight:"calc(100vh - 150px)",boxSizing:"border-box",overflow:"visible",background:"var(--bg)",color:"var(--text)",padding:"22px clamp(18px, 2.2vw, 34px) 48px"}}><PersonnelV2/></div>,target);
}
