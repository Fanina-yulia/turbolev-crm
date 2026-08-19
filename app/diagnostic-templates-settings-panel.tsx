"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./diagnostic-templates-settings-panel.module.css";

type Item = {
  id: string;
  sectionId: string;
  code: string;
  name: string;
  position: string | null;
  measurementUnit: string | null;
  suggestedWorkName: string | null;
  suggestedPartName: string | null;
  isRequired: boolean;
  sortOrder: number;
};
type Section = { id: string; templateId: string; code: string; name: string; sortOrder: number; items: Item[] };
type Template = { id: string; code: string; name: string; description: string | null; isDefault: boolean; isActive: boolean; sortOrder: number; usageCount: number; sections: Section[] };
type DraftItem = Pick<Item, "name"|"position"|"measurementUnit"|"suggestedWorkName"|"suggestedPartName"|"isRequired"|"sortOrder">;

type Api = { ok: boolean; templates?: Template[]; error?: string; message?: string };

const emptyItem:DraftItem={name:"",position:"",measurementUnit:"",suggestedWorkName:"",suggestedPartName:"",isRequired:true,sortOrder:100};

export function DiagnosticTemplatesSettingsPanel(){
  const [templates,setTemplates]=useState<Template[]>([]);
  const [selectedId,setSelectedId]=useState("");
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [message,setMessage]=useState("");
  const [creating,setCreating]=useState(false);
  const [newTemplate,setNewTemplate]=useState({name:"",description:"",isDefault:false});
  const [templateDraft,setTemplateDraft]=useState({name:"",description:"",isActive:true,isDefault:false,sortOrder:100});
  const [sectionDrafts,setSectionDrafts]=useState<Record<string,{name:string;sortOrder:number}>>({});
  const [itemDrafts,setItemDrafts]=useState<Record<string,DraftItem>>({});
  const [newSectionName,setNewSectionName]=useState("");
  const [addingItemSection,setAddingItemSection]=useState<string|null>(null);
  const [newItem,setNewItem]=useState<DraftItem>(emptyItem);

  const selected=useMemo(()=>templates.find(item=>item.id===selectedId)||templates[0]||null,[templates,selectedId]);

  function syncDrafts(template:Template|null){
    if(!template)return;
    setTemplateDraft({name:template.name,description:template.description||"",isActive:template.isActive,isDefault:template.isDefault,sortOrder:template.sortOrder});
    setSectionDrafts(Object.fromEntries(template.sections.map(section=>[section.id,{name:section.name,sortOrder:section.sortOrder}])));
    setItemDrafts(Object.fromEntries(template.sections.flatMap(section=>section.items.map(item=>[item.id,{name:item.name,position:item.position||"",measurementUnit:item.measurementUnit||"",suggestedWorkName:item.suggestedWorkName||"",suggestedPartName:item.suggestedPartName||"",isRequired:item.isRequired,sortOrder:item.sortOrder}]))));
  }

  async function load(preferId?:string){
    setLoading(true);setError("");
    try{
      const response=await fetch("/api/settings/diagnostic-templates",{cache:"no-store",credentials:"include"});
      const data=await response.json() as Api;
      if(!response.ok||!data.ok)throw new Error(data.message||data.error||"Не вдалося завантажити шаблони");
      const next=data.templates||[];setTemplates(next);
      const nextId=preferId&&next.some(item=>item.id===preferId)?preferId:selectedId&&next.some(item=>item.id===selectedId)?selectedId:next[0]?.id||"";
      setSelectedId(nextId);
      syncDrafts(next.find(item=>item.id===nextId)||null);
    }catch(cause){setError(cause instanceof Error?cause.message:"Помилка завантаження");}
    finally{setLoading(false);}
  }
  useEffect(()=>{void load();},[]);
  useEffect(()=>{if(selected)syncDrafts(selected);},[selectedId]);

  async function action(body:Record<string,unknown>,success:string,preferId=selected?.id){
    setBusy(true);setError("");setMessage("");
    try{
      const response=await fetch("/api/settings/diagnostic-templates",{method:"POST",credentials:"include",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
      const data=await response.json() as Api;
      if(!response.ok||!data.ok)throw new Error(data.message||data.error||"Не вдалося зберегти");
      const next=data.templates||[];setTemplates(next);
      const target=preferId&&next.some(item=>item.id===preferId)?preferId:next[0]?.id||"";setSelectedId(target);syncDrafts(next.find(item=>item.id===target)||null);
      setMessage(success);window.setTimeout(()=>setMessage(""),2600);
    }catch(cause){setError(cause instanceof Error?cause.message:"Помилка збереження");}
    finally{setBusy(false);}
  }

  async function createTemplate(){
    if(!newTemplate.name.trim()){setError("Вкажіть назву шаблону.");return;}
    setBusy(true);setError("");
    try{
      const response=await fetch("/api/settings/diagnostic-templates",{method:"POST",credentials:"include",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"CREATE_TEMPLATE",...newTemplate})});
      const data=await response.json() as Api;if(!response.ok||!data.ok)throw new Error(data.message||data.error||"Не вдалося створити шаблон");
      const next=data.templates||[];setTemplates(next);const created=next.find(item=>item.name===newTemplate.name)||next[0];setSelectedId(created?.id||"");syncDrafts(created||null);setNewTemplate({name:"",description:"",isDefault:false});setCreating(false);setMessage("Шаблон створено.");
    }catch(cause){setError(cause instanceof Error?cause.message:"Помилка");}finally{setBusy(false);}
  }

  if(loading&&!templates.length)return <div className={styles.state}>Завантажую шаблони діагностики…</div>;

  return <div className={styles.page}>
    <header className={styles.head}><div><p>ДОВІДНИКИ · ДІАГНОСТИКА</p><h2>Шаблони діагностики</h2><span>Керуйте тим, що бачить механік: секції, пункти, заміри, рекомендовані роботи та деталі.</span></div><button className={styles.primary} type="button" onClick={()=>setCreating(true)}>+ Новий шаблон</button></header>
    {error&&<div className={styles.error}>{error}<button type="button" onClick={()=>setError("")}>×</button></div>}
    {message&&<div className={styles.success}>{message}</div>}
    {creating&&<section className={styles.createCard}><div><label><span>Назва *</span><input autoFocus value={newTemplate.name} onChange={event=>setNewTemplate(current=>({...current,name:event.target.value}))} placeholder="Наприклад: Діагностика кондиціонера"/></label><label><span>Опис</span><input value={newTemplate.description} onChange={event=>setNewTemplate(current=>({...current,description:event.target.value}))} placeholder="Коли і для чого використовується"/></label><label className={styles.checkbox}><input type="checkbox" checked={newTemplate.isDefault} onChange={event=>setNewTemplate(current=>({...current,isDefault:event.target.checked}))}/><span>Додавати автоматично при старті діагностики</span></label></div><footer><button className={styles.secondary} type="button" onClick={()=>setCreating(false)}>Скасувати</button><button className={styles.primary} type="button" disabled={busy} onClick={()=>void createTemplate()}>Створити</button></footer></section>}

    <div className={styles.layout}>
      <aside className={styles.list}>{templates.map(template=><button type="button" key={template.id} className={`${styles.templateCard} ${selected?.id===template.id?styles.templateActive:""}`} onClick={()=>setSelectedId(template.id)}><div><strong>{template.name}</strong><span>{template.sections.length} секц. · {template.sections.reduce((sum,section)=>sum+section.items.length,0)} пунктів</span></div><div className={styles.badges}>{template.isDefault&&<b>За замовч.</b>}<em className={template.isActive?styles.on:styles.off}>{template.isActive?"Активний":"Вимкнений"}</em></div>{template.usageCount>0&&<small>Використано: {template.usageCount}</small>}</button>)}</aside>

      <main className={styles.editor}>{selected?<>
        <section className={styles.templateSettings}><div className={styles.sectionTitle}><div><p>ШАБЛОН</p><h3>{selected.name}</h3><span>Код: {selected.code} · використано {selected.usageCount} разів</span></div><div className={styles.headerActions}><button className={styles.secondary} type="button" disabled={busy||selected.usageCount>0} title={selected.usageCount>0?"Використаний шаблон можна лише деактивувати":""} onClick={()=>{if(confirm("Видалити шаблон?"))void action({action:"DELETE_TEMPLATE",id:selected.id},"Шаблон видалено.",undefined)}}>Видалити</button><button className={styles.primary} type="button" disabled={busy} onClick={()=>void action({action:"UPDATE_TEMPLATE",id:selected.id,...templateDraft},"Шаблон збережено.")}>Зберегти</button></div></div>
          <div className={styles.templateGrid}><label><span>Назва</span><input value={templateDraft.name} onChange={event=>setTemplateDraft(current=>({...current,name:event.target.value}))}/></label><label><span>Порядок</span><input type="number" value={templateDraft.sortOrder} onChange={event=>setTemplateDraft(current=>({...current,sortOrder:Number(event.target.value)}))}/></label><label className={styles.wide}><span>Опис</span><textarea rows={2} value={templateDraft.description} onChange={event=>setTemplateDraft(current=>({...current,description:event.target.value}))}/></label><label className={styles.checkbox}><input type="checkbox" checked={templateDraft.isActive} onChange={event=>setTemplateDraft(current=>({...current,isActive:event.target.checked}))}/><span>Активний шаблон</span></label><label className={styles.checkbox}><input type="checkbox" checked={templateDraft.isDefault} onChange={event=>setTemplateDraft(current=>({...current,isDefault:event.target.checked}))}/><span>Автоматично додавати механіку</span></label></div>
        </section>

        <div className={styles.sections}>{selected.sections.map((section,index)=>{const sd=sectionDrafts[section.id]||{name:section.name,sortOrder:section.sortOrder};return <section className={styles.sectionCard} key={section.id}><header><div className={styles.sectionNumber}>{index+1}</div><div className={styles.sectionName}><input value={sd.name} onChange={event=>setSectionDrafts(current=>({...current,[section.id]:{...sd,name:event.target.value}}))}/><span>{section.items.length} пунктів · код {section.code}</span></div><input className={styles.orderInput} type="number" title="Порядок" value={sd.sortOrder} onChange={event=>setSectionDrafts(current=>({...current,[section.id]:{...sd,sortOrder:Number(event.target.value)}}))}/><button className={styles.smallButton} type="button" disabled={busy} onClick={()=>void action({action:"UPDATE_SECTION",id:section.id,...sd},"Секцію збережено.")}>Зберегти</button><button className={styles.iconDanger} type="button" title="Видалити секцію" disabled={busy} onClick={()=>{if(confirm(`Видалити секцію «${section.name}»?`))void action({action:"DELETE_SECTION",id:section.id},"Секцію видалено.")}}>×</button></header>
          <div className={styles.itemsHeader}><span>Пункт перевірки</span><span>Замір</span><span>Рекомендована робота</span><span>Рекомендована деталь</span><span>Обов.</span><span/></div>
          <div className={styles.items}>{section.items.map(item=>{const d=itemDrafts[item.id]||{name:item.name,position:item.position||"",measurementUnit:item.measurementUnit||"",suggestedWorkName:item.suggestedWorkName||"",suggestedPartName:item.suggestedPartName||"",isRequired:item.isRequired,sortOrder:item.sortOrder};const update=(patch:Partial<DraftItem>)=>setItemDrafts(current=>({...current,[item.id]:{...d,...patch}}));return <div className={styles.itemRow} key={item.id}><div><input value={d.name} onChange={event=>update({name:event.target.value})}/><input className={styles.subInput} value={d.position} onChange={event=>update({position:event.target.value})} placeholder="Позиція: ліва/права…"/></div><input value={d.measurementUnit} onChange={event=>update({measurementUnit:event.target.value})} placeholder="мм / V / bar"/><input value={d.suggestedWorkName} onChange={event=>update({suggestedWorkName:event.target.value})} placeholder="Робота для кошторису"/><input value={d.suggestedPartName} onChange={event=>update({suggestedPartName:event.target.value})} placeholder="Деталь для підбору"/><label className={styles.miniCheck}><input type="checkbox" checked={d.isRequired} onChange={event=>update({isRequired:event.target.checked})}/></label><div className={styles.itemActions}><input type="number" title="Порядок" value={d.sortOrder} onChange={event=>update({sortOrder:Number(event.target.value)})}/><button type="button" disabled={busy} onClick={()=>void action({action:"UPDATE_ITEM",id:item.id,...d,position:d.position||null,measurementUnit:d.measurementUnit||null,suggestedWorkName:d.suggestedWorkName||null,suggestedPartName:d.suggestedPartName||null},"Пункт збережено.")}>✓</button><button className={styles.danger} type="button" disabled={busy} onClick={()=>{if(confirm(`Видалити пункт «${item.name}»?`))void action({action:"DELETE_ITEM",id:item.id},"Пункт видалено.")}}>×</button></div></div>})}</div>
          {addingItemSection===section.id?<div className={styles.addItem}><input autoFocus value={newItem.name} onChange={event=>setNewItem(current=>({...current,name:event.target.value}))} placeholder="Назва пункту *"/><input value={newItem.measurementUnit} onChange={event=>setNewItem(current=>({...current,measurementUnit:event.target.value}))} placeholder="Одиниця заміру"/><input value={newItem.suggestedWorkName} onChange={event=>setNewItem(current=>({...current,suggestedWorkName:event.target.value}))} placeholder="Запропонована робота"/><input value={newItem.suggestedPartName} onChange={event=>setNewItem(current=>({...current,suggestedPartName:event.target.value}))} placeholder="Запропонована деталь"/><div><button className={styles.secondary} type="button" onClick={()=>{setAddingItemSection(null);setNewItem(emptyItem)}}>Скасувати</button><button className={styles.primary} type="button" disabled={busy||!newItem.name.trim()} onClick={()=>{void action({action:"ADD_ITEM",sectionId:section.id,...newItem},"Пункт додано.");setAddingItemSection(null);setNewItem(emptyItem)}}>Додати</button></div></div>:<button className={styles.addButton} type="button" onClick={()=>{setAddingItemSection(section.id);setNewItem({...emptyItem,sortOrder:(section.items.at(-1)?.sortOrder||0)+10})}}>+ Додати пункт</button>}
        </section>})}</div>
        <section className={styles.addSection}><input value={newSectionName} onChange={event=>setNewSectionName(event.target.value)} placeholder="Назва нової секції"/><button className={styles.primary} type="button" disabled={busy||!newSectionName.trim()} onClick={()=>{void action({action:"ADD_SECTION",templateId:selected.id,name:newSectionName,sortOrder:(selected.sections.at(-1)?.sortOrder||0)+10},"Секцію додано.");setNewSectionName("")}}>+ Додати секцію</button></section>
      </>:<div className={styles.state}>Створіть або оберіть шаблон.</div>}</main>
    </div>
  </div>;
}
