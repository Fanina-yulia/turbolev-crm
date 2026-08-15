"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./workflow-settings-panel.module.css";

type Tone="neutral"|"info"|"accent"|"warning"|"success"|"danger";
type Status={code:string;label:string;stage:string;tone:Tone;sortOrder:number;system:true;terminal?:boolean;legacy?:boolean;compatibilityOnly?:boolean;responsibleRoles?:string[]};
type Transition={from:string;to:string;gates?:string[];actions?:string[];description?:string};
type Entity={entity:string;label:string;kind:"PROCESS"|"PROFILE";description:string;statuses:Status[];transitions:Transition[];aliases?:Record<string,string>};
type Catalog={version:string;principles:Record<string,boolean>;masterStages:Array<{code:string;label:string;order:number}>;roles:Record<string,string>;blockers:Record<string,string>;vehicleLocations:Record<string,string>;hardGates:Record<string,string>;actions:Record<string,string>;entities:Entity[]};
type Response={ok:boolean;catalog?:Catalog;error?:string};

const preferred=["WORK_ORDER","APPOINTMENT","DIAGNOSTIC","PARTS_REQUEST","SUPPLIER_ORDER","STOCK_RESERVATION","PAYMENT","QUALITY_CONTROL","WARRANTY","LEAD","INQUIRY","CLIENT","VEHICLE"];
function toneClass(tone:Tone){return tone==="accent"?styles.toneAccent:tone==="success"?styles.toneSuccess:tone==="warning"?styles.toneWarning:tone==="danger"?styles.toneDanger:tone==="info"?styles.toneInfo:"";}

export function WorkflowSettingsPanel(){
 const [catalog,setCatalog]=useState<Catalog|null>(null);const [selected,setSelected]=useState("WORK_ORDER");const [showCompatibility,setShowCompatibility]=useState(false);const [error,setError]=useState("");
 useEffect(()=>{const controller=new AbortController();void(async()=>{try{const response=await fetch("/api/workflow/statuses",{cache:"no-store",signal:controller.signal});const data=await response.json() as Response;if(!response.ok||!data.ok||!data.catalog)throw new Error(data.error||"Не вдалося завантажити каталог статусів");setCatalog(data.catalog);}catch(e){if((e as Error).name!=="AbortError")setError(e instanceof Error?e.message:"Помилка завантаження");}})();return()=>controller.abort();},[]);
 const entities=useMemo(()=>catalog?[...catalog.entities].sort((a,b)=>preferred.indexOf(a.entity)-preferred.indexOf(b.entity)):[],[catalog]);
 const entity=entities.find(item=>item.entity===selected)||entities[0];
 const statuses=entity?.statuses.filter(item=>showCompatibility||(!item.compatibilityOnly&&!item.legacy))??[];
 if(error)return <div className={styles.error}>{error}</div>;
 if(!catalog||!entity)return <div className={styles.loading}>Завантажую процеси та статуси…</div>;
 return <div className={styles.page}>
   <header className={styles.head}><div><p className={styles.eyebrow}>TURBO LEV · WORKFLOW ENGINE</p><h2>Процеси та статуси</h2><p>Єдине джерело правди для життєвих циклів CRM. Системні коди захищені; на цьому етапі сторінка працює у безпечному режимі перегляду.</p></div><span className={styles.version}>Architecture v{catalog.version}</span></header>
   <div className={styles.notice}><strong>Важливо:</strong> статус описує стан конкретної сутності. Blocker пояснює причину очікування, а місцезнаходження авто зберігається окремо. Автоматичні actions тут поки декларативні й не запускають нові побічні дії самостійно.</div>
   <div className={styles.stageRail}>{catalog.masterStages.filter(s=>!["PROFILE","CLOSED"].includes(s.code)).map(stage=><span className={styles.stage} key={stage.code}>{stage.label}</span>)}</div>
   <div className={styles.layout}>
    <aside className={styles.entities}>{entities.map(item=><button type="button" key={item.entity} className={`${styles.entity} ${item.entity===entity.entity?styles.entityActive:""}`} onClick={()=>setSelected(item.entity)}><strong>{item.label}</strong><small>{item.statuses.filter(s=>!s.compatibilityOnly&&!s.legacy).length}</small></button>)}</aside>
    <main className={styles.main}>
      <section className={styles.summary}><div className={styles.summaryTop}><div><h3>{entity.label}</h3><p>{entity.description}</p></div><span className={styles.kind}>{entity.kind==="PROCESS"?"Процес":"Профіль"}</span></div><div className={styles.toolbar}><label><input type="checkbox" checked={showCompatibility} onChange={e=>setShowCompatibility(e.target.checked)}/> Показати legacy / compatibility</label><span className={styles.counts}>{statuses.length} статусів · {entity.transitions.length} переходів</span></div></section>
      <section className={styles.section}><div className={styles.sectionHead}><strong>Статуси</strong><span>код · етап · відповідальний</span></div><div className={styles.statuses}>{statuses.map(status=><div className={styles.status} key={status.code}><i className={`${styles.dot} ${toneClass(status.tone)}`}/><div className={styles.statusName}><strong>{status.label}</strong><code>{status.code}</code></div><span className={styles.statusStage}>{catalog.masterStages.find(s=>s.code===status.stage)?.label||status.stage}</span><div className={styles.roles}>{(status.responsibleRoles||[]).map(role=><span className={styles.role} key={role}>{catalog.roles[role]||role}</span>)}</div><div className={styles.flags}><span className={`${styles.flag} ${styles.system}`}>SYSTEM</span>{status.terminal&&<span className={`${styles.flag} ${styles.terminal}`}>TERMINAL</span>}{(status.legacy||status.compatibilityOnly)&&<span className={`${styles.flag} ${styles.legacy}`}>{status.legacy?"LEGACY":"BRIDGE"}</span>}</div></div>)}</div></section>
      {entity.transitions.length>0&&<section className={styles.section}><div className={styles.sectionHead}><strong>Дозволені переходи</strong><span>Hard Gates та автоматичні реакції</span></div><div className={styles.transitions}>{entity.transitions.map((tr,index)=><div className={styles.transition} key={`${tr.from}-${tr.to}-${index}`}><div className={styles.transitionRoute}><code>{tr.from}</code><span className={styles.arrow}>→</span><code>{tr.to}</code></div>{((tr.gates?.length||0)+(tr.actions?.length||0)>0)&&<div className={styles.meta}>{tr.gates?.map(g=><span className={styles.gate} key={g} title={catalog.hardGates[g]||g}>Gate: {catalog.hardGates[g]||g}</span>)}{tr.actions?.map(a=><span className={styles.action} key={a}>Action: {catalog.actions[a]||a}</span>)}</div>}</div>)}</div></section>}
      <section className={styles.section}><div className={styles.sectionHead}><strong>Blockers</strong><span>причина очікування ≠ статус</span></div><div className={styles.dictionary}>{Object.entries(catalog.blockers).map(([code,label])=><div className={styles.dictionaryItem} key={code}><code>{code}</code><span>{label}</span></div>)}</div></section>
      <section className={styles.section}><div className={styles.sectionHead}><strong>Місцезнаходження авто</strong><span>фізичне розташування ≠ статус ремонту</span></div><div className={styles.dictionary}>{Object.entries(catalog.vehicleLocations).map(([code,label])=><div className={styles.dictionaryItem} key={code}><code>{code}</code><span>{label}</span></div>)}</div></section>
    </main>
   </div>
 </div>;
}
