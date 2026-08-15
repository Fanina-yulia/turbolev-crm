"use client";

import { useEffect, useRef } from "react";
import { SettingsCenter } from "./settings-center";
import styles from "./settings-page.module.css";

export function SettingsPage(){
  const hostRef=useRef<HTMLDivElement|null>(null);

  useEffect(()=>{
    let frame=0;
    let timer=0;
    let observer:MutationObserver|null=null;

    const layout=()=>{
      const headings=Array.from(document.querySelectorAll<HTMLHeadingElement>("h2"));
      const heading=headings.find(node=>(node.textContent||"").trim()==="Налаштування");
      if(!heading)return false;
      const modal=heading.closest<HTMLElement>("section");
      const backdrop=modal?.parentElement as HTMLElement|null;
      if(!modal||!backdrop)return false;

      const sidebar=document.querySelector<HTMLElement>(".sidebar");
      const left=Math.round(sidebar?.getBoundingClientRect().width||0);
      Object.assign(backdrop.style,{
        position:"fixed",left:`${left}px`,right:"0",top:"0",bottom:"0",inset:"auto 0 0 auto",
        zIndex:"80",background:"var(--bg)",backdropFilter:"none",display:"block",padding:"0",overflow:"hidden"
      });
      Object.assign(modal.style,{
        width:"100%",height:"100%",maxWidth:"none",maxHeight:"none",border:"0",borderRadius:"0",
        boxShadow:"none",background:"var(--bg)",margin:"0"
      });
      const header=heading.closest("header");
      const close=header?.querySelector<HTMLButtonElement>("button");
      if(close)close.style.display="none";
      document.documentElement.dataset.settingsPage="true";
      return true;
    };

    const openSettings=()=>{
      const button=hostRef.current?.querySelector<HTMLButtonElement>(".settingsNavButton");
      if(button&&!document.querySelector('html[data-settings-page="true"]'))button.click();
      frame=requestAnimationFrame(()=>layout());
    };

    openSettings();
    observer=new MutationObserver(()=>layout());
    observer.observe(document.body,{childList:true,subtree:true});
    window.addEventListener("resize",layout);
    timer=window.setTimeout(()=>layout(),100);

    return()=>{
      cancelAnimationFrame(frame);window.clearTimeout(timer);observer?.disconnect();window.removeEventListener("resize",layout);
      delete document.documentElement.dataset.settingsPage;
      const headings=Array.from(document.querySelectorAll<HTMLHeadingElement>("h2"));
      const heading=headings.find(node=>(node.textContent||"").trim()==="Налаштування");
      const header=heading?.closest("header");
      const close=header?.querySelector<HTMLButtonElement>("button");
      if(close){close.style.display="";close.click();}
    };
  },[]);

  return <div ref={hostRef} className={styles.host}><SettingsCenter/></div>;
}
