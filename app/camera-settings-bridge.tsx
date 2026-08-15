"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { CameraSettingsPanel } from "./camera-settings-panel";
import settingsStyles from "./settings-center.module.css";

export function CameraSettingsBridge(){
  const [tabTarget,setTabTarget]=useState<HTMLElement|null>(null);
  const [contentTarget,setContentTarget]=useState<HTMLElement|null>(null);
  const [active,setActive]=useState(false);

  useEffect(()=>{
    let host:HTMLDivElement|null=null;
    let tabs:HTMLElement|null=null;

    const wire=()=>{
      const headings=Array.from(document.querySelectorAll<HTMLHeadingElement>("h2"));
      const heading=headings.find(node=>(node.textContent||"").trim()==="Налаштування");
      const modal=heading?.closest<HTMLElement>("section");
      if(!modal)return;
      tabs=modal.querySelector<HTMLElement>("aside");
      const main=tabs?.parentElement?.querySelector<HTMLElement>(":scope > main")||null;
      if(!tabs||!main)return;
      main.style.position="relative";
      host=tabs.querySelector<HTMLDivElement>('[data-camera-settings-tab="true"]');
      if(!host){host=document.createElement("div");host.dataset.cameraSettingsTab="true";host.style.display="contents";tabs.appendChild(host);}
      setTabTarget(current=>current===host?current:host);
      setContentTarget(current=>current===main?current:main);
    };

    const handleClick=(event:MouseEvent)=>{
      const target=event.target as Node|null;
      if(target&&tabs?.contains(target)&&host&&!host.contains(target))setActive(false);
    };

    const observer=new MutationObserver(()=>wire());
    observer.observe(document.body,{childList:true,subtree:true});
    document.addEventListener("click",handleClick,true);
    wire();
    return()=>{observer.disconnect();document.removeEventListener("click",handleClick,true);host?.remove();};
  },[]);

  return <>
    {tabTarget?createPortal(
      <button type="button" className={`${settingsStyles.tab} ${active?settingsStyles.tabActive:""}`} onClick={()=>setActive(true)}>
        <span className={settingsStyles.tabIcon}>◉</span><span><strong>Камери</strong><small>Reolink, UID / P2P</small></span>
      </button>,tabTarget):null}
    {active&&contentTarget?createPortal(
      <div style={{position:"absolute",inset:0,zIndex:30,overflow:"auto",background:"var(--bg)",padding:"20px 24px 40px"}}><CameraSettingsPanel/></div>,contentTarget):null}
  </>;
}
