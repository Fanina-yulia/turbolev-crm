"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ClientCommunicationActions } from "./client-communication-actions";

type Target={host:HTMLElement;clientId:string|null;vehicleId:string|null;phone:string|null}|null;

function text(el:Element|null){return (el?.textContent||"").replace(/\s+/g," ").trim().toUpperCase()}
function ensureHost(parent:HTMLElement,kind:string){let host=parent.querySelector<HTMLElement>(":scope > .clientCommunicationHost");if(!host){host=document.createElement("div");host.className="clientCommunicationHost";parent.appendChild(host)}host.dataset.kind=kind;return host}
function phoneFrom(el:Element|null){const raw=el?.textContent||"";const match=raw.match(/(?:\+?38)?0\d{2}(?:[\s().-]*\d){7}/);return match?.[0]?.trim()||null}
function findTarget():Target{
  const url=new URL(window.location.href);const clientId=url.searchParams.get("clientId");const vehicleId=url.searchParams.get("vehicleId");
  const asides=Array.from(document.querySelectorAll<HTMLElement>("aside"));
  if(vehicleId){
    const drawer=asides.find(a=>text(a).includes("КАРТКА АВТОМОБІЛЯ"));
    if(drawer){drawer.dataset.clientCommunicationDrawer="1";const owner=Array.from(drawer.querySelectorAll<HTMLElement>("section")).find(s=>text(s.querySelector("h3"))==="ВЛАСНИК");if(owner){owner.dataset.clientCommunicationOwner="1";return{host:ensureHost(owner,"vehicle"),clientId:null,vehicleId,phone:phoneFrom(owner)}}}
  }
  if(clientId){
    const drawer=asides.find(a=>text(a).includes("КАРТКА КЛІЄНТА"));
    if(drawer){drawer.dataset.clientCommunicationDrawer="1";const header=drawer.querySelector<HTMLElement>("header");if(header){header.dataset.clientCommunicationHeader="1";return{host:ensureHost(header,"client"),clientId,vehicleId:null,phone:phoneFrom(header)}}}
  }
  const legacy=asides.find(a=>text(a).includes("КАРТА КЛІЄНТА"));
  if(legacy){
    const head=legacy.querySelector<HTMLElement>(".clientDrawerHead");const legacyPhone=phoneFrom(head||legacy);if(head&&(clientId||legacyPhone)){legacy.dataset.clientCommunicationDrawer="1";head.dataset.clientCommunicationHeader="1";return{host:ensureHost(head,"legacy-client"),clientId:clientId||null,vehicleId:null,phone:legacyPhone}}
  }
  return null;
}

export function ClientCommunicationBridge(){
  const[target,setTarget]=useState<Target>(null);
  useEffect(()=>{
    let frame=0;const sync=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{const next=findTarget();setTarget(current=>current?.host===next?.host&&current?.clientId===next?.clientId&&current?.vehicleId===next?.vehicleId&&current?.phone===next?.phone?current:next)})};
    sync();const observer=new MutationObserver(sync);observer.observe(document.body,{childList:true,subtree:true});window.addEventListener("popstate",sync);window.addEventListener("turbolev:data-changed",sync as EventListener);return()=>{cancelAnimationFrame(frame);observer.disconnect();window.removeEventListener("popstate",sync);window.removeEventListener("turbolev:data-changed",sync as EventListener)};
  },[]);
  if(!target)return null;
  return createPortal(<ClientCommunicationActions clientId={target.clientId} vehicleId={target.vehicleId} phone={target.phone}/>,target.host);
}
