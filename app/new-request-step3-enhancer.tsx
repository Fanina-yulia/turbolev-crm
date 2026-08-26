"use client";

import { useEffect } from "react";

type VehicleSnapshot={
  make:string;
  model:string;
  year:string;
  engine:string;
  engineVolume:string;
  fuelType:string;
  bodyType:string;
  grossWeight:string;
  driveType:string;
  vehicleType:string;
};

const EMPTY_VEHICLE:VehicleSnapshot={make:"",model:"",year:"",engine:"",engineVolume:"",fuelType:"",bodyType:"",grossWeight:"",driveType:"",vehicleType:""};
const VEHICLE_FIELDS:Array<[keyof VehicleSnapshot,string]>=[
  ["make","Марка"],
  ["model","Модель"],
  ["year","Рік"],
  ["engine","Двигун / модифікація"],
  ["engineVolume","Об’єм двигуна"],
  ["fuelType","Паливо"],
  ["bodyType","Тип кузова"],
  ["grossWeight","Повна маса"],
  ["driveType","Привід"],
  ["vehicleType","Тип ТЗ"],
];

function normalizedLabel(value:string){return value.replace(/\*/g,"").replace(/\s+/g," ").trim().toLocaleLowerCase("uk-UA")}
function fieldValue(root:HTMLElement,labelText:string){
  const wanted=normalizedLabel(labelText);
  for(const label of Array.from(root.querySelectorAll("label"))){
    const caption=label.querySelector("span")?.textContent||"";
    if(!normalizedLabel(caption).startsWith(wanted))continue;
    const control=label.querySelector("input,select,textarea") as HTMLInputElement|HTMLSelectElement|HTMLTextAreaElement|null;
    if(control)return control.value;
  }
  return "";
}
function readVehicle(root:HTMLElement):VehicleSnapshot{
  return Object.fromEntries(VEHICLE_FIELDS.map(([key,label])=>[key,fieldValue(root,label)])) as VehicleSnapshot;
}
function stepNumber(root:HTMLElement){
  const text=root.querySelector(".requestStepTitle small")?.textContent||"";
  return Number(/(\d+)/.exec(text)?.[1]||0);
}
function setTextareaValue(textarea:HTMLTextAreaElement,value:string){
  const setter=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value")?.set;
  if(setter)setter.call(textarea,value);else textarea.value=value;
  textarea.dispatchEvent(new Event("input",{bubbles:true}));
}
function stripCategorySuffix(value:string){
  return value.replace(/\n\nПеревірити:\s*[^\n]*$/u,"").trimEnd();
}
function syncComplaint(textarea:HTMLTextAreaElement,selected:Set<string>){
  const base=stripCategorySuffix(textarea.value);
  const categories=Array.from(selected);
  const next=categories.length?`${base}${base?"\n\n":""}Перевірити: ${categories.join(", ")}`:base;
  setTextareaValue(textarea,next);
}
function ensurePricingShadow(modal:HTMLElement,vehicle:VehicleSnapshot){
  let shadow=modal.querySelector("[data-pricing-vehicle-shadow]") as HTMLDivElement|null;
  if(!shadow){
    shadow=document.createElement("div");
    shadow.dataset.pricingVehicleShadow="true";
    shadow.hidden=true;
    modal.appendChild(shadow);
  }
  shadow.replaceChildren();
  for(const [key,labelText] of VEHICLE_FIELDS){
    const label=document.createElement("label");
    const caption=document.createElement("span");
    const input=document.createElement("input");
    caption.textContent=labelText;
    input.value=vehicle[key]||"";
    label.append(caption,input);
    shadow.appendChild(label);
  }
}

export function NewRequestStep3Enhancer(){
  useEffect(()=>{
    let vehicle:VehicleSnapshot={...EMPTY_VEHICLE};
    let selected=new Set<string>();
    let lastModal:HTMLElement|null=null;

    const tick=()=>{
      const modal=(document.querySelector('[data-page="new-request"]')||document.querySelector(".requestModal")) as HTMLElement|null;
      if(!modal){
        vehicle={...EMPTY_VEHICLE};
        selected=new Set<string>();
        lastModal=null;
        return;
      }
      if(modal!==lastModal){
        vehicle={...EMPTY_VEHICLE};
        selected=new Set<string>();
        lastModal=modal;
      }
      const step=stepNumber(modal);
      if(step===1){
        const next=readVehicle(modal);
        if(next.make||next.model||next.year||next.engine)vehicle=next;
      }
      if(step===2&&(vehicle.make||vehicle.model))ensurePricingShadow(modal,vehicle);
      if(step!==3)return;

      for(const helper of Array.from(modal.querySelectorAll("div"))){
        const text=helper.textContent?.trim()||"";
        if(text==="Щоб побачити ціни з прайсу, уточніть марку та модель авто на кроці 2. Ручні роботи можна додавати вже зараз."){
          helper.textContent="Дані автомобіля вже підтверджені. Якщо прайс не завантажився, додайте роботу вручну — ціну можна уточнити після діагностики.";
        }
      }

      const textarea=modal.querySelector(".fastComplaint textarea") as HTMLTextAreaElement|null;
      const chips=Array.from(modal.querySelectorAll(".fastCategoryTags button")) as HTMLButtonElement[];
      for(const chip of chips)chip.classList.toggle("selected",selected.has((chip.textContent||"").trim()));

      if(textarea){
        textarea.required=true;
        textarea.setAttribute("aria-required","true");
        let hint=modal.querySelector("[data-complaint-required-hint]") as HTMLDivElement|null;
        if(!hint){
          hint=document.createElement("div");
          hint.dataset.complaintRequiredHint="true";
          hint.style.marginTop="6px";
          hint.style.fontSize="12px";
          hint.style.color="var(--muted)";
          textarea.insertAdjacentElement("afterend",hint);
        }
        const freeText=stripCategorySuffix(textarea.value).trim();
        hint.textContent=freeText?"":"Обов’язково коротко опишіть, що саме турбує клієнта.";
        hint.style.color=freeText?"var(--muted)":"#c2410c";
      }
    };

    const onClick=(event:MouseEvent)=>{
      const target=event.target as HTMLElement;
      const modal=target.closest(".requestModal") as HTMLElement|null;
      if(!modal||stepNumber(modal)!==3)return;

      const chip=target.closest(".fastCategoryTags button") as HTMLButtonElement|null;
      if(chip){
        event.preventDefault();
        event.stopPropagation();
        const label=(chip.textContent||"").trim();
        if(!label)return;
        if(selected.has(label))selected.delete(label);else selected.add(label);
        const textarea=modal.querySelector(".fastComplaint textarea") as HTMLTextAreaElement|null;
        if(textarea)syncComplaint(textarea,selected);
        tick();
        return;
      }

      const button=target.closest("button") as HTMLButtonElement|null;
      if(!button||!(button.textContent||"").includes("Далі"))return;
      const textarea=modal.querySelector(".fastComplaint textarea") as HTMLTextAreaElement|null;
      if(!textarea)return;
      const freeText=stripCategorySuffix(textarea.value).trim();
      if(freeText)return;
      event.preventDefault();
      event.stopPropagation();
      textarea.focus();
      textarea.setCustomValidity("Коротко опишіть, що турбує клієнта.");
      textarea.reportValidity();
      window.setTimeout(()=>textarea.setCustomValidity(""),0);
      tick();
    };

    const onInput=(event:Event)=>{
      const target=event.target as HTMLElement;
      if(target.matches(".fastComplaint textarea"))window.setTimeout(tick,0);
    };

    document.addEventListener("click",onClick,true);
    document.addEventListener("input",onInput,true);
    const timer=window.setInterval(tick,140);
    tick();
    return()=>{
      document.removeEventListener("click",onClick,true);
      document.removeEventListener("input",onInput,true);
      window.clearInterval(timer);
    };
  },[]);
  return null;
}
