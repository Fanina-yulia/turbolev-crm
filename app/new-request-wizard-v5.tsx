"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  classificationPatch,
  formatPhone,
  inferEngineVolume,
  initialRequestForm,
  MANAGER_KEY,
  normalizePhone,
  normalizePlate,
  normalizeVin,
  parseClientLookup,
  parseMakeOptions,
  parseModelOptions,
  parsePlannerLocations,
  parsePlateLookupCandidate,
  parseUserOptions,
  parseVinResponse,
  payloadMessage,
  readPayloadField,
  requestCategories,
  requestSources,
  requestYears,
  resolveTurboLevClass,
  resolveVehicleType,
  STORAGE_KEY,
  vehicleTitle,
} from "./new-request-wizard-v5.model";
import type {
  ClientLookup,
  LookupState,
  MakeOption,
  ModelOption,
  NewRequestWizardProps,
  OpenRequestDetail,
  PlannerLocation,
  PreliminaryWork,
  RequestForm,
  UserOption,
  VehicleCandidate,
} from "./new-request-wizard-v5.types";

export function NewRequestWizardV5({showButton=true}:NewRequestWizardProps){
  const [open,setOpen]=useState(false);
  const [step,setStep]=useState(1);
  const [form,setForm]=useState<RequestForm>(initialRequestForm);
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
  const plateLookupControllerRef=useRef<AbortController|null>(null);
  const plateLookupRequestRef=useRef(0);

  const canLeaveClient=normalizePhone(form.phone).length===12&&form.customerName.trim().length>0;
  const hasVehicleIdentifier=normalizePlate(form.plate).length>=6||normalizeVin(form.vin).length===17;
  const hasVehicleIdentity=form.make.trim().length>0&&form.model.trim().length>0;
  const canLeaveVehicle=hasVehicleIdentifier&&hasVehicleIdentity;
  const vehicleNeedsManualIdentity=hasVehicleIdentifier
    &&plateLookupState!=="searching"
    &&vinLookupState!=="searching"
    &&!hasVehicleIdentity;
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
    }
    setSelectedClientId(null);
    setVehicleConflict(null);
    setAllowReassign(false);
  }
  function updatePlate(value:string){
    plateLookupControllerRef.current?.abort();
    plateLookupControllerRef.current=null;
    plateLookupRequestRef.current+=1;
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
        vehicleType:resolveVehicleType(candidate.vehicleType,current.vehicleType),
        turboLevClass:resolveTurboLevClass(candidate.turboLevClass,current.turboLevClass),
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
  function applyVehicleOwner(candidate:VehicleCandidate){
    if(!candidate.clientId&&!candidate.clientName&&!candidate.clientPhone)return;
    setSelectedClientId(candidate.clientId||null);
    setForm(current=>({
      ...current,
      customerName:candidate.clientName?.trim()||current.customerName,
      phone:candidate.clientPhone?formatPhone(candidate.clientPhone):current.phone,
    }));
  }
  function ownerConflictForCurrentClient(){
    if(!foundVehicle?.clientId)return null;
    const ownerPhone=normalizePhone(foundVehicle.clientPhone||"");
    const currentPhone=normalizePhone(form.phone);
    if(selectedClientId&&selectedClientId!==foundVehicle.clientId)return foundVehicle;
    if(!selectedClientId&&ownerPhone&&currentPhone&&ownerPhone!==currentPhone)return foundVehicle;
    return null;
  }

  async function loadUsers(){
    try{
      const response=await fetch("/api/users/active",{cache:"no-store"});
      const payload:unknown=await response.json();
      if(!response.ok)throw new Error(payloadMessage(payload,"Не вдалося завантажити користувачів"));
      const items=parseUserOptions(readPayloadField(payload,"items"));
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
      const payload:unknown=await response.json();
      if(!response.ok)throw new Error(payloadMessage(payload,"Не вдалося завантажити марки"));
      setMakes(parseMakeOptions(readPayloadField(payload,"items")));
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
      const payload:unknown=await response.json();
      if(!response.ok)throw new Error(payloadMessage(payload,"Не вдалося завантажити моделі"));
      setModels(parseModelOptions(readPayloadField(payload,"items")));
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
      const payload:unknown=await response.json();
      if(!response.ok||readPayloadField(payload,"status")!=="OK")throw new Error(payloadMessage(payload,"Не вдалося завантажити ресурси"));
      const nextLocations=parsePlannerLocations(readPayloadField(payload,"locations"));
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
    plateLookupControllerRef.current?.abort();
    plateLookupControllerRef.current=null;
    plateLookupRequestRef.current+=1;
    const stored=typeof window!=="undefined"?window.localStorage.getItem(MANAGER_KEY)||"":"";
    setForm({
      ...initialRequestForm,
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
    plateLookupControllerRef.current?.abort();
    plateLookupControllerRef.current=null;
    plateLookupRequestRef.current+=1;
    setOpen(false);
    setStep(1);
    setError("");
    setSuccess("");
  }

  useEffect(()=>{void loadUsers()},[]);
  useEffect(()=>()=>plateLookupControllerRef.current?.abort(),[]);
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
  useEffect(()=>{
    if(!open||step!==1||plateLookupState!=="idle")return;
    const plate=normalizePlate(form.plate);
    if(plate.length<6)return;
    const timer=window.setTimeout(()=>{void lookupPlate(plate)},450);
    return()=>window.clearTimeout(timer);
  },[open,step,form.plate,plateLookupState]);

  async function lookupPhone(){
    const phone=normalizePhone(form.phone);
    setFoundClient(null);
    if(phone.length!==12){
      setPhoneLookupState("not-found");
      return;
    }
    setPhoneLookupState("searching");
    try{
      const response=await fetch(`/api/client-card?phone=${encodeURIComponent(formatPhone(phone))}`,{cache:"no-store"});
      const payload:unknown=await response.json();
      const client=parseClientLookup(readPayloadField(payload,"client"));
      if(!response.ok||!client){
        setPhoneLookupState("not-found");
        return;
      }
      setFoundClient(client);
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
    if(foundVehicle?.clientId&&foundVehicle.clientId!==client.id)setVehicleConflict(foundVehicle);
    else setVehicleConflict(null);
    setAllowReassign(false);
    setError("");
  }

  async function lookupPlate(requestedPlate=form.plate){
    const plate=normalizePlate(requestedPlate);
    if(plate.length<6){
      setPlateLookupState("not-found");
      return;
    }
    plateLookupControllerRef.current?.abort();
    const controller=new AbortController();
    const requestId=plateLookupRequestRef.current+1;
    plateLookupControllerRef.current=controller;
    plateLookupRequestRef.current=requestId;
    setPlateLookupState("searching");
    setFoundVehicle(null);
    setVehicleConflict(null);
    setAllowReassign(false);
    try{
      const response=await fetch(`/api/vehicles/lookup?plate=${encodeURIComponent(plate)}`,{
        cache:"no-store",
        signal:controller.signal,
      });
      const payload:unknown=await response.json();
      if(controller.signal.aborted||requestId!==plateLookupRequestRef.current)return;
      const candidate=parsePlateLookupCandidate(payload,plate);
      if(!response.ok||readPayloadField(payload,"status")!=="FOUND"||!candidate){
        setPlateLookupState("not-found");
        return;
      }
      applyVehicle(candidate);
      applyVehicleOwner(candidate);
      setPlateLookupState("found");
    }catch(reason){
      if(controller.signal.aborted||(reason instanceof DOMException&&reason.name==="AbortError"))return;
      if(requestId!==plateLookupRequestRef.current)return;
      setPlateLookupState("unavailable");
    }finally{
      if(plateLookupControllerRef.current===controller)plateLookupControllerRef.current=null;
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
      const payload:unknown=await response.json();
      const data=parseVinResponse(payload);
      if(!response.ok||!data||data.status!=="FOUND"||!data.vehicle){
        setVinLookupState("not-found");
        setVinMessage(data?.message||"VIN не знайдено. Авто можна записати та уточнити дані пізніше.");
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

  function useVehicleOwner(){
    if(!foundVehicle)return;
    applyVehicleOwner(foundVehicle);
    setVehicleConflict(null);
    setAllowReassign(false);
    setPhoneLookupState("idle");
    setFoundClient(null);
  }

  function goNext(){
    if(step===1){
      if(!hasVehicleIdentifier)return setError("Скажіть державний номер авто або вкажіть повний VIN.");
      if(form.vin&&normalizeVin(form.vin).length!==17)return setError("VIN має містити 17 символів.");
      if(plateLookupState==="searching"||vinLookupState==="searching")return setError("Зачекайте, CRM ще визначає автомобіль.");
      if(!hasVehicleIdentity)return setError("CRM не визначила марку та модель автоматично. Вкажіть їх у блоці «Уточнити дані автомобіля вручну».");
      setStep(2);
      setError("");
      return;
    }
    if(step===2){
      if(!form.customerName.trim())return setError("Вкажіть ім’я та прізвище клієнта.");
      if(normalizePhone(form.phone).length!==12)return setError("Вкажіть коректний номер телефону.");
      const conflict=ownerConflictForCurrentClient();
      if(conflict&&!allowReassign){
        setVehicleConflict(conflict);
        return setError("Автомобіль уже прив’язаний до іншого клієнта. Використайте поточного власника або підтвердьте переприв’язування.");
      }
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
    if(!canLeaveVehicle)return setError("Поверніться до кроку «Автомобіль» і вкажіть марку та модель.");
    if(!form.appointmentDate||!form.appointmentTime)return setError("Вкажіть дату та час заїзду.");
    if(!form.postId)return setError("Оберіть пост СТО.");
    if(!form.mechanicId)return setError("Закріпіть майстра.");
    if(!canLeaveClient)return setError("Вкажіть ім’я, прізвище та коректний номер телефону.");
    if(vehicleConflict&&!allowReassign)return setError("Потрібно підтвердити переприв’язування автомобіля.");
    setSaving(true);
    setError("");
    try{
      const payload={
        ...form,
        customerName:form.customerName.trim(),
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
      const serverPayload:unknown=await response.json();
      if(!response.ok)throw new Error(payloadMessage(serverPayload,"Не вдалося створити запис"));
      const clientId=readPayloadField(readPayloadField(serverPayload,"client"),"id");
      const vehicleId=readPayloadField(readPayloadField(serverPayload,"vehicle"),"id");
      const leadId=readPayloadField(readPayloadField(serverPayload,"lead"),"id");
      const appointmentId=readPayloadField(readPayloadField(serverPayload,"appointment"),"id");
      const request={
        ...payload,
        id:`REQ-${Date.now()}`,
        createdAt:new Date().toISOString(),
        status:"BOOKED",
        serverSaved:true,
        serverResult:{
          clientId:typeof clientId==="string"?clientId:undefined,
          vehicleId:typeof vehicleId==="string"?vehicleId:undefined,
          leadId:typeof leadId==="string"?leadId:undefined,
          appointmentId:typeof appointmentId==="string"?appointmentId:undefined,
        },
      };
      try{
        const parsed:unknown=JSON.parse(window.localStorage.getItem(STORAGE_KEY)||"[]");
        window.localStorage.setItem(STORAGE_KEY,JSON.stringify([request,...(Array.isArray(parsed)?parsed:[])]));
      }catch{}
      const safePayload=(typeof serverPayload==="object"&&serverPayload!==null&&!Array.isArray(serverPayload))
        ?serverPayload as Record<string,unknown>
        :{};
      window.dispatchEvent(new CustomEvent("turbolev:new-request",{detail:request}));
      window.dispatchEvent(new CustomEvent("turbolev:data-changed",{detail:{entity:"intake",...safePayload}}));
      setSuccess("Клієнта записано на діагностику. Запис уже в Планувальнику.");
      window.setTimeout(()=>close(),1100);
    }catch(reason){
      setError(reason instanceof Error?reason.message:"Помилка створення запису");
    }finally{
      setSaving(false);
    }
  }

  const phoneButton=phoneLookupState==="searching"?"Шукаю…":phoneLookupState==="found"?"✓ Знайдено":phoneLookupState==="not-found"?"Не знайдено":phoneLookupState==="unavailable"?"Недоступно":"Знайти";
  const plateButton=plateLookupState==="searching"?"Шукаю…":plateLookupState==="found"?"✓ Знайдено":plateLookupState==="not-found"?"Не знайдено":plateLookupState==="unavailable"?"Недоступно":"Знайти";
  const vinButton=vinLookupState==="searching"?"Шукаю…":vinLookupState==="found"?"✓ Знайдено":vinLookupState==="not-found"?"Не знайдено":vinLookupState==="unavailable"?"Недоступно":"Знайти";

  return <>
    {showButton&&<button className="primary" type="button" onClick={()=>openWith()}>+ Нова заявка</button>}
    {open&&<div className="requestModalBackdrop" role="presentation" onMouseDown={event=>event.target===event.currentTarget&&close()}>
      <form className="requestModal requestModalV4 requestFastIntake" onSubmit={saveRequest}>
        <div className="requestModalHead">
          <div>
            <p className="eyebrow">TURBO LEV · НОВА ЗАЯВКА</p>
            <h2>Запис на діагностику</h2>
            <span>4 короткі кроки: авто → клієнт → потреба → час заїзду</span>
          </div>
          <button className="requestClose" type="button" onClick={close} aria-label="Закрити">×</button>
        </div>

        <div className="requestStepper requestStepperV4">
          {["Автомобіль","Клієнт","Проблема","Запис"].map((label,index)=>{
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
            {step===1&&<section className="requestStep requestFastStep vehicleIdentityStep">
              <div className="requestStepTitle">
                <div><small>КРОК 1</small><h3>Скажіть номер Вашого авто</h3></div>
                <span className="requestHint">Введіть держномер — CRM одразу підтягне авто та власника, якщо він уже є</span>
              </div>

              <div className="vehicleLookupPair">
                <div className="fastLookupCard">
                  <div className="fastLookupCopy"><b>Державний номер</b><span>Пошук запускається автоматично</span></div>
                  <div className="fastLookupControls">
                    <input className="uaPlateText" autoFocus value={form.plate} onChange={event=>updatePlate(event.target.value)} placeholder="AA1234BB"/>
                    <button type="button" className={`lookupState-${plateLookupState}`} onClick={()=>void lookupPlate()} disabled={plateLookupState==="searching"}>{plateButton}</button>
                  </div>
                </div>
                <div className="fastLookupCard">
                  <div className="fastLookupCopy"><b>Або VIN-код</b><span>17 символів</span></div>
                  <div className="fastLookupControls">
                    <input className="fastVinInput" value={form.vin} onChange={event=>updateVin(event.target.value)} placeholder="WVWZZZ..."/>
                    <button type="button" className={`lookupState-${vinLookupState}`} onClick={()=>void lookupVin()} disabled={vinLookupState==="searching"}>{vinButton}</button>
                  </div>
                </div>
              </div>

              {(foundVehicle||plateLookupState==="found"||vinLookupState==="found")&&<div className="vehicleFoundCompact">
                <div className="vehicleFoundIcon">✓</div>
                <div>
                  <small>АВТОМОБІЛЬ ЗНАЙДЕНО</small>
                  <strong>{vehicleTitle(form)}</strong>
                  <span>Держномер: {form.plate||"—"} · VIN: {form.vin||"не знайдено"}</span>
                </div>
                <div>
                  <small>ПРОБІГ</small>
                  <input value={form.mileage} onChange={event=>update("mileage",event.target.value.replace(/\D/g,""))} placeholder="км"/>
                </div>
              </div>}

              {foundVehicle?.clientId&&<div className="clientLookupCompact fastClientResult">
                <div>
                  <b>{foundVehicle.clientName||"Власник авто"}</b>
                  <span>{foundVehicle.clientPhone?`${formatPhone(foundVehicle.clientPhone)} · `:""}дані власника підставлено в наступний крок</span>
                </div>
                <button type="button" disabled>✓ Підтягнуто</button>
              </div>}

              {vinMessage&&vinLookupState!=="found"&&<div className={`vinLookupResult vin-${vinLookupState}`}>
                <div><b>VIN</b><span>{vinMessage}</span></div>
              </div>}

              {vehicleNeedsManualIdentity&&<div className="requestMessage error">
                Марку або модель не знайдено у реєстрі. Уточніть ці дані вручну — CRM не буде створювати неповну картку авто.
              </div>}

              <details className="vehicleAdvanced" open={vehicleNeedsManualIdentity||undefined}>
                <summary>Уточнити дані автомобіля вручну</summary>
                <div className="vehicleAdvancedBody">
                  <div className="requestGrid four vehicleCatalogGrid">
                    <label>
                      <span>Марка</span>
                      <input list="turboLevMakesV5" value={form.make} onFocus={()=>void loadMakes()} onChange={event=>{
                        markManual("make",event.target.value);
                        update("model","");
                        void loadModels(event.target.value);
                      }} placeholder="Volvo"/>
                      <datalist id="turboLevMakesV5">{makes.map(item=><option key={`${item.id}-${item.name}`} value={item.name}/>)}</datalist>
                    </label>
                    <label>
                      <span>Модель</span>
                      <input list="turboLevModelsV5" value={form.model} onFocus={()=>form.make&&void loadModels(form.make)} onChange={event=>markManual("model",event.target.value)} placeholder="XC90"/>
                      <datalist id="turboLevModelsV5">{models.map(item=><option key={`${item.id}-${item.name}`} value={item.name}/>)}</datalist>
                    </label>
                    <label>
                      <span>Рік</span>
                      <select value={form.year} onChange={event=>markManual("year",event.target.value)}>
                        <option value="">—</option>{requestYears.map(year=><option key={year}>{year}</option>)}
                      </select>
                    </label>
                    <label><span>Пробіг, км</span><input value={form.mileage} onChange={event=>update("mileage",event.target.value.replace(/\D/g,""))}/></label>
                    <label><span>Двигун / модифікація</span><input value={form.engine} onChange={event=>update("engine",event.target.value)}/></label>
                    <label><span>Об’єм двигуна, л</span><input value={form.engineVolume} onChange={event=>update("engineVolume",event.target.value.replace(/[^0-9.,]/g,""))}/></label>
                    <label><span>Паливо</span><input value={form.fuelType} onChange={event=>update("fuelType",event.target.value)}/></label>
                    <label><span>Тип кузова</span><input value={form.bodyType} onChange={event=>update("bodyType",event.target.value)}/></label>
                    <label><span>Повна маса, кг</span><input value={form.grossWeight} onChange={event=>update("grossWeight",event.target.value.replace(/\D/g,""))}/></label>
                    <label><span>Привід</span><input value={form.driveType} onChange={event=>update("driveType",event.target.value)}/></label>
                  </div>
                  <div className="advancedMeta">{catalogLoading?"Оновлюю довідник…":`Джерело даних: ${form.vehicleDataSource||"ручне введення"} · довіра ${form.vehicleDataConfidence||0}%`}</div>
                </div>
              </details>
            </section>}

            {step===2&&<section className="requestStep requestFastStep">
              <div className="requestStepTitle">
                <div><small>КРОК 2</small><h3>Як Ваше ім’я та прізвище?</h3></div>
                <span className="requestHint">Якщо авто вже було в CRM — ім’я та телефон підставлені автоматично</span>
              </div>

              {foundVehicle?.clientId&&<div className="clientLookupCompact fastClientResult">
                <div>
                  <b>Власник з картки автомобіля</b>
                  <span>{foundVehicle.clientName||"Ім’я не вказано"}{foundVehicle.clientPhone?` · ${formatPhone(foundVehicle.clientPhone)}`:""}</span>
                </div>
                <button type="button" onClick={useVehicleOwner}>Використати</button>
              </div>}

              <div className="requestGrid two fastClientGrid">
                <label>
                  <span>Ім’я та прізвище *</span>
                  <input value={form.customerName} onChange={event=>update("customerName",event.target.value)} placeholder="Іван Петренко"/>
                </label>
                <label>
                  <span>Телефон *</span>
                  <input value={form.phone} onChange={event=>updatePhone(event.target.value)} inputMode="tel" placeholder="+380 67 123 45 67"/>
                </label>
                <label>
                  <span>Джерело</span>
                  <select value={form.source} onChange={event=>update("source",event.target.value)}>
                    {requestSources.map(item=><option key={item}>{item}</option>)}
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

              <div className="fastLookupCard">
                <div className="fastLookupCopy">
                  <b>Перевірити клієнта за телефоном</b>
                  <span>Якщо це постійний клієнт, підтягнемо його картку</span>
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

              {vehicleConflict&&<div className={`vehicleOwnerConflict ${allowReassign?"confirmed":""}`}>
                <div>
                  <b>Це авто вже прив’язане до іншого клієнта</b>
                  <span>{vehicleConflict.clientName||"Поточний власник"}{vehicleConflict.clientPhone?` · ${formatPhone(vehicleConflict.clientPhone)}`:""}</span>
                </div>
                <div>
                  <button type="button" onClick={useVehicleOwner}>Залишити поточного власника</button>
                  <button type="button" className="danger" onClick={()=>setAllowReassign(true)}>
                    {allowReassign?"✓ Переприв’язування підтверджено":"Переприв’язати до нового клієнта"}
                  </button>
                </div>
              </div>}
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
                {requestCategories.map(item=><button type="button" key={item} className={form.category===item?"selected":""} onClick={()=>update("category",form.category===item?"":item)}>{item}</button>)}
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
                <label><span>Дата *</span><input type="date" value={form.appointmentDate} onChange={event=>update("appointmentDate",event.target.value)}/></label>
                <label><span>Час *</span><input type="time" value={form.appointmentTime} onChange={event=>update("appointmentTime",event.target.value)}/></label>
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
                <article><small>Авто</small><strong>{vehicleTitle(form)}</strong><span>{form.plate||form.vin}</span></article>
                <article><small>Клієнт</small><strong>{form.customerName}</strong><span>{form.phone}</span></article>
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
              ?<button type="button" className="primary" onClick={goNext}>{step===1&&!hasVehicleIdentifier?"Вкажіть номер авто":step===1&&!hasVehicleIdentity?"Уточніть марку і модель":step===2&&!canLeaveClient?"Заповніть клієнта":"Далі →"}</button>
              :<button type="submit" className="primary fastBookButton" disabled={saving}>{saving?"Записую…":"Записати на діагностику"}</button>}
          </div>
        </div>
      </form>
    </div>}
  </>;
}
