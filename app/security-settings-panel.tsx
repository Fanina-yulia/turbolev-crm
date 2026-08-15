"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./security-settings-panel.module.css";

type Scope = "SELF"|"ASSIGNED"|"TEAM"|"LOCATION"|"ALL";
type Grant = { code:string; scope:Scope };
type Role = { code:string; name:string; description:string; sortOrder:number; isSystem?:boolean; grants:Grant[] };
type Permission = { code:string; module:string; action:string; isSensitive:boolean; label:string; moduleLabel:string };
type Catalog = {
  ok:boolean;
  available:boolean;
  reason:string|null;
  config:{ enforcementMode:"SHADOW"|"ENFORCED"; bootstrapCompleted:boolean; allowSelfRegistration:boolean };
  authConfigured:boolean;
  roles:Role[];
  permissions:Permission[];
  assignmentCount:number;
  userCount:number;
};

const SCOPE_LABELS:Record<Scope,string>={
  SELF:"Тільки своє",
  ASSIGNED:"Призначене мені",
  TEAM:"Моя команда",
  LOCATION:"Моя станція",
  ALL:"Вся мережа",
};

function moduleGroups(permissions:Permission[]){
  const groups=new Map<string,Permission[]>();
  for(const permission of permissions){
    const key=permission.moduleLabel||permission.module;
    const current=groups.get(key)||[];
    current.push(permission);groups.set(key,current);
  }
  return Array.from(groups.entries());
}

export function SecuritySettingsPanel(){
  const [catalog,setCatalog]=useState<Catalog|null>(null);
  const [error,setError]=useState("");
  const [selectedCode,setSelectedCode]=useState("");

  useEffect(()=>{
    let alive=true;
    fetch("/api/security/catalog",{cache:"no-store"})
      .then(async response=>{const body=await response.json();if(!response.ok)throw new Error(body?.error||"Не вдалося завантажити матрицю доступів");return body as Catalog;})
      .then(body=>{if(!alive)return;setCatalog(body);setSelectedCode(current=>current||body.roles[0]?.code||"");})
      .catch(err=>{if(alive)setError(err instanceof Error?err.message:"Не вдалося завантажити матрицю доступів");});
    return()=>{alive=false;};
  },[]);

  const selected=useMemo(()=>catalog?.roles.find(role=>role.code===selectedCode)||catalog?.roles[0]||null,[catalog,selectedCode]);
  const grants=useMemo(()=>new Map((selected?.grants||[]).map(item=>[item.code,item.scope] as const)),[selected]);
  const groups=useMemo(()=>moduleGroups(catalog?.permissions||[]),[catalog]);
  const cabinetCount=useMemo(()=>new Set((selected?.grants||[]).map(grant=>catalog?.permissions.find(item=>item.code===grant.code)?.moduleLabel).filter(Boolean)).size,[selected,catalog]);
  const sensitiveCount=useMemo(()=>(selected?.grants||[]).filter(grant=>catalog?.permissions.find(item=>item.code===grant.code)?.isSensitive).length,[selected,catalog]);

  if(error)return <div className={styles.empty}>{error}</div>;
  if(!catalog)return <div className={styles.loading}>Завантажую матрицю ролей та доступів…</div>;

  return <div className={styles.page}>
    <div className={styles.header}>
      <div>
        <p className={styles.eyebrow}>SECURITY / RBAC</p>
        <h2 className={styles.title}>Ролі та доступи</h2>
        <p className={styles.subtitle}>Керуємо не лише тим, хто бачить кабінет, а й тим, що працівник може робити всередині нього та який обсяг даних йому доступний.</p>
      </div>
      <div className={styles.statusRow}>
        <span className={`${styles.badge} ${catalog.config.enforcementMode==="ENFORCED"?styles.badgeDanger:styles.badgeWarn}`}>{catalog.config.enforcementMode==="ENFORCED"?"ENFORCED · доступи блокують":"SHADOW · без блокування"}</span>
        <span className={`${styles.badge} ${catalog.authConfigured?styles.badgeOk:styles.badgeWarn}`}>{catalog.authConfigured?"Auth підключений":"Auth ще не підключений"}</span>
        <span className={`${styles.badge} ${catalog.available?styles.badgeOk:styles.badgeWarn}`}>{catalog.available?"Матриця з Neon":"Планова матриця"}</span>
      </div>
    </div>

    <div className={styles.notice}>
      <span className={styles.noticeIcon}>🔐</span>
      <div><b>{catalog.available?"Матриця безпеки підготовлена":"Безпечний режим до міграції"}</b><p>{catalog.available?"Зараз показуються фактичні AccessRole та Permission з Neon. До переходу в ENFORCED система може збирати shadow-рішення без блокування користувачів.":"Security-таблиці ще не активовані в production, тому показується канонічна матриця, яка буде засіяна міграцією. Нічого в поточній CRM не блокується."}</p></div>
    </div>

    <div className={styles.stats}>
      <div className={styles.stat}><small>Системних ролей</small><strong>{catalog.roles.length}</strong></div>
      <div className={styles.stat}><small>Permission-кодів</small><strong>{catalog.permissions.length}</strong></div>
      <div className={styles.stat}><small>Активних користувачів</small><strong>{catalog.userCount}</strong></div>
      <div className={styles.stat}><small>Призначень ролей</small><strong>{catalog.assignmentCount}</strong></div>
    </div>

    <div className={styles.layout}>
      <aside className={styles.roles}>
        <div className={styles.rolesHead}><strong>Ролі доступу</strong><small>Не плутати з посадою працівника</small></div>
        {catalog.roles.map(role=><button type="button" key={role.code} className={`${styles.roleButton} ${selected?.code===role.code?styles.roleButtonActive:""}`} onClick={()=>setSelectedCode(role.code)}><b>{role.name}</b><span>{role.code}</span></button>)}
      </aside>

      <section className={styles.content}>
        {selected?<>
          <div className={styles.roleHero}>
            <div><p className={styles.eyebrow}>ACCESS ROLE</p><h3>{selected.name}</h3><p>{selected.description}</p></div>
            <div className={styles.roleHeroMeta}><strong>{selected.grants.length}</strong><small>дозволених дій · {cabinetCount} кабінетів · {sensitiveCount} чутливих</small></div>
          </div>

          {groups.map(([moduleLabel,permissions])=>{
            const enabled=permissions.filter(permission=>grants.has(permission.code)).length;
            return <div className={styles.module} key={moduleLabel}>
              <div className={styles.moduleHead}><strong>{moduleLabel}</strong><small>{enabled}/{permissions.length} дозволів</small></div>
              <div>{permissions.map(permission=>{
                const scope=grants.get(permission.code);
                return <div className={styles.permission} key={permission.code}>
                  <div className={styles.permissionName}><b>{permission.label}</b><code>{permission.code}</code></div>
                  <span className={`${styles.scope} ${!scope?styles.scopeNone:""}`}>{scope?SCOPE_LABELS[scope]:"Немає доступу"}</span>
                  <span className={`${styles.sensitive} ${permission.isSensitive?styles.sensitiveOn:""}`}>{permission.isSensitive?"Чутливий":"Звичайний"}</span>
                </div>;
              })}</div>
            </div>;
          })}
        </>:null}
      </section>
    </div>

    <div className={styles.legend}><span><b>SELF</b> — лише власні дані</span><span><b>ASSIGNED</b> — призначені об’єкти</span><span><b>TEAM</b> — команда</span><span><b>LOCATION</b> — одна станція</span><span><b>ALL</b> — вся мережа</span><span>Індивідуальний <b>DENY</b> надалі має пріоритет над роллю.</span></div>
  </div>;
}
