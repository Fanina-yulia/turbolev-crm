"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./security-settings-panel.module.css";

type Scope = "SELF"|"ASSIGNED"|"TEAM"|"LOCATION"|"ALL";
type Permission = { id:string; code:string; module:string; action:string; description:string|null; isSensitive:boolean };
type RoleGrant = { code:string; scope:Scope; sensitive?:boolean };
type Role = { id:string; code:string; name:string; description:string|null; permissions:RoleGrant[] };
type UserRole = { id:string; code:string; name:string; location:{id:string;name:string}|null; isPrimary:boolean };
type UserItem = { id:string; name:string; email:string|null; authLinked:boolean; isActive:boolean; lastLoginAt:string|null; lastSeenAt:string|null; roles:UserRole[]; employee:{id:string;name:string;position:string;isActive:boolean}|null };
type Catalog = { ok:boolean; config:{enforcementMode:"SHADOW"|"ENFORCED";bootstrapCompleted:boolean;allowSelfRegistration:boolean}|null; roles:Role[]; permissions:Permission[]; users:UserItem[] };

const SCOPE_LABELS:Record<Scope,string>={SELF:"Тільки своє",ASSIGNED:"Призначене",TEAM:"Команда",LOCATION:"Станція",ALL:"Вся мережа"};
const MODULE_LABELS:Record<string,string>={OVERVIEW:"Огляд станції",COMMUNICATIONS:"Комунікації",LEADS:"Ліди",CLIENTS:"Клієнти та авто",PLANNER:"Планувальник",DIAGNOSTICS:"Діагностика",WORK_ORDERS:"Комерційна пропозиція",PRODUCTION:"Виробництво",QC:"Контроль якості",PARTS:"Підбір запчастин",PROCUREMENT:"Закупівлі",FINANCE:"Фінанси",PAYMENTS:"Оплати",PAYROLL:"Зарплата",PERSONNEL:"Персонал",WARRANTY:"Гарантії",ANALYTICS:"Аналітика",SETTINGS:"Налаштування",AUDIT:"Аудит",SECURITY:"Безпека"};

async function jsonRequest(url:string, options?:RequestInit){
  const response=await fetch(url,{cache:"no-store",...options,headers:{"Content-Type":"application/json",Accept:"application/json",...(options?.headers||{})}});
  const body=await response.json().catch(()=>null);
  if(!response.ok)throw new Error(body?.message||body?.error||`HTTP ${response.status}`);
  return body;
}

export function SecuritySettingsPanel(){
  const [catalog,setCatalog]=useState<Catalog|null>(null);
  const [view,setView]=useState<"users"|"roles">("users");
  const [selectedUserId,setSelectedUserId]=useState("");
  const [selectedRoleCode,setSelectedRoleCode]=useState("");
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");
  const [newName,setNewName]=useState("");
  const [newEmail,setNewEmail]=useState("");
  const [newRole,setNewRole]=useState("");
  const [userName,setUserName]=useState("");
  const [userEmail,setUserEmail]=useState("");
  const [userActive,setUserActive]=useState(true);
  const [userRoles,setUserRoles]=useState<string[]>([]);
  const [roleName,setRoleName]=useState("");
  const [roleDescription,setRoleDescription]=useState("");
  const [roleGrants,setRoleGrants]=useState<Record<string,Scope|undefined>>({});

  const load=useCallback(async()=>{
    try{
      const body=await jsonRequest("/api/security/access-catalog") as Catalog;
      setCatalog(body);
      setSelectedUserId(current=>current&&body.users.some(user=>user.id===current)?current:(body.users[0]?.id||""));
      setSelectedRoleCode(current=>current&&body.roles.some(role=>role.code===current)?current:(body.roles[0]?.code||""));
      setNewRole(current=>current||body.roles.find(role=>role.code==="SALES")?.code||body.roles.find(role=>role.code!=="OWNER")?.code||body.roles[0]?.code||"");
    }catch(error){setMessage(error instanceof Error?error.message:"Не вдалося завантажити доступи");}
  },[]);

  useEffect(()=>{void load();},[load]);
  const selectedUser=useMemo(()=>catalog?.users.find(user=>user.id===selectedUserId)||null,[catalog,selectedUserId]);
  const selectedRole=useMemo(()=>catalog?.roles.find(role=>role.code===selectedRoleCode)||null,[catalog,selectedRoleCode]);

  useEffect(()=>{
    if(!selectedUser)return;
    setUserName(selectedUser.name);setUserEmail(selectedUser.email||"");setUserActive(selectedUser.isActive);setUserRoles(selectedUser.roles.map(role=>role.code));
  },[selectedUser]);
  useEffect(()=>{
    if(!selectedRole)return;
    setRoleName(selectedRole.name);setRoleDescription(selectedRole.description||"");
    setRoleGrants(Object.fromEntries(selectedRole.permissions.map(grant=>[grant.code,grant.scope])));
  },[selectedRole]);

  const permissionGroups=useMemo(()=>{
    const groups=new Map<string,Permission[]>();
    for(const permission of catalog?.permissions||[]){const key=permission.module;const list=groups.get(key)||[];list.push(permission);groups.set(key,list);}
    return Array.from(groups.entries());
  },[catalog]);

  async function createUser(){
    if(!newName.trim()||!newEmail.trim()||!newRole)return setMessage("Заповніть ім’я, email і роль.");
    setBusy(true);setMessage("");
    try{
      await jsonRequest("/api/security/provision",{method:"POST",body:JSON.stringify({name:newName,email:newEmail,roles:[{roleCode:newRole,isPrimary:true}]})});
      setNewName("");setNewEmail("");setMessage("Користувача додано. Він може активувати email/password або увійти через Google.");await load();
    }catch(error){setMessage(error instanceof Error?error.message:"Не вдалося додати користувача");}finally{setBusy(false);}
  }

  async function saveUser(){
    if(!selectedUser||!userRoles.length)return setMessage("У користувача має бути хоча б одна роль.");
    setBusy(true);setMessage("");
    try{
      await jsonRequest(`/api/security/users/${selectedUser.id}`,{method:"PATCH",body:JSON.stringify({name:userName,email:userEmail,isActive:userActive})});
      await jsonRequest(`/api/security/users/${selectedUser.id}/roles`,{method:"PUT",body:JSON.stringify({roles:userRoles.map((code,index)=>{const existing=selectedUser.roles.find(role=>role.code===code);return{roleCode:code,locationId:existing?.location?.id||null,isPrimary:index===0?true:Boolean(existing?.isPrimary)};})})});
      setMessage("Користувача та його ролі збережено.");await load();
    }catch(error){setMessage(error instanceof Error?error.message:"Не вдалося зберегти користувача");}finally{setBusy(false);}
  }

  async function toggleUserActive(){
    if(!selectedUser)return;
    setBusy(true);setMessage("");
    try{
      await jsonRequest(`/api/security/users/${selectedUser.id}`,{method:"PATCH",body:JSON.stringify({name:userName,email:userEmail,isActive:!selectedUser.isActive})});
      setMessage(selectedUser.isActive?"Доступ користувача видалено. Історію аудиту збережено.":"Доступ користувача відновлено.");await load();
    }catch(error){setMessage(error instanceof Error?error.message:"Не вдалося змінити статус");}finally{setBusy(false);}
  }

  function toggleUserRole(code:string){setUserRoles(current=>current.includes(code)?current.filter(item=>item!==code):[...current,code]);}
  function togglePermission(code:string){
    if(selectedRole?.code==="OWNER"&&code==="SECURITY.ACCESS_MANAGE")return;
    setRoleGrants(current=>({...current,[code]:current[code]?undefined:"ALL"}));
  }

  async function saveRole(){
    if(!selectedRole)return;
    setBusy(true);setMessage("");
    try{
      const grants=Object.entries(roleGrants).filter((entry):entry is [string,Scope]=>Boolean(entry[1])).map(([code,scope])=>({code,scope}));
      await jsonRequest(`/api/security/roles/${selectedRole.code}`,{method:"PATCH",body:JSON.stringify({name:roleName,description:roleDescription,grants})});
      setMessage(`Роль «${roleName}» оновлено.`);await load();
    }catch(error){setMessage(error instanceof Error?error.message:"Не вдалося оновити роль");}finally{setBusy(false);}
  }

  if(!catalog)return <div className={styles.loading}>{message||"Завантажую ролі та доступи…"}</div>;
  const ownerCount=catalog.users.filter(user=>user.isActive&&user.roles.some(role=>role.code==="OWNER")).length;

  return <div className={styles.page}>
    <div className={styles.header}>
      <div><p className={styles.eyebrow}>SECURITY / RBAC</p><h2 className={styles.title}>Ролі, люди та доступи</h2><p className={styles.subtitle}>Тут власник керує тим, хто може входити в CRM, які ролі має людина, які модулі та дії доступні кожній ролі, і до якого обсягу даних вона допускається.</p></div>
      <div className={styles.statusRow}><span className={`${styles.badge} ${catalog.config?.enforcementMode==="ENFORCED"?styles.badgeDanger:styles.badgeWarn}`}>{catalog.config?.enforcementMode||"SHADOW"}</span><span className={`${styles.badge} ${styles.badgeOk}`}>{catalog.users.filter(user=>user.isActive).length} активних</span><span className={styles.badge}>{ownerCount} OWNER</span></div>
    </div>

    <div className={styles.switcher}><button className={view==="users"?styles.switchActive:""} onClick={()=>setView("users")}>Люди та пошти</button><button className={view==="roles"?styles.switchActive:""} onClick={()=>setView("roles")}>Ролі та дозволи</button></div>
    {message?<div className={styles.notice}><span>ℹ</span><div>{message}</div></div>:null}

    {view==="users"?<>
      <section className={styles.createCard}><div><p className={styles.eyebrow}>НОВИЙ ДОСТУП</p><h3>Додати людину</h3><p>Спочатку створюємо профіль у CRM. Потім людина активує цей email через Google або email/password.</p></div><div className={styles.createFields}><input placeholder="Ім’я" value={newName} onChange={event=>setNewName(event.target.value)}/><input type="email" placeholder="email@company.com" value={newEmail} onChange={event=>setNewEmail(event.target.value)}/><select value={newRole} onChange={event=>setNewRole(event.target.value)}>{catalog.roles.map(role=><option key={role.code} value={role.code}>{role.name}</option>)}</select><button disabled={busy} onClick={createUser}>+ Додати</button></div></section>

      <div className={styles.managementGrid}>
        <aside className={styles.listPanel}><div className={styles.rolesHead}><strong>Користувачі</strong><small>активні й деактивовані</small></div>{catalog.users.map(user=><button key={user.id} className={`${styles.userButton} ${selectedUserId===user.id?styles.userButtonActive:""}`} onClick={()=>setSelectedUserId(user.id)}><b>{user.name}</b><span>{user.email||"без email"}</span><small>{user.roles.map(role=>role.name).join(" · ")||"без ролі"}</small><i>{user.isActive?"активний":"доступ видалено"} · {user.authLinked?"Auth прив’язаний":"очікує активації"}</i></button>)}</aside>
        <main className={styles.editor}>{selectedUser?<>
          <div className={styles.editorHead}><div><p className={styles.eyebrow}>КОРИСТУВАЧ</p><h3>{selectedUser.name}</h3></div><div className={styles.statusRow}><span className={`${styles.badge} ${selectedUser.isActive?styles.badgeOk:styles.badgeDanger}`}>{selectedUser.isActive?"Активний":"Деактивований"}</span><span className={styles.badge}>{selectedUser.authLinked?"Auth linked":"Не активований"}</span></div></div>
          <div className={styles.formGrid}><label><span>Ім’я</span><input value={userName} onChange={event=>setUserName(event.target.value)}/></label><label><span>Email для входу</span><input type="email" value={userEmail} onChange={event=>setUserEmail(event.target.value)}/></label></div>
          {selectedUser.authLinked&&userEmail.trim().toLowerCase()!==(selectedUser.email||"").toLowerCase()?<div className={styles.warning}>Зміна email відв’яже поточний Auth-акаунт. Новий підтверджений email прив’яжеться при наступному вході.</div>:null}
          <div className={styles.sectionTitle}><strong>Ролі користувача</strong><small>можна призначити декілька ролей</small></div><div className={styles.roleChecks}>{catalog.roles.map(role=><label key={role.code} className={userRoles.includes(role.code)?styles.checkActive:""}><input type="checkbox" checked={userRoles.includes(role.code)} onChange={()=>toggleUserRole(role.code)}/><span><b>{role.name}</b><small>{role.code}</small></span></label>)}</div>
          <div className={styles.actions}><button disabled={busy} onClick={saveUser}>Зберегти користувача</button><button className={selectedUser.isActive?styles.dangerButton:""} disabled={busy||Boolean(selectedUser.isActive&&selectedUser.roles.some(role=>role.code==="OWNER")&&ownerCount<=1)} onClick={toggleUserActive}>{selectedUser.isActive?"Видалити доступ":"Відновити доступ"}</button></div>
          <p className={styles.footnote}>«Видалити доступ» деактивує людину, але не стирає її з журналу аудиту та історії операцій.</p>
        </>:<div className={styles.empty}>Оберіть користувача.</div>}</main>
      </div>
    </>:null}

    {view==="roles"?<div className={styles.managementGrid}>
      <aside className={styles.listPanel}><div className={styles.rolesHead}><strong>Ролі</strong><small>кабінети, дії та scope</small></div>{catalog.roles.map(role=><button key={role.code} className={`${styles.userButton} ${selectedRoleCode===role.code?styles.userButtonActive:""}`} onClick={()=>setSelectedRoleCode(role.code)}><b>{role.name}</b><span>{role.code}</span><small>{role.permissions.length} дозволів</small></button>)}</aside>
      <main className={styles.editor}>{selectedRole?<>
        <div className={styles.editorHead}><div><p className={styles.eyebrow}>ACCESS ROLE</p><h3>{selectedRole.name}</h3></div><span className={styles.badge}>{Object.values(roleGrants).filter(Boolean).length} дозволів</span></div>
        <div className={styles.formGrid}><label><span>Назва ролі</span><input value={roleName} onChange={event=>setRoleName(event.target.value)}/></label><label><span>Опис</span><input value={roleDescription} onChange={event=>setRoleDescription(event.target.value)}/></label></div>
        {selectedRole.code==="OWNER"?<div className={styles.warning}>OWNER можна налаштовувати, але право керування безпекою не можна прибрати — це захист від блокування всієї CRM.</div>:null}
        <div className={styles.permissionModules}>{permissionGroups.map(([module,permissions])=><section className={styles.module} key={module}><div className={styles.moduleHead}><strong>{MODULE_LABELS[module]||module}</strong><small>{permissions.filter(permission=>roleGrants[permission.code]).length}/{permissions.length}</small></div>{permissions.map(permission=>{const scope=roleGrants[permission.code];const locked=selectedRole.code==="OWNER"&&permission.code==="SECURITY.ACCESS_MANAGE";return <div className={styles.permissionEdit} key={permission.code}><label><input type="checkbox" checked={Boolean(scope)} disabled={locked} onChange={()=>togglePermission(permission.code)}/><span><b>{permission.description||permission.code}</b><code>{permission.code}</code></span></label><select disabled={!scope} value={scope||"ALL"} onChange={event=>setRoleGrants(current=>({...current,[permission.code]:event.target.value as Scope}))}>{Object.entries(SCOPE_LABELS).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select><i>{permission.isSensitive?"Чутливий":""}</i></div>})}</section>)}</div>
        <div className={styles.actions}><button disabled={busy} onClick={saveRole}>Зберегти роль і дозволи</button></div>
      </>:null}</main>
    </div>:null}
  </div>;
}
