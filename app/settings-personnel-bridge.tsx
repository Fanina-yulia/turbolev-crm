"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { GlobalSmartSearch } from "./global-smart-search";
import { RouteTimelinePanel } from "./route-timeline-panel";

export function SettingsPersonnelBridge(){
  const [searchTarget,setSearchTarget]=useState<HTMLElement|null>(null);

  useEffect(()=>{
    const sidebar=document.querySelector<HTMLElement>(".sidebar");
    const brand=sidebar?.querySelector<HTMLElement>(".brand");
    if(!sidebar||!brand)return;
    const existing=sidebar.querySelector<HTMLElement>("[data-global-search-host]");
    if(existing){setSearchTarget(existing);return;}
    const host=document.createElement("div");
    host.dataset.globalSearchHost="true";
    brand.insertAdjacentElement("afterend",host);
    setSearchTarget(host);
    return()=>{setSearchTarget(null);host.remove();};
  },[]);

  return <>{searchTarget?createPortal(<GlobalSmartSearch/>,searchTarget):null}<RouteTimelinePanel/></>;
}
