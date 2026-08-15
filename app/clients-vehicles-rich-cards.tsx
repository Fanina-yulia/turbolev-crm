"use client";

import { useEffect } from "react";

type Vehicle = {
  id:string; plateNumber:string|null; vin:string|null; brand:string|null; model:string|null; year:number|null; mileageKm:number|null;
  engineName:string|null; engineVolumeCm3:number|null; fuelType:string|null; bodyType:string|null; driveType:string|null; vehicleType:string|null;
  turboLevClass:string|null; priceCoefficient:string|number; vehicleDataSource:string|null; vehicleDataConfidence:number|null;
  _count?:{workOrders?:number;diagnosticRequests?:number};
};
type Client = {id:string;name:string|null;phone:string;vehicles:Vehicle[];_count?:{workOrders?:number;diagnosticRequests?:number;vehicles?:number}};

function norm(value:string){return value.replace(/\s+/g,"").toLowerCase();}
function coefficient(value:string|number){const n=Number(value);return Number.isFinite(n)?`×${n.toFixed(2)}`:"×1.00";}
function engine(v:Vehicle){if(v.engineName)return v.engineName;if(v.engineVolumeCm3)return `${(v.engineVolumeCm3/1000).toFixed(1)} л`;return "—";}
function findVehicle(client:Client, text:string){const hay=norm(text);return client.vehicles.find(v=>[v.plateNumber,v.vin,[v.brand,v.model,v.year].filter(Boolean).join(" ")].filter(Boolean).some(x=>hay.includes(norm(String(x)))))||client.vehicles[0];}

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
          if(button.querySelector('[data-rich-vehicle]'))return;
          const v=findVehicle(client,button.innerText);
          if(!v)return;
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
    observer.observe(document.body,{childList:true,subtree:true});
    return()=>{stopped=true;observer.disconnect();if(timer)window.clearTimeout(timer);};
  },[]);
  return null;
}
