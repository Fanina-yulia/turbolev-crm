"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { SecurityEnforcementControl } from "./security-enforcement-control";
import { SecuritySettingsPanelV2 } from "./security-settings-panel-v2";
import settingsStyles from "./settings-center.module.css";

export function SecuritySettingsBridge(){
  const [tabTarget,setTabTarget]=useState<HTMLElement|null>(null);
  const [contentTarget,setContentTarget]=useState<HTMLElement|null>(null);
  const [active,setActive]=useState(false);

  useEffect(()=>{
    let host:HTMLDivElement|null=null;let tabs:HTMLElement|null=null;
    const syncUrl=()=>setActive(new URL(window.location.href).searchParams.get("settingsTab")==="security");
    const wire=()=>{
      const heading=Array.from(document.querySelectorAll<HTMLHeadingElement>("h2")).find(node=>(node.textContent||"").trim()==="Налаштування");
      const modal=heading?.closest<HTMLElement>("section");if(!modal)return;
      tabs=modal.querySelector<HTMLElement>("aside");const main=tabs?.parentElement?.querySelector<HTMLElement>(":scope > main")||null;if(!tabs||!main)return;
      main.style.position="relative";host=tabs.querySelector<HTMLDivElement>('[data-security-settings-tab="true"]');
      if(!host){host=document.createElement("div");host.dataset.securitySettingsTab="true";host.style.display="contents";tabs.appendChild(host)}
      setTabTarget(current=>current===host?current:host);setContentTarget(current=>current===main?current:main);
    };
    const onExternalTab=(event:Event)=>setActive((event as CustomEvent<string>).detail==="security");
    const handleClick=(event:MouseEvent)=>{const target=event.target as Node|null;if(target&&tabs?.contains(target)&&host&&!host.contains(target))setActive(false)};
    const observer=new MutationObserver(()=>wire());observer.observe(document.body,{childList:true,subtree:true});document.addEventListener("click",handleClick,true);window.addEventListener("turbolev:settings-tab",onExternalTab);window.addEventListener("popstate",syncUrl);wire();syncUrl();
    return()=>{observer.disconnect();document.removeEventListener("click",handleClick,true);window.removeEventListener("turbolev:settings-tab",onExternalTab);window.removeEventListener("popstate",syncUrl);host?.remove()};
  },[]);

  const activate=()=>{setActive(true);const url=new URL(window.location.href);url.searchParams.set("section","settings");url.searchParams.set("settingsTab","security");window.history.pushState({},"",`${url.pathname}${url.search}${url.hash}`);window.dispatchEvent(new CustomEvent("turbolev:settings-tab",{detail:"security"}))};
  return <>{tabTarget?createPortal(<button type="button" className={`${settingsStyles.tab} ${active?settingsStyles.tabActive:""}`} onClick={activate}><span className={settingsStyles.tabIcon}>⌾</span><span><strong>Ролі та доступи</strong><small>Кабінети, ролі, scope, винятки</small></span></button>,tabTarget):null}{active&&contentTarget?createPortal(<div style={{position:"absolute",inset:0,zIndex:40,overflow:"auto",background:"var(--bg)",padding:"20px 24px 40px"}}><SecurityEnforcementControl/><SecuritySettingsPanelV2/></div>,contentTarget):null}</>;
}
