"use client";

import { useEffect, useRef } from "react";
import { SettingsCenter } from "./settings-center";
import { WorkflowSettingsBridge } from "./workflow-settings-bridge";
import styles from "./settings-page.module.css";

const SETTINGS_LABELS:Record<string,string>={schedule:"Графік",personnel:"Персонал",clients:"Клієнти",suppliers:"Постачальники",warehouse:"Склад",workPrices:"Прайс робіт",posts:"Пости",markup:"Націнка",cash:"Каса",integrations:"Інтеграції",appearance:"Оформлення"};

export function SettingsPage(){
  const hostRef=useRef<HTMLDivElement|null>(null);

  useEffect(()=>{
    document.documentElement.dataset.settingsPage="true";
    let frame=0;
    let timer=0;

    const resetScroll=()=>{
      window.scrollTo({top:0,left:0,behavior:"auto"});
      document.documentElement.scrollTop=0;
      document.body.scrollTop=0;
      const heading=Array.from(document.querySelectorAll<HTMLHeadingElement>("h2")).find(node=>(node.textContent||"").trim()==="Налаштування");
      const modal=heading?.closest<HTMLElement>("section");
      const backdrop=modal?.parentElement as HTMLElement|null;
      if(backdrop)backdrop.scrollTop=0;
      const content=modal?.querySelector<HTMLElement>('main[class*="content"]');
      if(content)content.scrollTop=0;
    };

    const selectTab=(id?:string|null)=>{
      const label=SETTINGS_LABELS[id||""]||"Графік";
      const candidates=Array.from(document.querySelectorAll<HTMLButtonElement>("button"));
      const button=candidates.find(node=>node.closest('[class*="settings-center_tabs"]')&&(node.textContent||"").includes(label));
      button?.click();
      window.requestAnimationFrame(resetScroll);
    };

    const open=()=>{
      const button=hostRef.current?.querySelector<HTMLButtonElement>(".settingsNavButton");
      if(button)button.click();
      const url=new URL(window.location.href);
      window.setTimeout(()=>selectTab(url.searchParams.get("settingsTab")),0);
      window.setTimeout(resetScroll,0);
    };

    const onTab=(event:Event)=>selectTab((event as CustomEvent<string>).detail);
    const onPop=()=>selectTab(new URL(window.location.href).searchParams.get("settingsTab"));

    resetScroll();
    frame=requestAnimationFrame(open);
    timer=window.setTimeout(open,80);
    window.addEventListener("turbolev:settings-tab",onTab);
    window.addEventListener("popstate",onPop);

    return()=>{
      cancelAnimationFrame(frame);
      window.clearTimeout(timer);
      window.removeEventListener("turbolev:settings-tab",onTab);
      window.removeEventListener("popstate",onPop);
      delete document.documentElement.dataset.settingsPage;
    };
  },[]);

  return <div ref={hostRef} className={styles.host}><WorkflowSettingsBridge/><SettingsCenter/></div>;
}
