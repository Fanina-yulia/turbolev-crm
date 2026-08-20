"use client";

import { useEffect } from "react";
import type {
  ClientVehiclesClientContract as Client,
  ClientVehiclesVehicleContract as Vehicle,
} from "@/src/lib/contracts/clients-vehicles";
import { parseClientsVehiclesPayload } from "@/src/lib/contracts/clients-vehicles-payload.parsers";
import visualStyles from "./clients-vehicles-rich-cards.module.css";

function norm(value:string){return value.replace(/\s+/g,"").toLowerCase();}
function coefficient(value:Vehicle["priceCoefficient"]){const n=Number(value);return Number.isFinite(n)?`×${n.toFixed(2)}`:"×1.00";}
function engine(v:Vehicle){if(v.engineName)return v.engineName;if(v.engineVolumeCm3)return `${(v.engineVolumeCm3/1000).toFixed(1)} л`;return "—";}
function findVehicle(client:Client, text:string){const hay=norm(text);return client.vehicles.find(v=>[v.plateNumber,v.vin,[v.brand,v.model,v.year].filter(Boolean).join(" ")].filter(Boolean).some(x=>hay.includes(norm(String(x)))))||client.vehicles[0];}

function currentThemePaint(){
  const root=document.documentElement;
  const explicit=root.dataset.vehiclePaint||root.dataset.accentColor||"";
  if(/^Imagin-(black|grey|white|blue|yellow|red|orange|green)$/i.test(explicit))return `Imagin-${explicit.split('-').pop()?.toLowerCase()}`;
  const hex=getComputedStyle(root).getPropertyValue('--orange').trim().replace('#','');
  if(!/^[0-9a-f]{6}$/i.test(hex))return 'Imagin-orange';
  const r=parseInt(hex.slice(0,2),16),g=parseInt(hex.slice(2,4),16),b=parseInt(hex.slice(4,6),16);
  if(r>g*1.35&&r>b*1.25)return g>100?'Imagin-orange':'Imagin-red';
  if(b>r*1.2&&b>g*1.05)return 'Imagin-blue';
  if(g>r*1.15&&g>b*1.05)return 'Imagin-green';
  return 'Imagin-orange';
}

function ensureVehicleImage(button:HTMLElement,v:Vehicle){
  button.classList.add(visualStyles.vehicleButtonEnhanced);
  let visual=button.querySelector<HTMLElement>('[data-vehicle-card-image]');
  if(!visual){
    visual=document.createElement('span');
    visual.dataset.vehicleCardImage='1';
    visual.className=visualStyles.visual;
    const img=document.createElement('img');
    img.loading='lazy';
    img.decoding='async';
    img.alt=[v.brand,v.model,v.year].filter(Boolean).join(' ')||'Автомобіль';
    visual.appendChild(img);
    if(v.exteriorColorConfirmed&&v.exteriorColorName){
      const dot=document.createElement('i');
      dot.className=visualStyles.colorDot;
      dot.title=`Підтверджений колір: ${v.exteriorColorName}`;
      if(v.exteriorColorHex&&/^#[0-9a-f]{6}$/i.test(v.exteriorColorHex))dot.style.backgroundColor=v.exteriorColorHex;
      visual.appendChild(dot);
    }
    const arrow=button.querySelector('em');
    if(arrow)button.insertBefore(visual,arrow);else button.appendChild(visual);
  }
  const img=visual.querySelector<HTMLImageElement>('img');
  if(img){
    const params=new URLSearchParams({theme:currentThemePaint(),v:v.updatedAt||''});
    const next=`/api/vehicles/${encodeURIComponent(v.id)}/image/render?${params}`;
    if(img.getAttribute('src')!==next)img.src=next;
  }
}

function buildRichVehicle(v:Vehicle){
  const box=document.createElement('div');
  box.dataset.richVehicle='1';
  box.className=visualStyles.richVehicle;

  const facts=document.createElement('div');
  facts.className=visualStyles.richFacts;
  const mileage=v.mileageKm?`${v.mileageKm.toLocaleString('uk-UA')} км`:'—';
  const factRows=[['ПРОБІГ',mileage],['ДВИГУН',engine(v)],['ПАЛИВО',v.fuelType||'—'],['ПРИВІД',v.driveType||'—']];
  for(const [label,value] of factRows){
    const item=document.createElement('span');
    const small=document.createElement('small'); small.textContent=label;
    const strong=document.createElement('b'); strong.textContent=value;
    item.append(small,strong); facts.appendChild(item);
  }
  box.appendChild(facts);

  const tags=document.createElement('div');
  tags.className=visualStyles.richTags;
  const source=v.vehicleDataSource||'CRM';
  const confidence=v.vehicleDataConfidence?`${v.vehicleDataConfidence}%`:'—';
  const tagValues=[v.turboLevClass||'',coefficient(v.priceCoefficient),`${source} · ${confidence}`,`ЗН ${v._count.workOrders}`,`Діагн. ${v._count.diagnosticRequests}`];
  tagValues.filter(Boolean).forEach((value,index)=>{
    const tag=document.createElement('span');
    tag.textContent=value;
    if(index===0&&v.turboLevClass)tag.className=visualStyles.classTag;
    tags.appendChild(tag);
  });
  box.appendChild(tags);

  if(v.vin){
    const vin=document.createElement('div');
    vin.className=visualStyles.richVin;
    const label=document.createElement('small'); label.textContent='VIN';
    const code=document.createElement('code'); code.textContent=v.vin;
    vin.append(label,code); box.appendChild(vin);
  }
  return box;
}

export function ClientsVehiclesRichCards(){
  useEffect(()=>{
    let stopped=false;
    let clients:Client[]=[];
    let timer:number|undefined;

    const render=()=>{
      if(stopped||!clients.length)return;
      const cards=Array.from(document.querySelectorAll<HTMLElement>('article[class*="clientCard"]'));
      cards.forEach(card=>{
        const phoneMatch=card.innerText.match(/\+?380[\d\s()-]{7,}/);
        const client=phoneMatch?clients.find(c=>norm(c.phone)===norm(phoneMatch[0])):clients.find(c=>c.name&&card.innerText.includes(c.name));
        if(!client)return;

        const identity=card.querySelector<HTMLElement>('button[class*="clientIdentity"]');
        if(identity&&!card.querySelector('[data-rich-client-meta]')){
          const meta=document.createElement('div');
          meta.dataset.richClientMeta='1';
          meta.className=visualStyles.richClientMeta;
          const diagnostics=document.createElement('span'); diagnostics.append('Діагностики '); const diagnosticsValue=document.createElement('b'); diagnosticsValue.textContent=String(client._count.diagnosticRequests); diagnostics.appendChild(diagnosticsValue);
          const activity=document.createElement('span'); activity.append('Активність '); const activityValue=document.createElement('b'); activityValue.textContent=`${client._count.workOrders} нарядів`; activity.appendChild(activityValue);
          meta.append(diagnostics,activity);
          identity.insertAdjacentElement('afterend',meta);
        }

        const buttons=Array.from(card.querySelectorAll<HTMLElement>('button[class*="vehicleButton"]'));
        buttons.forEach(button=>{
          const v=findVehicle(client,button.innerText);
          if(!v)return;
          ensureVehicleImage(button,v);
          if(!button.querySelector('[data-rich-vehicle]'))button.appendChild(buildRichVehicle(v));
        });
      });
    };

    const schedule=()=>{if(timer)window.clearTimeout(timer);timer=window.setTimeout(render,80);};
    fetch('/api/clients-vehicles?limit=100',{cache:'no-store'})
      .then(response=>response.json().catch(()=>null))
      .then(raw=>{const data=parseClientsVehiclesPayload(raw);if(!data)return;clients=data.clients;render();})
      .catch(()=>{});
    const observer=new MutationObserver(schedule);
    observer.observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['data-theme','data-accent-color','data-vehicle-paint','style','class']});
    return()=>{stopped=true;observer.disconnect();if(timer)window.clearTimeout(timer);};
  },[]);
  return null;
}