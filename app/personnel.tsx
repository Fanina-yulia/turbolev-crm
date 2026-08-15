"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./personnel.module.css";

type EmployeeDoc={id?:string;type:string;name:string;status:string;fileUrl?:string|null};
type RoleAssignment={id:string;isPrimary:boolean;role:{code:string;name:string;category:string|null};location:{id:string;name:string}|null};
type Employee={id:string;firstName:string;lastName:string;birthDate:string|null;email:string|null;phone:string|null;phoneCountry:string|null;address:string|null;photoUrl:string|null;personnelCategory:string|null;position:string|null;crmLogin:string|null;isActive:boolean;baseSalary:string|number|null;minimumSalary:string|number|null;workPercent:string|number|null;partsSalesPercent:string|number|null;partsMarginPercent:string|number|null;netProfitPercent:string|number|null;payrollRuleNote:string|null;compensationRestricted?:boolean;documents:EmployeeDoc[];roleAssignments:RoleAssignment[]};
type StaffRole={code:string;name:string;category:string|null;economicsMode:string;sortOrder:number};
type Location={id:string;name:string;sortOrder:number};
type PersonnelMeta={roles:StaffRole[];locations:Location[]};
type FormState={id?:string;firstName:string;lastName:string;birthDate:string;email:string;phone:string;phoneCountry:string;address:string;photoUrl:string;personnelCategory:string;position:string;crmLogin:string;isActive:boolean;baseSalary:string;minimumSalary:string;workPercent:string;partsSalesPercent:string;partsMarginPercent:string;netProfitPercent:string;payrollRuleNote:string;documents:EmployeeDoc[];staffRoleCode:string;locationId:string};

const categories=["Керівництво","Продажі","Підбір запчастин","Майстри","Автомеханіки","Адміністрація","Маркетинг","Інше"];
const positions=["Власник","Виконавчий директор","РОП","Продавець","Підборщик","Завідувач станцією","Автомеханік","Маркетинг-директор","SMM-маркетолог","Performance-маркетолог","Бухгалтер","HR","IT / Адміністратор"];
const docs=["Паспорт","ІПН","Диплом","Трудова","Резюме","Договір підряду","Договір про найм","Договір МВ"];
const positionRole:Record<string,string>={"Власник":"OWNER","Виконавчий директор":"EXECUTIVE_DIRECTOR","РОП":"HEAD_OF_SALES","Продавець":"SALES","Підборщик":"PARTS_SPECIALIST","Завідувач станцією":"STATION_MANAGER","Автомеханік":"MECHANIC","Бухгалтер":"ACCOUNTANT","IT / Адміністратор":"ADMINISTRATOR"};
const roleCategory:Record<string,string>={OWNER:"Керівництво",EXECUTIVE_DIRECTOR:"Керівництво",HEAD_OF_SALES:"Продажі",SALES:"Продажі",PARTS_SPECIALIST:"Підбір запчастин",STATION_MANAGER:"Майстри",MECHANIC:"Автомеханіки",ACCOUNTANT:"Адміністрація",ADMINISTRATOR:"Адміністрація"};
const empty:FormState={firstName:"",lastName:"",birthDate:"",email:"",phone:"+380",phoneCountry:"UA",address:"",photoUrl:"",personnelCategory:"",position:"",crmLogin:"",isActive:true,baseSalary:"",minimumSalary:"",workPercent:"",partsSalesPercent:"",partsMarginPercent:"",netProfitPercent:"",payrollRuleNote:"",documents:docs.map(name=>({type:name.toUpperCase().replaceAll(" ","_"),name,status:"MISSING"})),staffRoleCode:"",locationId:""};
function num(v:string|number|null){return v==null?"":String(v)}
function primaryAssignment(e:Employee){return e.roleAssignments?.find(item=>item.isPrimary)||e.roleAssignments?.[0]||null}
function toForm(e:Employee):FormState{const assignment=primaryAssignment(e);return{id:e.id,firstName:e.firstName,lastName:e.lastName,birthDate:e.birthDate?e.birthDate.slice(0,10):"",email:e.email||"",phone:e.phone||"+380",phoneCountry:e.phoneCountry||"UA",address:e.address||"",photoUrl:e.photoUrl||"",personnelCategory:e.personnelCategory||"",position:e.position||"",crmLogin:e.crmLogin||"",isActive:e.isActive,baseSalary:num(e.baseSalary),minimumSalary:num(e.minimumSalary),workPercent:num(e.workPercent),partsSalesPercent:num(e.partsSalesPercent),partsMarginPercent:num(e.partsMarginPercent),netProfitPercent:num(e.netProfitPercent),payrollRuleNote:e.payrollRuleNote||"",documents:docs.map(name=>e.documents.find(d=>d.name===name)||{type:name.toUpperCase().replaceAll(" ","_"),name,status:"MISSING"}),staffRoleCode:assignment?.role.code||positionRole[e.position||""]||"",locationId:assignment?.location?.id||""}}
function initials(e:{firstName:string;lastName:string}){return `${e.firstName?.[0]||""}${e.lastName?.[0]||""}`.toUpperCase()||"HR"}
function roleName(e:Employee){return primaryAssignment(e)?.role.name||e.position||"Роль не вказана"}
function locationName(e:Employee){return primaryAssignment(e)?.location?.name||"—"}

export function Personnel(){
 const [items,setItems]=useState<Employee[]>([]);const [meta,setMeta]=useState<PersonnelMeta>({roles:[],locations:[]});const [query,setQuery]=useState("");const [category,setCategory]=useState("");const [roleFilter,setRoleFilter]=useState("");const [statusFilter,setStatusFilter]=useState("active");const [form,setForm]=useState<FormState|null>(null);const [error,setError]=useState("");const [loading,setLoading]=useState(true);const [saving,setSaving]=useState(false);const [compensationRestricted,setCompensationRestricted]=useState(false);
 async function load(){setLoading(true);setError("");try{const r=await fetch("/api/personnel",{cache:"no-store"});const d=await r.json();if(!r.ok||!d.ok)throw new Error(d.error||"Не вдалося завантажити персонал");setItems(d.items||[]);setMeta({roles:Array.isArray(d.meta?.roles)?d.meta.roles:[],locations:Array.isArray(d.meta?.locations)?d.meta.locations:[]});setCompensationRestricted(Boolean(d.security?.compensationRestricted))}catch(e){setError(e instanceof Error?e.message:"Помилка")}finally{setLoading(false)}}
 useEffect(()=>{void load()},[]);
 const filtered=useMemo(()=>items.filter(e=>{const assignment=primaryAssignment(e);const hay=`${e.firstName} ${e.lastName} ${e.email||""} ${e.phone||""} ${e.position||""} ${assignment?.role.name||""} ${assignment?.location?.name||""}`.toLowerCase();const statusOk=statusFilter==="all"||(statusFilter==="active"?e.isActive:!e.isActive);return(!query||hay.includes(query.toLowerCase()))&&(!category||e.personnelCategory===category)&&(!roleFilter||assignment?.role.code===roleFilter)&&statusOk}),[items,query,category,roleFilter,statusFilter]);
 const stats=useMemo(()=>({total:items.length,active:items.filter(e=>e.isActive).length,mechanics:items.filter(e=>e.isActive&&primaryAssignment(e)?.role.code==="MECHANIC").length,inactive:items.filter(e=>!e.isActive).length}),[items]);
 async function save(){if(!form)return;setError("");setSaving(true);try{const method=form.id?"PUT":"POST";const r=await fetch("/api/personnel",{method,headers:{"content-type":"application/json"},body:JSON.stringify(form)});const d=await r.json();if(!r.ok||!d.ok)throw new Error(d.error||"Не вдалося зберегти");setForm(null);await load()}catch(e){setError(e instanceof Error?e.message:"Помилка збереження")}finally{setSaving(false)}}
 async function remove(){if(!form?.id)return;if(!window.confirm("Деактивувати співробітника? Він зникне з нових призначень, але історія робіт, KPI та нарахувань збережеться."))return;const r=await fetch(`/api/personnel?id=${encodeURIComponent(form.id)}`,{method:"DELETE"});if(r.ok){setForm(null);await load()}}
 function update<K extends keyof FormState>(key:K,value:FormState[K]){setForm(f=>f?{...f,[key]:value}:f)}
 function updatePosition(value:string){setForm(current=>{if(!current)return current;const mapped=positionRole[value]||current.staffRoleCode;return{...current,position:value,staffRoleCode:mapped,personnelCategory:mapped?roleCategory[mapped]||current.personnelCategory:current.personnelCategory,locationId:mapped==="MECHANIC"?(current.locationId||meta.locations[0]?.id||""):current.locationId}})}
 function updateRole(value:string){setForm(current=>{if(!current)return current;const role=meta.roles.find(item=>item.code===value);const mechanic=value==="MECHANIC";return{...current,staffRoleCode:value,position:mechanic?"Автомеханік":current.position,personnelCategory:value?(roleCategory[value]||current.personnelCategory):current.personnelCategory,locationId:(value&&current.locationId)||(value?meta.locations[0]?.id||"":"")}})}
 function newEmployee(){setForm({...empty,documents:empty.documents.map(d=>({...d})),locationId:meta.locations[0]?.id||""})}

 if(form) return <div className={styles.editorPage}>
   <header className={styles.editorTop}>
     <div><button className={styles.backLink} onClick={()=>setForm(null)}>← Персонал</button><p className={styles.eyebrow}>{form.id?"КАРТКА СПІВРОБІТНИКА":"НОВИЙ СПІВРОБІТНИК"}</p><h1>{form.firstName||"Новий"} {form.lastName||"працівник"}</h1><span className={styles.muted}>Одна картка людини для HR, ролі, Планувальника, KPI та майбутнього розрахунку зарплати.</span></div>
     <div className={styles.topActions}><span className={`${styles.statusPill} ${form.isActive?styles.statusActive:""}`}>{form.isActive?"Активний":"Неактивний"}</span><button className={styles.secondary} onClick={()=>setForm(null)}>Закрити</button><button className={styles.save} disabled={saving} onClick={()=>void save()}>{saving?"Зберігаю…":"✓ Зберегти"}</button></div>
   </header>
   {error&&<div className={styles.error}>{error}</div>}

   <section className={styles.profileSheet}>
     <div className={styles.sectionHeading}><div><b>Основні дані</b><span>Контакти та кадрова інформація</span></div></div>
     <div className={styles.profileGrid}>
       <Field label="Ім’я *"><input value={form.firstName} onChange={e=>update("firstName",e.target.value)} placeholder="Тарас"/></Field>
       <Field label="Прізвище *"><input value={form.lastName} onChange={e=>update("lastName",e.target.value)} placeholder="Шевченко"/></Field>
       <Field label="Дата народження"><input type="date" value={form.birthDate} onChange={e=>update("birthDate",e.target.value)}/></Field>
       <Field label="E-mail"><input type="email" value={form.email} onChange={e=>update("email",e.target.value)} placeholder="name@turbolev.ua"/></Field>
       <Field label="Телефон"><div className={styles.phoneInput}><span>🇺🇦</span><input value={form.phone} onChange={e=>update("phone",e.target.value)} placeholder="+380"/></div></Field>
       <div className={styles.photoCell}><label>Фото</label><div className={styles.photoRow}><label className={styles.photoUpload}><span className={styles.photo}>{form.photoUrl?<img src={form.photoUrl} alt=""/>:initials({firstName:form.firstName,lastName:form.lastName})}</span><input type="file" accept="image/*" onChange={e=>{const file=e.target.files?.[0];if(file)update("photoUrl",URL.createObjectURL(file))}}/><b>↑</b></label></div></div>
       <Field label="Категорія персоналу"><select value={form.personnelCategory} onChange={e=>update("personnelCategory",e.target.value)}><option value="">Оберіть категорію</option>{categories.map(c=><option key={c}>{c}</option>)}</select></Field>
       <Field label="Статус"><select value={form.isActive?"1":"0"} onChange={e=>update("isActive",e.target.value==="1")}><option value="1">Активний</option><option value="0">Неактивний / звільнений</option></select></Field>
       <Field label="Місце проживання" wide><input value={form.address} onChange={e=>update("address",e.target.value)} placeholder="Місто, вулиця, будинок"/></Field>
     </div>

     <div className={styles.operationalBlock}>
       <div className={styles.sectionHeading}><div><b>Роль у Turbo LEV</b><span>Визначає KPI, економіку посади та доступність як виконавця</span></div></div>
       <div className={styles.operationalGrid}>
         <Field label="Посада"><select value={form.position} onChange={e=>updatePosition(e.target.value)}><option value="">Оберіть посаду</option>{positions.map(p=><option key={p}>{p}</option>)}</select></Field>
         <Field label="Операційна роль / KPI"><select value={form.staffRoleCode} onChange={e=>updateRole(e.target.value)}><option value="">Без операційної ролі</option>{meta.roles.map(role=><option value={role.code} key={role.code}>{role.name}</option>)}</select></Field>
         <Field label="Локація СТО"><select value={form.locationId} onChange={e=>update("locationId",e.target.value)} disabled={!form.staffRoleCode}><option value="">Уся мережа / не вказано</option>{meta.locations.map(location=><option value={location.id} key={location.id}>{location.name}</option>)}</select></Field>
       </div>
       {form.staffRoleCode==="MECHANIC"&&<div className={styles.mechanicNotice}><span>🔧</span><div><b>Це автомеханік Планувальника</b><p>Після збереження {form.firstName||"цей працівник"} автоматично з’явиться по ПІБ у новій заявці та Планувальнику на обраній локації. Окремо створювати «Механік 1/2» більше не потрібно.</p></div></div>}
     </div>

     <div className={styles.accessNotice}><span>🔐</span><div><b>CRM-доступ керується окремо</b><p>Робочий e-mail, права на модулі та дозволи налаштовуються у «Налаштування → Ролі та доступи». Кадрова картка не зберігає пароль користувача.</p></div></div>

     <div className={styles.documentsArea}>
       <div className={styles.docColumn}>{form.documents.slice(0,2).map((d,i)=><DocRow key={d.name} doc={d} onFile={file=>{const next=[...form.documents];next[i]={...next[i],status:"UPLOADED",fileUrl:file.name};update("documents",next)}}/>)}</div>
       <div className={styles.docColumn}>{form.documents.slice(2,5).map((d,j)=>{const i=j+2;return <DocRow key={d.name} doc={d} onFile={file=>{const next=[...form.documents];next[i]={...next[i],status:"UPLOADED",fileUrl:file.name};update("documents",next)}}/>})}</div>
       <div className={styles.docColumn}>{form.documents.slice(5).map((d,j)=>{const i=j+5;return <DocRow key={d.name} doc={d} onFile={file=>{const next=[...form.documents];next[i]={...next[i],status:"UPLOADED",fileUrl:file.name};update("documents",next)}}/>})}</div>
     </div>

     {!compensationRestricted&&<div className={styles.salarySection}>
       <div className={styles.salaryTitle}><div><strong>Чернетка параметрів мотивації</strong><span>Формула зарплати ще не активна; поля збережені для майбутнього налаштування</span></div></div>
       <div className={styles.salaryFormula}>
         <SalaryField label="Ставка" value={form.baseSalary} suffix="₴" onChange={v=>update("baseSalary",v)}/>
         <span className={styles.mathSign}>+</span>
         <SalaryField label="СР · сума робіт" value={form.workPercent} suffix="%" onChange={v=>update("workPercent",v)}/>
         <SalaryField label="СЗ · продаж запчастин" value={form.partsSalesPercent} suffix="%" onChange={v=>update("partsSalesPercent",v)}/>
         <SalaryField label="НЗ · маржа запчастин" value={form.partsMarginPercent} suffix="%" onChange={v=>update("partsMarginPercent",v)}/>
         <SalaryField label="ЧП · чистий прибуток" value={form.netProfitPercent} suffix="%" onChange={v=>update("netProfitPercent",v)}/>
       </div>
       <div className={styles.salaryBottom}><Field label="Мінімальна гарантована зарплата"><input type="number" value={form.minimumSalary} onChange={e=>update("minimumSalary",e.target.value)} placeholder="8000"/></Field><Field label="Примітка до правила" wide><textarea value={form.payrollRuleNote} onChange={e=>update("payrollRuleNote",e.target.value)} placeholder="Наприклад: ставка + 40% від робіт, виплата двічі на місяць"/></Field></div>
     </div>}
   </section>

   <footer className={styles.editorFooter}>{form.id&&<button className={styles.danger} onClick={()=>void remove()}>Деактивувати працівника</button>}<div className={styles.footerRight}><button className={styles.secondary} onClick={()=>setForm(null)}>Закрити</button><button className={styles.save} disabled={saving} onClick={()=>void save()}>{saving?"Зберігаю…":"✓ Зберегти"}</button></div></footer>
 </div>;

 return <div className={styles.page}>
   <header className={styles.head}><div><p className={styles.eyebrow}>TURBO LEV · HR</p><h1>Персонал</h1><span className={styles.muted}>Єдиний довідник команди: люди, посади, локації, KPI та виконавці Планувальника.</span></div><button className={styles.primary} onClick={newEmployee}>+ Додати співробітника</button></header>
   <div className={styles.stats}><Stat label="Всього" value={stats.total}/><Stat label="Активні" value={stats.active}/><Stat label="Автомеханіки" value={stats.mechanics}/><Stat label="Неактивні" value={stats.inactive}/></div>
   <div className={styles.toolbar}><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Пошук за ПІБ, телефоном, e-mail, посадою або локацією..."/><select value={roleFilter} onChange={e=>setRoleFilter(e.target.value)}><option value="">Усі ролі</option>{meta.roles.map(role=><option value={role.code} key={role.code}>{role.name}</option>)}</select><select value={category} onChange={e=>setCategory(e.target.value)}><option value="">Усі категорії</option>{categories.map(c=><option key={c}>{c}</option>)}</select><select value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}><option value="active">Активні</option><option value="all">Усі</option><option value="inactive">Неактивні</option></select></div>
   {error&&<div className={styles.error}>{error}</div>}
   {loading?<div className={styles.empty}>Завантаження персоналу…</div>:items.length===0?<div className={styles.emptyState}><div className={styles.emptyIcon}>👥</div><h3>Команду ще не додано</h3><p>Створіть першого співробітника. Якщо оберете роль «Автомеханік», він автоматично стане доступним по ПІБ у новій заявці та Планувальнику.</p><button className={styles.primary} onClick={newEmployee}>+ Додати першого співробітника</button></div>:filtered.length?<div className={styles.grid}>{filtered.map(e=>{const assignment=primaryAssignment(e);return <article className={styles.card} key={e.id}><button className={styles.identity} onClick={()=>setForm(toForm(e))}><span className={styles.avatar}>{e.photoUrl?<img src={e.photoUrl} alt=""/>:initials(e)}</span><span className={styles.identityText}><strong>{e.firstName} {e.lastName}</strong><small>{roleName(e)}</small><small>{e.phone||e.email||"Контакти не вказані"}</small></span><span className={`${styles.status} ${e.isActive?styles.active:""}`}>{e.isActive?"Активний":"Неактивний"}</span></button><div className={styles.facts}><div><span>Роль / KPI</span><b>{assignment?.role.name||"—"}</b></div><div><span>Локація</span><b>{locationName(e)}</b></div><div><span>Планувальник</span><b>{e.isActive&&assignment?.role.code==="MECHANIC"?"Автомеханік":"—"}</b></div><div><span>Документи</span><b>{e.documents.filter(d=>d.status!=="MISSING").length}/{docs.length}</b></div></div></article>})}</div>:<div className={styles.empty}>За обраними фільтрами співробітників не знайдено.</div>}
 </div>
}

function Stat({label,value}:{label:string;value:number}){return <div className={styles.stat}><span>{label}</span><b>{value}</b></div>}
function Field({label,children,wide=false}:{label:string;children:React.ReactNode;wide?:boolean}){return <div className={`${styles.field} ${wide?styles.wide:""}`}><label>{label}</label>{children}</div>}
function DocRow({doc,onFile}:{doc:EmployeeDoc;onFile:(file:File)=>void}){return <label className={`${styles.docRow} ${doc.status!=="MISSING"?styles.docReady:""}`}><input type="file" onChange={e=>{const f=e.target.files?.[0];if(f)onFile(f)}}/><span>{doc.status!=="MISSING"?"✓":"↑"}</span><b>{doc.name}</b><small>{doc.status!=="MISSING"?"Додано":"Завантажити"}</small></label>}
function SalaryField({label,value,suffix,onChange}:{label:string;value:string;suffix:string;onChange:(v:string)=>void}){return <div className={styles.salaryField}><label>{label}</label><div><input type="number" step="0.01" value={value} onChange={e=>onChange(e.target.value)}/><span>{suffix}</span></div></div>}
