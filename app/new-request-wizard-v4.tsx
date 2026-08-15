"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  classifyVehicle,
  inferEngineVolume,
  type TurboLevClass,
  type VehicleType,
} from "@/src/domain/vehicle-intelligence";

type LookupState = "idle" | "searching" | "found" | "not-found" | "unavailable";
type VehicleDataStatus = "UNKNOWN" | "AUTO" | "MANUAL" | "CONFIRMED";
type PreliminaryWork = { id?:string; name:string; quantity?:number; total?:number; manual?:boolean };

type RequestForm = {
  customerName:string;
  phone:string;
  source:string;
  responsible:string;
  plate:string;
  vin:string;
  make:string;
  model:string;
  year:string;
  mileage:string;
  engine:string;
  engineVolume:string;
  fuelType:string;
  bodyType:string;
  grossWeight:string;
  driveType:string;
  vehicleType:VehicleType;
  turboLevClass:TurboLevClass;
  priceCoefficient:string;
  classificationSource:string;
  classificationConfidence:string;
  classificationReason:string;
  manualClassOverride:boolean;
  vehicleDataSource:string;
  vehicleDataConfidence:string;
  vehicleDataStatus:VehicleDataStatus;
  category:string;
  complaint:string;
  appointmentDate:string;
  appointmentTime:string;
  preliminaryAmount:string;
  comment:string;
  locationId:string;
  postId:string;
  mechanicId:string;
};

type VehicleCandidate = Partial<RequestForm> & {
  id?:string|null;
  clientId?:string|null;
  clientName?:string|null;
  clientPhone?:string|null;
};

type ClientVehicle = {
  id:string;
  plateNumber?:string|null;
  vin?:string|null;
  brand?:string|null;
  model?:string|null;
  year?:number|null;
  mileageKm?:number|null;
  engineName?:string|null;
  engineVolumeCm3?:number|null;
  fuelType?:string|null;
  bodyType?:string|null;
  grossWeightKg?:number|null;
  driveType?:string|null;
  vehicleType?:string|null;
  turboLevClass?:string|null;
  priceCoefficient?:number|string|null;
  classificationSource?:string|null;
  classificationConfidence?:number|null;
  manualClassOverride?:boolean|null;
  vehicleDataSource?:string|null;
  vehicleDataConfidence?:number|null;
};

type ClientLookup = {
  id:string;
  name?:string|null;
  phone:string;
  vehicles:ClientVehicle[];
};

type MakeOption = { id:number|null; name:string };
type ModelOption = { id:number|null; name:string; makeName:string };
type OpenRequestDetail = {
  name?:string;
  phone?:string;
  source?:string;
  responsible?:string;
  plate?:string;
  vin?:string;
  appointmentDate?:string;
  appointmentTime?:string;
  inquiryId?:string;
};
type UserOption = { id:string; name:string };
type PlannerResource = { id:string; name:string };
type PlannerLocation = {
  id:string;
  name:string;
  posts:PlannerResource[];
  mechanics:PlannerResource[];
};
type VinApiResponse = {
  status:"FOUND"|"NOT_FOUND"|"INVALID_VIN"|"LOOKUP_UNAVAILABLE";
  source?:string;
  sourceDetail?:string;
  confidence?:number;
  warning?:string|null;
  message?:string;
  vehicle?:{
    make?:string|null;
    model?:string|null;
    year?:number|null;
    trim?:string|null;
    series?:string|null;
    bodyType?:string|null;
    vehicleType?:string|null;
    engine?:string|null;
    engineVolumeL?:number|null;
    fuelType?:string|null;
    secondaryFuelType?:string|null;
    driveType?:string|null;
    transmission?:string|null;
  }|null;
};

type Props = { showButton?:boolean };

const STORAGE_KEY = "turbolev-manual-requests-v1";
const MANAGER_KEY = "turbolev-current-manager";
const categories = ["Ходова","Гальма","Двигун","Електрика","ТО / мастило","Комп. діагностика","Кондиціонер","Інше"];
const sources = ["Інше","Телефон","Binotel","Instagram","Facebook","TikTok","OLX","Сайт","Google Maps","Viber","WhatsApp","Рекомендація","Заїхав без запису"];
const years = Array.from({length:new Date().getFullYear()-1979+2},(_,i)=>String(new Date().getFullYear()+1-i));

const initialForm:RequestForm = {
  customerName:"",
  phone:"",
  source:"Інше",
  responsible:"",
  plate:"",
  vin:"",
  make:"",
  model:"",
  year:"",
  mileage:"",
  engine:"",
  engineVolume:"",
  fuelType:"",
  bodyType:"",
  grossWeight:"",
  driveType:"",
  vehicleType:"UNKNOWN",
  turboLevClass:"UNKNOWN",
  priceCoefficient:"1.00",
  classificationSource:"UNKNOWN",
  classificationConfidence:"0",
  classificationReason:"Очікуємо дані автомобіля",
  manualClassOverride:false,
  vehicleDataSource:"UNKNOWN",
  vehicleDataConfidence:"0",
  vehicleDataStatus:"UNKNOWN",
  category:"",
  complaint:"",
  appointmentDate:"",
  appointmentTime:"",
  preliminaryAmount:"",
  comment:"",
  locationId:"",
  postId:"",
  mechanicId:"",
};

function normalizePlate(value:string){
  return value.toUpperCase().replace(/[^A-ZА-ЯІЇЄ0-9]/g,"").slice(0,10);
}
function normalizeVin(value:string){
  return value.toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g,"").slice(0,17);
}
function normalizePhone(value:string){
  let digits=value.replace(/\D/g,"");
  if(!digits)return "";
  if(digits.startsWith("380"))return digits.slice(0,12);
  if(digits.startsWith("0"))return `38${digits}`.slice(0,12);
  if(digits.length<=9)return `380${digits}`.slice(0,12);
  return digits.slice(0,12);
}
function formatPhone(value:string){
  const digits=normalizePhone(value);
  if(!digits)return "";
  const local=digits.startsWith("380")?digits.slice(3,12):digits;
  const parts=[local.slice(0,2),local.slice(2,5),local.slice(5,7),local.slice(7,9)].filter(Boolean);
  return `+380 ${parts.join(" ")}`.trim();
}
function classificationPatch(input:Partial<RequestForm>){
  const result=classifyVehicle({
    make:input.make,
    model:input.model,
    year:input.year,
    engine:input.engine,
    engineVolume:input.engineVolume||inferEngineVolume(input.engine),
    fuelType:input.fuelType,
    bodyType:input.bodyType,
    grossWeight:input.grossWeight,
    driveType:input.driveType,
    vehicleType:input.vehicleType,
  });
  return {
    vehicleType:result.vehicleType,
    turboLevClass:result.turboLevClass,
    priceCoefficient:result.priceCoefficient.toFixed(2),
    classificationSource:result.source,
    classificationConfidence:String(result.confidence),
    classificationReason:result.reason,
  };
}
function candidateFromClientVehicle(v:ClientVehicle):VehicleCandidate{
  return {
    id:v.id,
    plate:v.plateNumber||"",
    vin:v.vin||"",
    make:v.brand||"",
    model:v.model||"",
    year:v.year?String(v.year):"",
    mileage:v.mileageKm?String(v.mileageKm):"",
    engine:v.engineName||"",
    engineVolume:v.engineVolumeCm3?String(v.engineVolumeCm3/1000):"",
    fuelType:v.fuelType||"",
    bodyType:v.bodyType||"",
    grossWeight:v.grossWeightKg?String(v.grossWeightKg):"",
    driveType:v.driveType||"",
    vehicleType:(v.vehicleType as VehicleType)||"UNKNOWN",
    turboLevClass:(v.turboLevClass as TurboLevClass)||"UNKNOWN",
    priceCoefficient:v.priceCoefficient?Number(v.priceCoefficient).toFixed(2):"1.00",
    classificationSource:v.classificationSource||"CRM",
    classificationConfidence:String(v.classificationConfidence??100),
    classificationReason:"Дані з карти клієнта",
    manualClassOverride:Boolean(v.manualClassOverride),
    vehicleDataSource:v.vehicleDataSource||"CRM",
    vehicleDataConfidence:String(v.vehicleDataConfidence??100),
    vehicleDataStatus:"AUTO",
  };
}
function vehicleTitle(form:RequestForm){
  return [form.make,form.model,form.year].filter(Boolean).join(" ") || form.plate || form.vin || "Автомобіль";
}

export function NewRequestWizardV4({showButton=true}:Props){
  const [open,setOpen]=useState(false);
  const [step,setStep]=useState(1);
  const [form,setForm]=useState<RequestForm>(initialForm);
  const [error,setError]=useState("");
  const [success,setSuccess]=useState("");
  const [saving,setSaving]=useState(false);
  const [plateLookupState,setPlateLookupState]=useState<LookupState>("idle");
  const [phoneLookupState,setPhoneLookupState]=useState<LookupState>("idle");
  const [vinLookupState,setVinLookupState]=useState<LookupState>("idle");
  const [vinMessage,setVinMessage]=useState("");
  const [foundClient,setFoundClient]=useState<ClientLookup|null>(null);
  const [selectedClientId,setSelectedClientId]=useState<string|null>(null);
  const [foundVehicle,setFoundVehicle]=useState<VehicleCandidate|null>(null);
  const [vehicleConflict,setVehicleConflict]=useState<VehicleCandidate|null>(null);
  const [allowReassign,setAllowReassign]=useState(false);
  const [makes,setMakes]=useState<MakeOption[]>([]);
  const [models,setModels]=useState<ModelOption[]>([]);
  const [catalogLoading,setCatalogLoading]=useState(false);
  const [users,setUsers]=useState<UserOption[]>([]);
  const [locations,setLocations]=useState<PlannerLocation[]>([]);
  const [plannerLoading,setPlannerLoading]=useState(false);
  const [preliminaryWorks,setPreliminaryWorks]=useState<PreliminaryWork[]>([]);
  const [preliminaryTotal,setPreliminaryTotal]=useState(0);

  const canLeaveClient=normalizePhone(form.phone).length===12;
  const canLeaveVehicle=normalizePlate(form.plate).length>=6||normalizeVin(form.vin).length===17;
  const activeLocation=useMemo(
    ()=>locations.find(location=>location.id===form.locationId)||locations[0]||null,
    [locations,form.locationId],
  );
  const responsibleOptions=useMemo(()=>{
    const names=users.map(item=>item.name);
    if(form.responsible&&!names.includes(form.responsible))names.unshift(form.responsible);
    return names.length?names:["Продавник","РОП","Завідуючий"];
  },[users,form.responsible]);

  function update<K extends keyof RequestForm>(field:K,value:RequestForm[K]){
    setForm(current=>({...current,[field]:value}));
    setError("");
  }
  function updatePhone(value:string){
    update("phone",formatPhone(value));
    if(phoneLookupState!=="idle"){
      setPhoneLookupState("idle");
      setFoundClient(null);
      setSelectedClientId(null);
    }
  }
  function updatePlate(value:string){
    update("plate",normalizePlate(value));
    setPlateLookupState("idle");
    setFoundVehicle(null);
    setVehicleConflict(null);
    setAllowReassign(false);
  }
  function updateVin(value:string){
    update("vin",normalizeVin(value));
    setVinLookupState("idle");
    setVinMessage("");
    setFoundVehicle(null);
  }
  function markManual(field:"make"|"model"|"year",value:string){
    setForm(current=>({
      ...current,
      [field]:value,
      vehicleDataSource:"MANUAL",
      vehicleDataConfidence:"100",
      vehicleDataStatus:"MANUAL",
    }));
    setError("");
  }
  function applyVehicle(candidate:VehicleCandidate){
    setFoundVehicle(candidate);
    setForm(current=>{
      const merged:RequestForm={
        ...current,
        plate:normalizePlate(candidate.plate||current.plate),
        vin:normalizeVin(candidate.vin||current.vin),
        make:candidate.make||current.make,
        model:candidate.model||current.model,
        year:candidate.year?String(candidate.year):current.year,
        mileage:candidate.mileage?String(candidate.mileage):current.mileage,
        engine:candidate.engine||current.engine,
        engineVolume:candidate.engineVolume||inferEngineVolume(candidate.engine)||current.engineVolume,
        fuelType:candidate.fuelType||current.fuelType,
        bodyType:candidate.bodyType||current.bodyType,
        grossWeight:candidate.grossWeight||current.grossWeight,
        driveType:candidate.driveType||current.driveType,
        vehicleType:(candidate.vehicleType as VehicleType)||current.vehicleType,
        turboLevClass:(candidate.turboLevClass as TurboLevClass)||current.turboLevClass,
        priceCoefficient:candidate.priceCoefficient||current.priceCoefficient,
        classificationSource:candidate.classificationSource||current.classificationSource,
        classificationConfidence:candidate.classificationConfidence||current.classificationConfidence,
        classificationReason:candidate.classificationReason||current.classificationReason,
        manualClassOverride:Boolean(candidate.manualClassOverride),
        vehicleDataSource:candidate.vehicleDataSource||current.vehicleDataSource||"CRM",
        vehicleDataConfidence:candidate.vehicleDataConfidence||current.vehicleDataConfidence||"100",
        vehicleDataStatus:candidate.vehicleDataStatus||"AUTO",
      };
      if(!merged.manualClassOverride)Object.assign(merged,classificationPatch(merged));
      return merged;
    });
  }

  async function loadUsers(){
    try{
      const response=await fetch("/api/users/active",{cache:"no-store"});
      const data=await response.json();
      const items=Array.isArray(data.items)?data.items as UserOption[]:[];
      setUsers(items);
      setForm(current=>{
        if(current.responsible)return current;
        const stored=window.localStorage.getItem(MANAGER_KEY)||"";
        const resolved=items.some(item=>item.name===stored)?stored:items[0]?.name||"Продавник";
        return {...current,responsible:resolved};
      });
    }catch{
      setUsers([]);
      setForm(current=>current.responsible?current:{...current,responsible:"Продавник"});
    }
  }
  async function loadMakes(){
    if(makes.length)return;
    setCatalogLoading(true);
    try{
      const response=await fetch("/api/vehicles/catalog",{cache:"force-cache"});
      const data=await response.json();
      setMakes(Array.isArray(data.items)?data.items:[]);
    }catch{
      setMakes([]);
    }finally{
      setCatalogLoading(false);
    }
  }
  async function loadModels(make:string){
    const value=make.trim();
    setModels([]);
    if(!value)return;
    setCatalogLoading(true);
    try{
      const response=await fetch(`/api/vehicles/catalog?make=${encodeURIComponent(value)}`,{cache:"force-cache"});
      const data=await response.json();
      setModels(Array.isArray(data.items)?data.items:[]);
    }catch{
      setModels([]);
    }finally{
      setCatalogLoading(false);
    }
  }
  async function loadPlannerResources(){
    if(plannerLoading)return;
    setPlannerLoading(true);
    try{
      const from=new Date();
      from.setHours(0,0,0,0);
      const to=new Date(from.getTime()+7*24*60*60*1000);
      const response=await fetch(`/api/planner?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`,{cache:"no-store"});
      const data=await response.json();
      if(!response.ok||data.status!=="OK")throw new Error(data.message||"Не вдалося завантажити ресурси");
      const nextLocations=Array.isArray(data.locations)?data.locations as PlannerLocation[]:[];
      setLocations(nextLocations);
      setForm(current=>{
        const location=nextLocations.find(item=>item.id===current.locationId)||nextLocations[0];
        if(!location)return current;
        const postId=current.postId&&location.posts.some(post=>post.id===current.postId)
          ?current.postId
          :location.posts.length===1?location.posts[0].id:"";
        const mechanicId=current.mechanicId&&location.mechanics.some(mechanic=>mechanic.id===current.mechanicId)
          ?current.mechanicId
          :location.mechanics.length===1?location.mechanics[0].id:"";
        return {...current,locationId:location.id,postId,mechanicId};
      });
    }catch(reason){
      setError(reason instanceof Error?reason.message:"Не вдалося завантажити пости та майстрів.");
    }finally{
      setPlannerLoading(false);
    }
  }

  function openWith(detail:OpenRequestDetail={}){
    const stored=typeof window!=="undefined"?window.localStorage.getItem(MANAGER_KEY)||"":"";
    setForm({
      ...initialForm,
      customerName:detail.name?.trim()||"",
      phone:detail.phone?formatPhone(detail.phone):"",
      source:detail.source?.trim()||"Інше",
      responsible:detail.responsible?.trim()||stored,
      plate:detail.plate?normalizePlate(detail.plate):"",
      vin:detail.vin?normalizeVin(detail.vin):"",
      appointmentDate:detail.appointmentDate||"",
      appointmentTime:detail.appointmentTime||"",
    });
    setStep(1);
    setError("");
    setSuccess("");
    setFoundClient(null);
    setSelectedClientId(null);
    setFoundVehicle(null);
    setVehicleConflict(null);
    setAllowReassign(false);
    setPlateLookupState("idle");
    setPhoneLookupState("idle");
    setVinLookupState("idle");
    setVinMessage("");
    setPreliminaryWorks([]);
    setPreliminaryTotal(0);
    setOpen(true);
  }
  function close(){
    setOpen(false);
    setStep(1);
    setError("");
    setSuccess("");
  }

  useEffect(()=>{void loadUsers()},[]);
  useEffect(()=>{
    const handler=(event:Event)=>openWith((event as CustomEvent<OpenRequestDetail>).detail||{});
    window.addEventListener("turbolev:open-new-request",handler as EventListener);
    return()=>window.removeEventListener("turbolev:open-new-request",handler as EventListener);
  },[]);
  useEffect(()=>{if(open)void loadMakes()},[open]);
  useEffect(()=>{if(open&&step===4&&locations.length===0)void loadPlannerResources()},[open,step,locations.length]);
  useEffect(()=>{
    const handler=(event:Event)=>{
      const detail=(event as CustomEvent<{works?:PreliminaryWork[];total?:number}>).detail||{};
      const works=Array.isArray(detail.works)?detail.works:[];
      const total=Number(detail.total)||0;
      setPreliminaryWorks(works);
      setPreliminaryTotal(total);
      setForm(current=>({...current,preliminaryAmount:total>0?String(total):""}));
    };
    window.addEventListener("turbolev:preliminary-works-change",handler as EventListener);
    return()=>window.removeEventListener("turbolev:preliminary-works-change",handler as EventListener);
  },[]);

  async function lookupPhone(){
    const phone=normalizePhone(form.phone);
    setFoundClient(null);
    setSelectedClientId(null);
    if(phone.length!==12){
      setPhoneLookupState("not-found");
      return;
    }
    setPhoneLookupState("searching");
    try{
      const response=await fetch(`/api/client-card?phone=${encodeURIComponent(formatPhone(phone))}`,{cache:"no-store"});
      const data=await response.json();
      if(!response.ok||!data.client){
        setPhoneLookupState("not-found");
        return;
      }
      setFoundClient(data.client as ClientLookup);
      setPhoneLookupState("found");
    }catch{
      setPhoneLookupState("unavailable");
    }
  }
  function useClient(client:ClientLookup){
    setSelectedClientId(client.id);
    setForm(current=>({
      ...current,
      customerName:client.name?.trim()||current.customerName||"Невідомий клієнт",
      phone:formatPhone(client.phone),
    }));
    setError("");
  }
  function useClientVehicle(vehicle:ClientVehicle){
    applyVehicle(candidateFromClientVehicle(vehicle));
    setPlateLookupState(vehicle.plateNumber?"found":"idle");
    setVinLookupState(vehicle.vin?"found":"idle");
  }

  async function lookupPlate(){
    const plate=normalizePlate(form.plate);
    if(plate.length<6){
      setPlateLookupState("not-found");
      return;
    }
    setPlateLookupState("searching");
    setFoundVehicle(null);
    setVehicleConflict(null);
    setAllowReassign(false);
    try{
      const response=await fetch(`/api/vehicles/lookup?plate=${encodeURIComponent(plate)}`,{cache:"no-store"});
      const data=await response.json();
      if(!response.ok||data.status!=="FOUND"||!data.vehicle){
        setPlateLookupState("not-found");
        return;
      }
      const v=data.vehicle;
      const candidate:VehicleCandidate={
        id:v.id,
        clientId:v.clientId,
        clientName:v.clientName,
        clientPhone:v.clientPhone,
        plate,
        vin:v.vin||"",
        make:v.make||"",
        model:v.model||"",
        year:v.year?String(v.year):"",
        mileage:v.mileageKm?String(v.mileageKm):"",
        engine:v.engine||"",
        engineVolume:v.engineVolumeL?String(v.engineVolumeL):"",
        fuelType:v.fuelType||"",
        bodyType:v.bodyType||"",
        grossWeight:v.grossWeightKg?String(v.grossWeightKg):"",
        driveType:v.driveType||"",
        vehicleType:v.vehicleType||"UNKNOWN",
        turboLevClass:v.turboLevClass||"UNKNOWN",
        priceCoefficient:Number(v.priceCoefficient||1).toFixed(2),
        classificationSource:v.classificationSource||"CRM",
        classificationConfidence:String(v.classificationConfidence??100),
        classificationReason:v.classificationReason||"Дані автомобіля знайдено",
        manualClassOverride:Boolean(v.manualClassOverride),
        vehicleDataSource:v.vehicleDataSource||data.lookupLevel||"CRM",
        vehicleDataConfidence:String(v.vehicleDataConfidence??100),
        vehicleDataStatus:"AUTO",
      };
      applyVehicle(candidate);
      setPlateLookupState("found");
      const currentPhone=normalizePhone(form.phone);
      const ownerPhone=normalizePhone(String(v.clientPhone||""));
      if(v.clientId&&(
        (selectedClientId&&v.clientId!==selectedClientId)||
        (!selectedClientId&&currentPhone&&ownerPhone&&currentPhone!==ownerPhone)
      ))setVehicleConflict(candidate);
    }catch{
      setPlateLookupState("unavailable");
    }
  }

  async function lookupVin(){
    const vin=normalizeVin(form.vin);
    setVinMessage("");
    if(vin.length!==17){
      setVinLookupState("not-found");
      return;
    }
    setVinLookupState("searching");
    setFoundVehicle(null);
    try{
      const response=await fetch(`/api/vehicles/vin?vin=${encodeURIComponent(vin)}`,{cache:"no-store"});
      const data=await response.json() as VinApiResponse;
      if(!response.ok||data.status!=="FOUND"||!data.vehicle){
        setVinLookupState("not-found");
        setVinMessage(data.message||"VIN не знайдено. Авто можна записати та уточнити дані пізніше.");
        return;
      }
      const v=data.vehicle;
      applyVehicle({
        vin,
        make:v.make||"",
        model:v.model||"",
        year:v.year?String(v.year):"",
        engine:[v.engine,v.trim,v.series].filter(Boolean).join(" · "),
        engineVolume:v.engineVolumeL?String(v.engineVolumeL):"",
        fuelType:[v.fuelType,v.secondaryFuelType].filter(Boolean).join(" / "),
        bodyType:v.bodyType||"",
        driveType:v.driveType||"",
        vehicleDataSource:data.sourceDetail||data.source||"NHTSA_VPIC_API",
        vehicleDataConfidence:String(data.confidence??80),
        vehicleDataStatus:"AUTO",
      });
      setVinLookupState("found");
      setVinMessage(data.warning||"VIN успішно розшифровано.");
      if(v.make)void loadModels(v.make);
    }catch{
      setVinLookupState("unavailable");
      setVinMessage("VIN-декодер тимчасово недоступний. Авто можна записати та уточнити пізніше.");
    }
  }

  function goNext(){
    if(step===1){
      if(!canLeaveClient)return setError("Вкажіть коректний номер телефону.");
      if(!form.customerName.trim())setForm(current=>({...current,customerName:"Невідомий клієнт"}));
      setStep(2);
      setError("");
      return;
    }
    if(step===2){
      if(!canLeaveVehicle)return setError("Вкажіть державний номер або повний VIN автомобіля.");
      if(form.vin&&normalizeVin(form.vin).length!==17)return setError("VIN має містити 17 символів.");
      if(vehicleConflict&&!allowReassign)return setError("Автомобіль прив’язаний до іншого клієнта. Підтвердьте ручне переприв’язування або використайте поточного власника.");
      setStep(3);
      setError("");
      return;
    }
    if(step===3){
      if(!form.complaint.trim()&&preliminaryWorks.length===0)return setError("Коротко опишіть проблему або додайте хоча б одну попередню роботу.");
      setStep(4);
      setError("");
    }
  }

  async function saveRequest(event:FormEvent){
    event.preventDefault();
    if(!form.appointmentDate||!form.appointmentTime)return setError("Вкажіть дату та час заїзду.");
    if(!form.postId)return setError("Оберіть пост СТО.");
    if(!form.mechanicId)return setError("Закріпіть майстра.");
    if(!canLeaveClient)return setError("Вкажіть коректний номер телефону.");
    if(vehicleConflict&&!allowReassign)return setError("Потрібно підтвердити переприв’язування автомобіля.");
    setSaving(true);
    setError("");
    try{
      const payload={
        ...form,
        customerName:form.customerName.trim()||"Невідомий клієнт",
        phone:formatPhone(form.phone),
        plate:normalizePlate(form.plate),
        vin:normalizeVin(form.vin),
        preliminaryAmount:preliminaryTotal>0?String(preliminaryTotal):form.preliminaryAmount,
        preliminaryWorks,
        forceReassignVehicle:allowReassign,
      };
      const response=await fetch("/api/intake",{
        method:"POST",
        headers:{"content-type":"application/json"},
        body:JSON.stringify(payload),
      });
      const data=await response.json();
      if(!response.ok)throw new Error(data.error||"Не вдалося створити запис");
      const request={
        ...payload,
        id:`REQ-${Date.now()}`,
        createdAt:new Date().toISOString(),
        status:"BOOKED",
        serverSaved:true,
        serverResult:{
          clientId:data.client?.id,
          vehicleId:data.vehicle?.id,
          leadId:data.lead?.id,
          appointmentId:data.appointment?.id,
        },
      };
      try{
        const list=JSON.parse(window.localStorage.getItem(STORAGE_KEY)||"[]");
        window.localStorage.setItem(STORAGE_KEY,JSON.stringify([request,...(Array.isArray(list)?list:[])]));
      }catch{}
      window.dispatchEvent(new CustomEvent("turbolev:new-request",{detail:request}));
      window.dispatchEvent(new CustomEvent("turbolev:data-changed",{detail:{entity:"intake",...data}}));
      setSuccess("Клієнта записано на діагностику. Запис уже в Планувальнику.");
      window.setTimeout(()=>close(),1100);
    }catch(reason){
      setError(reason instanceof Error?reason.message:"Помилка створення запису");
    }finally{
      setSaving(false);
    }
  }

  const phoneButton=phoneLookupState==="searching"?"Шукаю…":phoneLookupState==="found"?"✓ Знайдено":phoneLookupState==="not-found"?"Не знайдено":phoneLookupState==="unavailable"?"Недоступно":"Знайти";
  const plateButton=plateLookupState==="searching"?"Шукаю…":plateLookupState==="found"?"✓ Успішно":plateLookupState==="not-found"?"Не знайдено":plateLookupState==="unavailable"?"Недоступно":"Знайти";
  const vinButton=vinLookupState==="searching"?"Шукаю…":vinLookupState==="found"?"✓ Успішно":vinLookupState==="not-found"?"Не знайдено":vinLookupState==="unavailable"?"Недоступно":"Знайти";

  return <>
    {showButton&&<button className="primary" type="button" onClick={()=>openWith()}>+ Нова заявка</button>}
    {open&&<div className="requestModalBackdrop" role="presentation" onMouseDown={event=>event.target===event.currentTarget&&close()}>
      <form className="requestModal requestModalV4 requestFastIntake" onSubmit={saveRequest}>
        <div className="requestModalHead">
          <div>
            <p className="eyebrow">TURBO LEV · НОВА ЗАЯВКА</p>
            <h2>Запис на діагностику</h2>
            <span>4 короткі кроки: клієнт → авто → потреба → час заїзду</span>
          </div>
          <button className="requestClose" type="button" onClick={close} aria-label="Закрити">×</button>
        </div>

        <div className="requestStepper requestStepperV4">
          {["Клієнт","Автомобіль","Проблема","Запис"].map((label,index)=>{
            const n=index+1;
            const done=n<step;
            return <button
              type="button"
              key={label}
              className={n===step?"active":done?"done":"locked"}
              onClick={()=>done&&setStep(n)}
              aria-disabled={!done&&n!==step}
            >
              <b>{done?"✓":n}</b><span>{label}</span>
            </button>;
          })}
        </div>

        <div className="requestScroll">
          <div className="requestBody">
            {step===1&&<section className="requestStep requestFastStep">
              <div className="requestStepTitle">
                <div><small>КРОК 1</small><h3>Хто клієнт?</h3></div>
                <span className="requestHint">Телефон обов’язковий · ім’я можна уточнити пізніше</span>
              </div>

              <div className="fastLookupCard">
                <div className="fastLookupCopy">
                  <b>Знайти клієнта за телефоном</b>
                  <span>Перевіримо основний і додаткові номери</span>
                </div>
                <div className="fastLookupControls">
                  <input value={form.phone} onChange={event=>updatePhone(event.target.value)} placeholder="+380 67 123 45 67" inputMode="tel"/>
                  <button type="button" className={`lookupState-${phoneLookupState}`} onClick={()=>void lookupPhone()} disabled={phoneLookupState==="searching"}>{phoneButton}</button>
                </div>
                {phoneLookupState==="found"&&foundClient&&<div className="clientLookupCompact fastClientResult">
                  <div>
                    <b>{foundClient.name||"Невідомий клієнт"}</b>
                    <span>{formatPhone(foundClient.phone)} · {foundClient.vehicles?.length||0} авто</span>
                  </div>
                  <button type="button" onClick={()=>useClient(foundClient)}>Використати</button>
                </div>}
              </div>

              <div className="requestGrid two fastClientGrid">
                <label>
                  <span>Ім’я клієнта</span>
                  <input value={form.customerName} onChange={event=>update("customerName",event.target.value)} placeholder="Невідомий клієнт"/>
                </label>
                <label>
                  <span>Телефон *</span>
                  <input value={form.phone} onChange={event=>updatePhone(event.target.value)} inputMode="tel"/>
                </label>
                <label>
                  <span>Джерело</span>
                  <select value={form.source} onChange={event=>update("source",event.target.value)}>
                    {sources.map(item=><option key={item}>{item}</option>)}
                  </select>
                </label>
                <label>
                  <span>Відповідальний</span>
                  <select value={form.responsible} onChange={event=>{
                    update("responsible",event.target.value);
                    window.localStorage.setItem(MANAGER_KEY,event.target.value);
                  }}>
                    {responsibleOptions.map(item=><option key={item}>{item}</option>)}
                  </select>
                </label>
              </div>
            </section>}

            {step===2&&<section className="requestStep requestFastStep vehicleIdentityStep">
              <div className="requestStepTitle">
                <div><small>КРОК 2</small><h3>Який автомобіль?</h3></div>
                <span className="requestHint">Достатньо держномера або VIN</span>
              </div>

              {foundClient&&selectedClientId===foundClient.id&&foundClient.vehicles?.length>0&&<div className="knownVehicles">
                <div><b>Автомобілі клієнта</b><span>Можна обрати без повторного пошуку</span></div>
                <div>{foundClient.vehicles.map(vehicle=><button type="button" key={vehicle.id} onClick={()=>useClientVehicle(vehicle)}>
                  <strong>{vehicle.plateNumber||"Без номера"}</strong>
                  <span>{[vehicle.brand,vehicle.model,vehicle.year].filter(Boolean).join(" ")}</span>
                </button>)}</div>
              </div>}

              <div className="vehicleLookupPair">
                <div className="fastLookupCard">
                  <div className="fastLookupCopy"><b>За держномером</b><span>CRM → реєстр МВС</span></div>
                  <div className="fastLookupControls">
                    <input className="uaPlateText" value={form.plate} onChange={event=>updatePlate(event.target.value)} placeholder="AA1234BB"/>
                    <button type="button" className={`lookupState-${plateLookupState}`} onClick={()=>void lookupPlate()} disabled={plateLookupState==="searching"}>{plateButton}</button>
                  </div>
                </div>
                <div className="fastLookupCard">
                  <div className="fastLookupCopy"><b>За VIN-кодом</b><span>17 символів</span></div>
                  <div className="fastLookupControls">
                    <input className="fastVinInput" value={form.vin} onChange={event=>updateVin(event.target.value)} placeholder="WVWZZZ..."/>
                    <button type="button" className={`lookupState-${vinLookupState}`} onClick={()=>void lookupVin()} disabled={vinLookupState==="searching"}>{vinButton}</button>
                  </div>
                </div>
              </div>

              {vehicleConflict&&<div className={`vehicleOwnerConflict ${allowReassign?"confirmed":""}`}>
                <div>
                  <b>Автомобіль уже прив’язаний до іншого клієнта</b>
                  <span>{vehicleConflict.clientName||"Інший клієнт"}{vehicleConflict.clientPhone?` · ${formatPhone(vehicleConflict.clientPhone)}`:""}</span>
                </div>
                <div>
                  <button type="button" onClick={()=>{
                    setForm(current=>({
                      ...current,
                      customerName:vehicleConflict.clientName||"Невідомий клієнт",
                      phone:vehicleConflict.clientPhone?formatPhone(vehicleConflict.clientPhone):current.phone,
                    }));
                    setSelectedClientId(vehicleConflict.clientId||null);
                    setVehicleConflict(null);
                    setAllowReassign(false);
                  }}>Використати поточного власника</button>
                  <button type="button" className="danger" onClick={()=>setAllowReassign(true)}>
                    {allowReassign?"✓ Переприв’язування підтверджено":"Переприв’язати вручну"}
                  </button>
                </div>
              </div>}

              {(foundVehicle||plateLookupState==="found"||vinLookupState==="found")&&<div className="vehicleFoundCompact">
                <div className="vehicleFoundIcon">✓</div>
                <div>
                  <small>АВТОМОБІЛЬ ЗНАЙДЕНО</small>
                  <strong>{vehicleTitle(form)}</strong>
                  <span>{[form.plate,form.vin].filter(Boolean).join(" · ")}</span>
                </div>
                <div>
                  <small>ПРОБІГ</small>
                  <input value={form.mileage} onChange={event=>update("mileage",event.target.value.replace(/\D/g,""))} placeholder="км"/>
                </div>
              </div>}

              {vinMessage&&vinLookupState!=="found"&&<div className={`vinLookupResult vin-${vinLookupState}`}>
                <div><b>VIN</b><span>{vinMessage}</span></div>
              </div>}

              <details className="vehicleAdvanced">
                <summary>Уточнити дані автомобіля вручну</summary>
                <div className="vehicleAdvancedBody">
                  <div className="requestGrid four vehicleCatalogGrid">
                    <label>
                      <span>Марка</span>
                      <input list="turboLevMakesV4" value={form.make} onFocus={()=>void loadMakes()} onChange={event=>{
                        markManual("make",event.target.value);
                        update("model","");
                        void loadModels(event.target.value);
                      }} placeholder="Volvo"/>
                      <datalist id="turboLevMakesV4">{makes.map(item=><option key={`${item.id}-${item.name}`} value={item.name}/>)}</datalist>
                    </label>
                    <label>
                      <span>Модель</span>
                      <input list="turboLevModelsV4" value={form.model} onFocus={()=>form.make&&void loadModels(form.make)} onChange={event=>markManual("model",event.target.value)} placeholder="XC90"/>
                      <datalist id="turboLevModelsV4">{models.map(item=><option key={`${item.id}-${item.name}`} value={item.name}/>)}</datalist>
                    </label>
                    <label>
                      <span>Рік</span>
                      <select value={form.year} onChange={event=>markManual("year",event.target.value)}>
                        <option value="">—</option>{years.map(year=><option key={year}>{year}</option>)}
                      </select>
                    </label>
                    <label>
                      <span>Пробіг, км</span>
                      <input value={form.mileage} onChange={event=>update("mileage",event.target.value.replace(/\D/g,""))}/>
                    </label>
                    <label>
                      <span>Двигун / модифікація</span>
                      <input value={form.engine} onChange={event=>update("engine",event.target.value)}/>
                    </label>
                    <label>
                      <span>Об’єм двигуна, л</span>
                      <input value={form.engineVolume} onChange={event=>update("engineVolume",event.target.value.replace(/[^0-9.,]/g,""))}/>
                    </label>
                    <label>
                      <span>Паливо</span>
                      <input value={form.fuelType} onChange={event=>update("fuelType",event.target.value)}/>
                    </label>
                    <label>
                      <span>Тип кузова</span>
                      <input value={form.bodyType} onChange={event=>update("bodyType",event.target.value)}/>
                    </label>
                    <label>
                      <span>Повна маса, кг</span>
                      <input value={form.grossWeight} onChange={event=>update("grossWeight",event.target.value.replace(/\D/g,""))}/>
                    </label>
                    <label>
                      <span>Привід</span>
                      <input value={form.driveType} onChange={event=>update("driveType",event.target.value)}/>
                    </label>
                  </div>
                  <div className="advancedMeta">{catalogLoading?"Оновлюю довідник…":`Джерело даних: ${form.vehicleDataSource||"ручне введення"} · довіра ${form.vehicleDataConfidence||0}%`}</div>
                </div>
              </details>
            </section>}

            {step===3&&<section className="requestStep requestFastStep">
              <div className="requestStepTitle">
                <div><small>КРОК 3</small><h3>Що потрібно перевірити?</h3></div>
                <span className="requestHint">Коротко — решту уточнить діагностика</span>
              </div>
              <label className="requestFullField fastComplaint">
                <span>Що турбує клієнта?</span>
                <textarea value={form.complaint} onChange={event=>update("complaint",event.target.value)} placeholder="Напр.: щось стукає спереду, перевірити ходову…"/>
              </label>
              <div className="requestTags fastCategoryTags">
                {categories.map(item=><button type="button" key={item} className={form.category===item?"selected":""} onClick={()=>update("category",form.category===item?"":item)}>{item}</button>)}
              </div>
            </section>}

            {step===4&&<section className="requestStep requestFastStep">
              <div className="requestStepTitle">
                <div><small>КРОК 4</small><h3>Коли чекаємо клієнта?</h3></div>
                <span className="requestStatus booked">Запис на діагностику</span>
              </div>

              {locations.length>1&&<label className="fastLocationSelect">
                <span>Локація</span>
                <select value={form.locationId} onChange={event=>{
                  const location=locations.find(item=>item.id===event.target.value);
                  setForm(current=>({...current,locationId:event.target.value,postId:location?.posts.length===1?location.posts[0].id:"",mechanicId:location?.mechanics.length===1?location.mechanics[0].id:""}));
                }}>
                  {locations.map(location=><option value={location.id} key={location.id}>{location.name}</option>)}
                </select>
              </label>}

              <div className="bookingGrid">
                <label>
                  <span>Дата *</span>
                  <input type="date" value={form.appointmentDate} onChange={event=>update("appointmentDate",event.target.value)}/>
                </label>
                <label>
                  <span>Час *</span>
                  <input type="time" value={form.appointmentTime} onChange={event=>update("appointmentTime",event.target.value)}/>
                </label>
                <label>
                  <span>Пост *</span>
                  <select value={form.postId} onChange={event=>update("postId",event.target.value)} disabled={plannerLoading||!activeLocation}>
                    <option value="">{plannerLoading?"Завантажую…":"Оберіть пост"}</option>
                    {activeLocation?.posts.map(post=><option key={post.id} value={post.id}>{post.name}</option>)}
                  </select>
                </label>
                <label>
                  <span>Майстер *</span>
                  <select value={form.mechanicId} onChange={event=>update("mechanicId",event.target.value)} disabled={plannerLoading||!activeLocation}>
                    <option value="">{plannerLoading?"Завантажую…":"Оберіть майстра"}</option>
                    {activeLocation?.mechanics.map(mechanic=><option key={mechanic.id} value={mechanic.id}>{mechanic.name}</option>)}
                  </select>
                </label>
              </div>

              <label className="requestHiddenPricingField" aria-hidden="true">
                <span>Попередня сума, грн</span>
                <input tabIndex={-1} value={form.preliminaryAmount} onChange={event=>update("preliminaryAmount",event.target.value)}/>
              </label>

              <div className="fastBookingSummary">
                <article><small>Клієнт</small><strong>{form.customerName||"Невідомий клієнт"}</strong><span>{form.phone}</span></article>
                <article><small>Авто</small><strong>{vehicleTitle(form)}</strong><span>{form.plate||form.vin}</span></article>
                <article><small>Діагностика</small><strong>{form.category||"Первинний огляд"}</strong><span>{form.complaint||`${preliminaryWorks.length} попередніх робіт`}</span></article>
                <article><small>Роботи</small><strong>{preliminaryWorks.length||0} позицій</strong><span>{preliminaryTotal>0?`${Math.round(preliminaryTotal).toLocaleString("uk-UA")} грн попередньо`:"Без попереднього кошторису"}</span></article>
              </div>
            </section>}

            {error&&<div className="requestMessage error">{error}</div>}
            {success&&<div className="requestMessage success">{success}</div>}
          </div>
        </div>

        <div className="requestActions">
          <button type="button" className="ghost" onClick={close}>Скасувати</button>
          <div>
            {step>1&&<button type="button" className="ghost" onClick={()=>{setStep(current=>Math.max(1,current-1));setError("")}}>← Назад</button>}
            {step<4
              ?<button type="button" className="primary" onClick={goNext}>{step===1&&!canLeaveClient?"Заповніть телефон":"Далі →"}</button>
              :<button type="submit" className="primary fastBookButton" disabled={saving}>{saving?"Записую…":"Записати на діагностику"}</button>}
          </div>
        </div>
      </form>
    </div>}
  </>;
}
