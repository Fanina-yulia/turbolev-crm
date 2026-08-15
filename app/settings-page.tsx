"use client";

import { useEffect, useRef } from "react";
import { SettingsCenter } from "./settings-center";
import { WorkflowSettingsBridge } from "./workflow-settings-bridge";
import { SecuritySettingsBridge } from "./security-settings-bridge";
import { CameraSettingsBridge } from "./camera-settings-bridge";
import { BinotelCallbacksSettings } from "./binotel-callbacks-settings";
import styles from "./settings-page.module.css";

const SETTINGS_LABELS:Record<string,string>={
  schedule:"Графік",
  personnel:"Персонал",
  suppliers:"Постачальники",
  warehouse:"Склад",
  workPrices:"Прайс робіт",
  posts:"Пости",
  markup:"Націнка",
  cash:"Каса",
  integrations:"Інтеграції",
  cameras:"Камери",
  appearance:"Оформлення",
  workflow:"Процеси та статуси",
  security:"Ролі та доступи",
};

export function SettingsPage(){
  const hostRef=useRef<HTMLDivElement|null>(null);

  useEffect(()=>{
    document.documentElement.dataset.settingsPage="true";
    let frame=0;
    let timer=0;
    let retryTimer=0;
    let observer:MutationObserver|null=null;
    let requestedTab=new URL(window.location.href).searchParams.get("settingsTab")||"schedule";
    let appliedTab:string|null=null;

    const getSettingsShell=()=>{
      const heading=Array.from(document.querySelectorAll<HTMLHeadingElement>("h2")).find(node=>(node.textContent||"").trim()==="Налаштування");
      const modal=heading?.closest<HTMLElement>("section")||null;
      const layout=modal?.querySelector<HTMLElement>('div[class*="layout"]')||null;
      const tabs=layout?.querySelector<HTMLElement>(":scope > aside")||null;
      const content=layout?.querySelector<HTMLElement>(":scope > main")||null;
      const backdrop=modal?.parentElement as HTMLElement|null;
      return {heading,modal,layout,tabs,content,backdrop};
    };

    const normalizeLayout=()=>{
      const {modal,layout,tabs,content,backdrop}=getSettingsShell();
      if(!modal||!layout||!content)return false;

      if(tabs){
        tabs.style.setProperty("display","none","important");
        tabs.style.setProperty("width","0","important");
        tabs.style.setProperty("min-width","0","important");
        tabs.style.setProperty("padding","0","important");
        tabs.style.setProperty("margin","0","important");
        tabs.style.setProperty("border","0","important");
      }

      layout.style.setProperty("display","block","important");
      layout.style.setProperty("grid-template-columns","1fr","important");
      layout.style.setProperty("width","100%","important");
      layout.style.setProperty("min-height","0","important");

      content.style.setProperty("width","100%","important");
      content.style.setProperty("max-width","none","important");
      content.style.setProperty("min-width","0","important");
      content.style.setProperty("overflow","visible","important");
      content.style.setProperty("padding","var(--settings-content-padding)","important");

      modal.style.setProperty("width","100%","important");
      modal.style.setProperty("max-width","none","important");
      modal.style.setProperty("height","auto","important");
      modal.style.setProperty("min-height","100%","important");
      modal.style.setProperty("max-height","none","important");
      modal.style.setProperty("overflow","visible","important");
      modal.style.setProperty("border","0","important");
      modal.style.setProperty("border-radius","0","important");
      modal.style.setProperty("box-shadow","none","important");

      if(backdrop){
        backdrop.style.setProperty("display","block","important");
        backdrop.style.setProperty("left","var(--crm-sidebar-width)","important");
        backdrop.style.setProperty("right","0","important");
        backdrop.style.setProperty("top","0","important");
        backdrop.style.setProperty("bottom","0","important");
        backdrop.style.setProperty("padding","0","important");
        backdrop.style.setProperty("overflow-y","auto","important");
        backdrop.style.setProperty("overflow-x","hidden","important");
        backdrop.style.setProperty("background","var(--bg)","important");
        backdrop.style.setProperty("backdrop-filter","none","important");
      }
      return true;
    };

    const resetScroll=()=>{
      window.scrollTo({top:0,left:0,behavior:"auto"});
      document.documentElement.scrollTop=0;
      document.body.scrollTop=0;
      const {backdrop,content}=getSettingsShell();
      if(backdrop)backdrop.scrollTop=0;
      if(content)content.scrollTop=0;
    };

    const findInternalTab=(id:string)=>{
      const {tabs}=getSettingsShell();
      if(!tabs)return null;
      const label=SETTINGS_LABELS[id]||SETTINGS_LABELS.schedule;
      return Array.from(tabs.querySelectorAll<HTMLButtonElement>("button")).find(node=>{
        const text=(node.textContent||"").replace(/\s+/g," ").trim();
        return text.includes(label);
      })||null;
    };

    const applyRequestedTab=(force=false)=>{
      normalizeLayout();
      if(!force&&appliedTab===requestedTab)return true;
      const button=findInternalTab(requestedTab);
      if(!button)return false;
      appliedTab=requestedTab;
      button.click();
      window.requestAnimationFrame(()=>{normalizeLayout();resetScroll();});
      return true;
    };

    const requestTab=(id?:string|null)=>{
      requestedTab=id&&SETTINGS_LABELS[id]?id:"schedule";
      appliedTab=null;
      if(applyRequestedTab())return;
      window.clearTimeout(retryTimer);
      retryTimer=window.setTimeout(()=>applyRequestedTab(),80);
    };

    const open=()=>{
      const button=hostRef.current?.querySelector<HTMLButtonElement>(".settingsNavButton");
      if(button)button.click();
      requestTab(new URL(window.location.href).searchParams.get("settingsTab"));
      resetScroll();
    };

    const onTab=(event:Event)=>requestTab((event as CustomEvent<string>).detail);
    const onPop=()=>requestTab(new URL(window.location.href).searchParams.get("settingsTab"));

    observer=new MutationObserver(()=>{
      normalizeLayout();
      if(appliedTab!==requestedTab)applyRequestedTab();
    });
    observer.observe(document.body,{childList:true,subtree:true});

    resetScroll();
    frame=requestAnimationFrame(open);
    timer=window.setTimeout(open,80);
    window.addEventListener("turbolev:settings-tab",onTab);
    window.addEventListener("popstate",onPop);

    return()=>{
      cancelAnimationFrame(frame);
      window.clearTimeout(timer);
      window.clearTimeout(retryTimer);
      observer?.disconnect();
      window.removeEventListener("turbolev:settings-tab",onTab);
      window.removeEventListener("popstate",onPop);
      delete document.documentElement.dataset.settingsPage;
    };
  },[]);

  return <div ref={hostRef} className={styles.host}><WorkflowSettingsBridge/><SecuritySettingsBridge/><CameraSettingsBridge/><BinotelCallbacksSettings/><SettingsCenter/></div>;
}
