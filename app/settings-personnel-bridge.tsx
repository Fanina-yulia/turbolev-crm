"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Personnel } from "./personnel";

export function SettingsPersonnelBridge(){
  const [target,setTarget]=useState<HTMLElement|null>(null);
  const [active,setActive]=useState(false);

  useEffect(()=>{
    let personnelButton:HTMLButtonElement|null=null;
    let settingsMain:HTMLElement|null=null;
    const cleanups:Array<()=>void>=[];

    const wire=()=>{
      cleanups.splice(0).forEach(fn=>fn());
      personnelButton=null; settingsMain=null;
      const buttons=Array.from(document.querySelectorAll<HTMLButtonElement>("button"));
      personnelButton=buttons.find(btn=>{
        const text=(btn.textContent||"").replace(/\s+/g," ").trim();
        return text.includes("Персонал")&&text.includes("Працівники й ресурси");
      })||null;
      if(!personnelButton){setActive(false);setTarget(null);return;}
      const tabs=personnelButton.closest("aside");
      settingsMain=tabs?.parentElement?.querySelector<HTMLElement>(":scope > main")||null;
      if(!settingsMain){setActive(false);setTarget(null);return;}
      settingsMain.style.position="relative";
      setTarget(settingsMain);

      const activate=()=>window.setTimeout(()=>setActive(true),0);
      personnelButton.addEventListener("click",activate);
      cleanups.push(()=>personnelButton?.removeEventListener("click",activate));

      const siblingButtons=Array.from(tabs?.querySelectorAll<HTMLButtonElement>("button")||[]).filter(btn=>btn!==personnelButton);
      siblingButtons.forEach(btn=>{
        const deactivate=()=>setActive(false);
        btn.addEventListener("click",deactivate);
        cleanups.push(()=>btn.removeEventListener("click",deactivate));
      });
    };

    const observer=new MutationObserver(()=>wire());
    observer.observe(document.body,{childList:true,subtree:true});
    wire();
    return()=>{observer.disconnect();cleanups.splice(0).forEach(fn=>fn());};
  },[]);

  if(!active||!target)return null;
  return createPortal(
    <div style={{position:"absolute",inset:0,zIndex:20,overflow:"auto",background:"var(--surface, #101318)",padding:"20px 24px 40px"}}>
      <Personnel />
    </div>,
    target
  );
}
