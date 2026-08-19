"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import styles from "./supplier-settings-bridge.module.css";

type DirectoryItem={
  id:string;
  category:string;
  name:string;
  code:string|null;
  data:Record<string,unknown>|null;
  isActive:boolean;
  sortOrder:number;
};

type OperationsResponse={
  ok:boolean;
  directory:DirectoryItem[];
  error?:string;
};

type IntegrationField={
  key:string;
  label:string;
  secret:boolean;
  required?:boolean;
  placeholder?:string;
};

type IntegrationItem={
  provider:string;
  category:string;
  title:string;
  description:string;
  fields:IntegrationField[];
  configured:boolean;
  configuredVia:string|null;
  status:string;
  masked:Record<string,string>;
  visible:Record<string,string>;
  lastTestAt?:string|null;
  lastTestStatus?:string|null;
  lastTestMessage?:string|null;
};

type IntegrationsResponse={ok?:boolean;integrations?:IntegrationItem[];error?:string};

type SupplierDraft={
  name:string;
  phone:string;
  email:string;
  website:string;
  deliveryDays:string;
  payment:string;
};

type ProviderUi={
  provider:string;
  auth:string;
  api:string;
  capabilities:string[];
  live:boolean;
  note:string;
  setupFields:string[];
  requestChecklist?:string[];
};

const EMPTY_DRAFT:SupplierDraft={name:"",phone:"",email:"",website:"",deliveryDays:"",payment:"Передплата"};

const PROVIDER_UI:Record<string,ProviderUi>={
  BM_PARTS:{
    provider:"BM_PARTS",
    auth:"API key",
    api:"https://api.bm.parts",
    capabilities:["Пошук","Закупівельні ціни","Залишки","Склади"],
    live:true,
    note:"Офіційний API BM Parts. Ключ використовується тільки сервером CRM.",
    setupFields:["apiKey"],
  },
  UNIQUE_TRADE:{
    provider:"UNIQUE_TRADE",
    auth:"B2B логін + пароль → JWT",
    api:"https://order24-api.utr.ua",
    capabilities:["Пошук","Персональні ціни","Залишки","Склади","Замовлення API"],
    live:true,
    note:"API v2. Browser fingerprint і роботу з токенами CRM веде автоматично.",
    setupFields:["email","password"],
  },
  AUTONOVA_D:{
    provider:"AUTONOVA_D",
    auth:"Після надання офіційного API-контракту",
    api:"Endpoint не підтверджено",
    capabilities:["B2B каталог","Ціни","Наявність"],
    live:false,
    note:"B2B робота підтримується, але live API не активуємо без офіційної документації та production endpoint.",
    setupFields:[],
    requestChecklist:["API/B2B документація","Production endpoint","Спосіб авторизації","Пошук за артикулом і брендом","Персональна ціна та залишки","Rate limits / IP whitelist","Метод створення замовлення"],
  },
  ATL:{
    provider:"ATL",
    auth:"Після надання офіційного B2B/API доступу",
    api:"Endpoint не підтверджено",
    capabilities:["Корпоративні закупівлі","B2B"],
    live:false,
    note:"Не використовуємо пароль від звичайного кабінету та приховані endpoint-и сайту. Потрібен офіційний API-контракт ATL.",
    setupFields:[],
    requestChecklist:["Офіційний API/B2B endpoint","Документація авторизації","Персональні ціни","Залишки по складах","Пошук деталей","Rate limits","Умови створення замовлення"],
  },
};

const SUPPLIER_ORDER=["BM_PARTS","UNIQUE_TRADE","AUTONOVA_D","ATL"];

function currentRequestedTab(){
  if(typeof window==="undefined")return "suppliers";
  return new URL(window.location.href).searchParams.get("settingsTab")||"schedule";
}

function findSettingsShell(){
  const heading=Array.from(document.querySelectorAll<HTMLHeadingElement>("h2")).find(node=>(node.textContent||"").trim()==="Налаштування");
  const modal=heading?.closest<HTMLElement>("section")||null;
  const layout=modal?.querySelector<HTMLElement>('div[class*="layout"]')||null;
  const content=layout?.querySelector<HTMLElement>(":scope > main")||null;
  const maybeHead=heading?.parentElement?.parentElement as HTMLElement|null;
  const head=maybeHead&&modal&&maybeHead.parentElement===modal?maybeHead:null;
  return {content,head};
}

function dataText(item:DirectoryItem,key:string){
  const value=item.data?.[key];
  return value==null?"":String(value);
}

function formatDate(value?:string|null){
  if(!value)return null;
  const date=new Date(value);
  if(Number.isNaN(date.getTime()))return null;
  return new Intl.DateTimeFormat("uk-UA",{day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"}).format(date);
}

function providerMeta(item:IntegrationItem){
  return PROVIDER_UI[item.provider]||{
    provider:item.provider,
    auth:"За документацією постачальника",
    api:"—",
    capabilities:[],
    live:false,
    note:item.description,
    setupFields:[],
  };
}

function statusView(item:IntegrationItem){
  const meta=providerMeta(item);
  if(!meta.live)return {label:"API очікується",tone:"manual" as const};
  if(item.status==="CONNECTED")return {label:"Підключено",tone:"good" as const};
  if(item.status==="ERROR")return {label:"Помилка авторизації",tone:"bad" as const};
  if(item.configured)return {label:"Доступи збережено",tone:"ready" as const};
  return {label:"Не налаштовано",tone:"off" as const};
}

function visibleSetupFields(item:IntegrationItem){
  const allowed=new Set(providerMeta(item).setupFields);
  return item.fields.filter(field=>allowed.has(field.key));
}

export function SupplierSettingsBridge(){
  const [active,setActive]=useState(false);
  const [portalHost,setPortalHost]=useState<HTMLElement|null>(null);
  const [directory,setDirectory]=useState<DirectoryItem[]>([]);
  const [integrations,setIntegrations]=useState<IntegrationItem[]>([]);
  const [loading,setLoading]=useState(false);
  const [saving,setSaving]=useState(false);
  const [testing,setTesting]=useState<string|null>(null);
  const [message,setMessage]=useState("");
  const [showAdd,setShowAdd]=useState(false);
  const [draft,setDraft]=useState<SupplierDraft>(EMPTY_DRAFT);
  const [editingProvider,setEditingProvider]=useState<string|null>(null);
  const [integrationValues,setIntegrationValues]=useState<Record<string,string>>({});
  const [manualOpen,setManualOpen]=useState<string|null>(null);

  useEffect(()=>{
    const sync=()=>setActive(currentRequestedTab()==="suppliers");
    const onTab=(event:Event)=>setActive(((event as CustomEvent<string>).detail||"schedule")==="suppliers");
    sync();
    window.addEventListener("popstate",sync);
    window.addEventListener("turbolev:settings-tab",onTab);
    return()=>{
      window.removeEventListener("popstate",sync);
      window.removeEventListener("turbolev:settings-tab",onTab);
    };
  },[]);

  useEffect(()=>{
    if(!active){setPortalHost(null);return;}
    let observer:MutationObserver|null=null;
    let host:HTMLElement|null=null;
    let hiddenHead:HTMLElement|null=null;

    const mount=()=>{
      const {content,head}=findSettingsShell();
      if(!content)return false;
      if(host?.isConnected&&host.parentElement===content)return true;
      if(host?.isConnected)host.remove();
      host=document.createElement("div");
      host.dataset.turbolevSuppliersRoot="true";
      host.className=styles.portalHost;
      content.dataset.turbolevSuppliersEnhanced="true";
      content.appendChild(host);
      if(head){hiddenHead=head;head.dataset.turbolevSuppliersHidden="true";}
      setPortalHost(host);
      return true;
    };

    mount();
    observer=new MutationObserver(()=>mount());
    observer.observe(document.body,{childList:true,subtree:true});

    return()=>{
      observer?.disconnect();
      const {content}=findSettingsShell();
      if(content)delete content.dataset.turbolevSuppliersEnhanced;
      if(hiddenHead)delete hiddenHead.dataset.turbolevSuppliersHidden;
      host?.remove();
      setPortalHost(null);
    };
  },[active]);

  async function loadAll(){
    setLoading(true);
    try{
      const [operationsResponse,integrationsResponse]=await Promise.all([
        fetch("/api/settings/operations",{cache:"no-store"}),
        fetch("/api/settings/integrations",{cache:"no-store"}),
      ]);
      const operations=await operationsResponse.json() as OperationsResponse;
      const integrationData=await integrationsResponse.json() as IntegrationsResponse;
      if(!operationsResponse.ok||!operations.ok)throw new Error(operations.error||"Не вдалося завантажити постачальників");
      if(!integrationsResponse.ok||integrationData.ok===false)throw new Error(integrationData.error||"Не вдалося завантажити інтеграції");
      setDirectory((operations.directory||[]).filter(item=>item.category==="SUPPLIER"));
      const suppliers=(integrationData.integrations||[]).filter(item=>item.category==="SUPPLIERS");
      suppliers.sort((a,b)=>SUPPLIER_ORDER.indexOf(a.provider)-SUPPLIER_ORDER.indexOf(b.provider));
      setIntegrations(suppliers);
    }catch(error){
      setMessage(error instanceof Error?error.message:"Помилка завантаження");
    }finally{setLoading(false);}
  }

  useEffect(()=>{if(active)void loadAll();},[active]);

  const connectedCount=useMemo(()=>integrations.filter(item=>providerMeta(item).live&&item.status==="CONNECTED").length,[integrations]);
  const configuredCount=useMemo(()=>integrations.filter(item=>providerMeta(item).live&&item.configured).length,[integrations]);

  async function operation(payload:Record<string,unknown>,success:string){
    setSaving(true);setMessage("");
    try{
      const response=await fetch("/api/settings/operations",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify(payload),
      });
      const data=await response.json() as {ok?:boolean;error?:string};
      if(!response.ok||!data.ok)throw new Error(data.error||"Не вдалося зберегти зміни");
      setMessage(success);
      await loadAll();
    }catch(error){setMessage(error instanceof Error?error.message:"Помилка збереження");}
    finally{setSaving(false);}
  }

  async function addSupplier(){
    if(!draft.name.trim()){setMessage("Вкажіть назву постачальника.");return;}
    await operation({
      action:"ADD_DIRECTORY",
      category:"SUPPLIER",
      name:draft.name.trim(),
      data:{
        phone:draft.phone.trim(),
        email:draft.email.trim(),
        website:draft.website.trim(),
        deliveryDays:draft.deliveryDays.trim(),
        payment:draft.payment,
      },
    },"Постачальника додано до довідника.");
    setDraft(EMPTY_DRAFT);
    setShowAdd(false);
  }

  function startIntegrationEdit(item:IntegrationItem){
    const values:Record<string,string>={};
    for(const field of visibleSetupFields(item)){
      if(!field.secret&&item.visible[field.key])values[field.key]=item.visible[field.key];
    }
    setIntegrationValues(values);
    setEditingProvider(item.provider);
    setMessage("");
  }

  async function saveIntegration(item:IntegrationItem){
    const fields=visibleSetupFields(item);
    if(!fields.length)return;
    setSaving(true);setMessage("");
    try{
      const values:Record<string,string>={};
      for(const field of fields){
        if(field.key in integrationValues)values[field.key]=integrationValues[field.key];
      }
      const response=await fetch(`/api/settings/integrations/${item.provider}`,{
        method:"PUT",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({values}),
      });
      const data=await response.json() as {ok?:boolean;error?:string};
      if(!response.ok||!data.ok)throw new Error(data.error||"Не вдалося зберегти доступи");
      setEditingProvider(null);
      setIntegrationValues({});
      setMessage(`${item.title}: доступи збережено. Натисніть «Перевірити», щоб підтвердити live-з'єднання.`);
      await loadAll();
    }catch(error){setMessage(error instanceof Error?error.message:"Помилка інтеграції");}
    finally{setSaving(false);}
  }

  async function testIntegration(item:IntegrationItem){
    if(!providerMeta(item).live||!item.configured)return;
    setTesting(item.provider);setMessage("");
    try{
      const response=await fetch(`/api/settings/integrations/${item.provider}/test`,{method:"POST"});
      const data=await response.json() as {ok?:boolean;message?:string;error?:string};
      setMessage(data.message||data.error||(data.ok?"З'єднання працює.":"Перевірка не пройшла."));
      await loadAll();
    }catch{setMessage("CRM не змогла перевірити з'єднання з постачальником.");}
    finally{setTesting(null);}
  }

  if(!active||!portalHost)return null;

  return createPortal(
    <div className={styles.page}>
      <div className={styles.breadcrumb}><span>⚙</span><span>Налаштування</span><b>›</b><strong>Постачальники</strong></div>

      <section className={styles.hero}>
        <div>
          <span className={styles.eyebrow}>Закупівлі та інтеграції</span>
          <h2>Постачальники</h2>
          <p>Довідник постачальників, безпечні API-доступи та контроль реального з'єднання для пошуку деталей, закупівельних цін і залишків.</p>
        </div>
        <button type="button" className={styles.addButton} onClick={()=>setShowAdd(value=>!value)}>+ Постачальник</button>
      </section>

      <div className={styles.stats}>
        <div><span>У довіднику</span><strong>{directory.length}</strong></div>
        <div><span>Live API налаштовано</span><strong>{configuredCount}/2</strong></div>
        <div><span>Live API підтверджено</span><strong>{connectedCount}/2</strong></div>
        <div><span>Очікують API</span><strong>2</strong></div>
      </div>

      {showAdd&&<section className={styles.addCard}>
        <div className={styles.addHead}><div><h3>Новий постачальник</h3><p>Контактні та комерційні дані довідника. API-доступи зберігаються окремо нижче.</p></div><button type="button" onClick={()=>{setShowAdd(false);setDraft(EMPTY_DRAFT)}}>×</button></div>
        <div className={styles.formGrid}>
          <label><span>Назва *</span><input value={draft.name} onChange={event=>setDraft(current=>({...current,name:event.target.value}))}/></label>
          <label><span>Телефон</span><input value={draft.phone} onChange={event=>setDraft(current=>({...current,phone:event.target.value}))}/></label>
          <label><span>Email</span><input type="email" value={draft.email} onChange={event=>setDraft(current=>({...current,email:event.target.value}))}/></label>
          <label><span>Сайт</span><input value={draft.website} placeholder="https://" onChange={event=>setDraft(current=>({...current,website:event.target.value}))}/></label>
          <label><span>Доставка, днів</span><input inputMode="numeric" value={draft.deliveryDays} onChange={event=>setDraft(current=>({...current,deliveryDays:event.target.value.replace(/[^0-9]/g,"")}))}/></label>
          <label><span>Оплата</span><select value={draft.payment} onChange={event=>setDraft(current=>({...current,payment:event.target.value}))}><option>Передплата</option><option>Післяплата</option><option>Відстрочка</option></select></label>
        </div>
        <div className={styles.formActions}><button type="button" className={styles.secondaryButton} onClick={()=>{setShowAdd(false);setDraft(EMPTY_DRAFT)}}>Скасувати</button><button type="button" className={styles.primaryButton} disabled={saving} onClick={()=>void addSupplier()}>{saving?"Зберігаємо…":"Додати постачальника"}</button></div>
      </section>}

      <section className={styles.directorySection}>
        <div className={styles.sectionHead}><div><h3>Довідник постачальників</h3><p>Контакти, доставка та умови закупівлі.</p></div></div>
        {loading?<div className={styles.loading}>Завантажуємо постачальників…</div>:directory.length?<div className={styles.directoryGrid}>{directory.map(item=><article className={`${styles.directoryCard} ${!item.isActive?styles.inactive:""}`} key={item.id}>
          <div className={styles.directoryTitle}><div><strong>{item.name}</strong><span>{item.isActive?"Активний":"Неактивний"}</span></div><button type="button" disabled={saving} onClick={()=>void operation({action:"TOGGLE_DIRECTORY",id:item.id,isActive:!item.isActive},item.isActive?"Постачальника деактивовано.":"Постачальника активовано.")}>{item.isActive?"Вимкнути":"Увімкнути"}</button></div>
          <dl><div><dt>Телефон</dt><dd>{dataText(item,"phone")||"—"}</dd></div><div><dt>Доставка</dt><dd>{dataText(item,"deliveryDays")?`${dataText(item,"deliveryDays")} дн.`:"—"}</dd></div><div><dt>Оплата</dt><dd>{dataText(item,"payment")||"—"}</dd></div></dl>
        </article>)}</div>:<div className={styles.empty}>Постачальників у довіднику ще немає. API-інтеграції нижче працюють окремо від контактного довідника.</div>}
      </section>

      <section className={styles.integrationsSection}>
        <div className={styles.sectionHead}><div><h3>Інтеграції постачальників</h3><p>У формі показуються тільки ті дані, які реально потрібні конкретному постачальнику. Секрети зберігаються на сервері CRM і не повертаються у відкритому вигляді.</p></div></div>

        <div className={styles.integrationList}>
          {integrations.map(item=>{
            const meta=providerMeta(item);
            const status=statusView(item);
            const fields=visibleSetupFields(item);
            const editing=editingProvider===item.provider;
            const lastTest=formatDate(item.lastTestAt);
            return <article className={styles.integrationCard} key={item.provider}>
              <div className={styles.integrationHeader}>
                <div className={styles.providerIdentity}><div className={styles.providerMark}>{item.title.slice(0,2).toUpperCase()}</div><div><div className={styles.providerName}><strong>{item.title}</strong><span className={`${styles.badge} ${styles[`badge_${status.tone}`]}`}>{status.label}</span></div><p>{meta.note}</p></div></div>
                <a href={item.provider==="BM_PARTS"?"https://b2b.bm.parts/":item.provider==="UNIQUE_TRADE"?"https://order24.utr.ua/ua/home":item.provider==="AUTONOVA_D"?"https://autonovad.ua/":"https://atl.ua/"} target="_blank" rel="noreferrer" className={styles.siteLink}>Сайт ↗</a>
              </div>

              <div className={styles.integrationFacts}>
                <div><span>Авторизація</span><strong>{meta.auth}</strong></div>
                <div><span>API</span><strong>{meta.api}</strong></div>
                <div><span>Остання перевірка</span><strong>{lastTest||"Ще не виконувалась"}</strong></div>
              </div>

              <div className={styles.capabilities}>{meta.capabilities.map(capability=><span key={capability}>{capability}</span>)}</div>

              {item.lastTestMessage&&meta.live&&<div className={`${styles.testMessage} ${item.status==="ERROR"?styles.testError:""}`}>{item.lastTestMessage}</div>}

              {editing&&fields.length>0&&<div className={styles.credentialsBox}>
                <div className={styles.credentialsHead}><div><strong>Доступ до {item.title}</strong><span>{item.provider==="BM_PARTS"?"Введіть API key. Логін і пароль BM Parts для API не потрібні.":"Введіть B2B логін та пароль. JWT, refresh token і browser fingerprint CRM обробляє сама."}</span></div></div>
                <div className={styles.credentialsGrid}>{fields.map(field=><label key={field.key}><span>{field.label}{field.required?" *":""}</span><input type={field.secret?"password":field.key==="email"?"email":"text"} autoComplete="off" placeholder={field.secret?(item.masked[field.key]||"Введіть нове значення"):field.placeholder||""} value={integrationValues[field.key]||""} onChange={event=>setIntegrationValues(current=>({...current,[field.key]:event.target.value}))}/>{field.secret&&item.masked[field.key]&&<small>Зараз збережено: {item.masked[field.key]}. Залиште поле порожнім, щоб не змінювати.</small>}</label>)}</div>
                <div className={styles.credentialsSafety}>🔒 Секретні значення шифруються на сервері. Після збереження CRM показує тільки маску.</div>
                <div className={styles.formActions}><button type="button" className={styles.secondaryButton} onClick={()=>{setEditingProvider(null);setIntegrationValues({})}}>Скасувати</button><button type="button" className={styles.primaryButton} disabled={saving} onClick={()=>void saveIntegration(item)}>{saving?"Зберігаємо…":"Зберегти доступ"}</button></div>
              </div>}

              {!meta.live&&meta.requestChecklist&&manualOpen===item.provider&&<div className={styles.manualBox}><strong>Що запросити у постачальника</strong><ul>{meta.requestChecklist.map(row=><li key={row}>{row}</li>)}</ul><p>До отримання цих даних CRM не робить автоматичні запити до сайту постачальника і не імітує API.</p></div>}

              <div className={styles.integrationActions}>
                {meta.live?<>
                  <button type="button" className={styles.secondaryButton} onClick={()=>editing?(setEditingProvider(null),setIntegrationValues({})):startIntegrationEdit(item)}>{editing?"Закрити налаштування":item.configured?"Змінити доступ":"Налаштувати"}</button>
                  <button type="button" className={styles.checkButton} disabled={!item.configured||testing===item.provider} onClick={()=>void testIntegration(item)}>{testing===item.provider?"Перевіряємо…":"Перевірити"}</button>
                </>:<button type="button" className={styles.secondaryButton} onClick={()=>setManualOpen(current=>current===item.provider?null:item.provider)}>{manualOpen===item.provider?"Сховати вимоги":"Що потрібно для API"}</button>}
              </div>
            </article>;
          })}
        </div>
      </section>

      <section className={styles.policy}>
        <div className={styles.policyIcon}>✓</div><div><strong>Правило Turbo LEV</strong><p>Статус «Підключено» з'являється тільки після успішного live API-запиту. «Доступи збережено» не означає, що з'єднання перевірене.</p></div>
      </section>

      {message&&<div className={styles.statusMessage} role="status">{message}</div>}
    </div>,
    portalHost,
  );
}
