"use client";

import { useEffect } from "react";
import visualStyles from "./clients-vehicles-rich-cards.module.css";

type Vehicle = {
  id:string; plateNumber:string|null; vin:string|null; brand:string|null; model:string|null; year:number|null; mileageKm:number|null;
  engineName:string|null; engineVolumeCm3:number|null; fuelType:string|null; bodyType:string|null; driveType:string|null; vehicleType:string|null;
  turboLevClass:string|null; priceCoefficient:string|number; vehicleDataSource:string|null; vehicleDataConfidence:number|null; updatedAt:string;
  exteriorColorName?:string|null; exteriorColorHex?:string|null; exteriorColorConfirmed?:boolean;
  _count?:{workOrders?:number;diagnosticRequests?:number};
};
type Client = {id:string;name:string|null;phone:string;vehicles:Vehicle[];_count?:{workOrders?:number;diagnosticRequests?:number;vehicles?:number}};

function norm(value:string){return value.replace(/\s+/g,"").toLowerCase();}
function coefficient(value:string|number){const n=Number(value);return Number.isFinite(n)?`×${n.toFixed(2)}`:"×1.00";}
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
          meta.className='cvRichClientMeta';
          meta.innerHTML=`<span>Діагностики <b>${client._count?.diagnosticRequests??0}</b></span><span>Активність <b>${client._count?.workOrders??0} нарядів</b></span>`;
          identity.insertAdjacentElement('afterend',meta);
        }

        const buttons=Array.from(card.querySelectorAll<HTMLElement>('button[class*="vehicleButton"]'));
        buttons.forEach(button=>{
          const v=findVehicle(client,button.innerText);
          if(!v)return;
          ensureVehicleImage(button,v);
          if(button.querySelector('[data-rich-vehicle]'))return;
          const box=document.createElement('div');
          box.dataset.richVehicle='1';
          box.className='cvRichVehicle';
          const mileage=v.mileageKm?`${v.mileageKm.toLocaleString('uk-UA')} км`:'—';
          const source=v.vehicleDataSource||'CRM';
          const confidence=v.vehicleDataConfidence?`${v.vehicleDataConfidence}%`:'—';
          box.innerHTML=`
            <div class="cvRichFacts">
              <span><small>ПРОБІГ</small><b>${mileage}</b></span>
              <span><small>ДВИГУН</small><b>${engine(v)}</b></span>
              <span><small>ПАЛИВО</small><b>${v.fuelType||'—'}</b></span>
              <span><small>ПРИВІД</small><b>${v.driveType||'—'}</b></span>
            </div>
            <div class="cvRichTags">
              ${v.turboLevClass?`<span class="classTag">${v.turboLevClass}</span>`:''}
              <span>${coefficient(v.priceCoefficient)}</span>
              <span>${source} · ${confidence}</span>
              <span>ЗН ${v._count?.workOrders??0}</span>
              <span>Діагн. ${v._count?.diagnosticRequests??0}</span>
            </div>
            ${v.vin?`<div class="cvRichVin"><small>VIN</small><code>${v.vin}</code></div>`:''}`;
          button.appendChild(box);
        });
      });
    };

    const schedule=()=>{if(timer)window.clearTimeout(timer);timer=window.setTimeout(render,80);};
    fetch('/api/clients-vehicles?limit=100',{cache:'no-store'}).then(r=>r.json()).then(data=>{clients=(data.clients||[]) as Client[];render();}).catch(()=>{});
    const observer=new MutationObserver(schedule);
    observer.observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['data-theme','data-accent-color','data-vehicle-paint','style','class']});
    return()=>{stopped=true;observer.disconnect();if(timer)window.clearTimeout(timer);};
  },[]);
  return null;
}
