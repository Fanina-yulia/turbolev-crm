"use client";

import { useEffect, useRef } from "react";
import { SettingsCenter } from "./settings-center";
import { WorkflowSettingsBridge } from "./workflow-settings-bridge";
import styles from "./settings-page.module.css";

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
      hostRef.current?.scrollIntoView({block:"start",inline:"nearest",behavior:"auto"});
    };

    const open=()=>{
      const button=hostRef.current?.querySelector<HTMLButtonElement>(".settingsNavButton");
      if(button)button.click();
      resetScroll();
    };

    resetScroll();
    frame=requestAnimationFrame(open);
    timer=window.setTimeout(open,80);

    return()=>{
      cancelAnimationFrame(frame);
      window.clearTimeout(timer);
      delete document.documentElement.dataset.settingsPage;
    };
  },[]);

  return <div ref={hostRef} className={styles.host}><WorkflowSettingsBridge/><SettingsCenter/></div>;
}
