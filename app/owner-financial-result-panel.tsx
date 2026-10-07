"use client";

import { useCallback, useEffect, useState } from "react";
import { navigateCrm } from "./crm-route";
import styles from "./management-result-panel.module.css";
import {
  calculateOwnerProfitPlanSummary,
  findOwnerProfitPlan,
  ownerCurrentMonthBounds,
  type OwnerProfitBudget,
  type OwnerProfitPlanSummary,
} from "@/src/domain/owner-profit-plan";

type FinancePayload = {
  budgets?: OwnerProfitBudget[];
  ownerSummary?: { netIncome: number; expenseBreakdown?: { otherOperating?: number; otherExpense?: number; tax?: number } };
  ownerComparison?: { previousNetIncome: number; change: number; changePercent: number | null; drivers: Array<{ code: string; label: string; current: number; previous: number; impact: number }> };
  financeCompleteness?: { preliminaryNetProfit?: boolean; score?: number };
  settings?: { fixedMonthlyCosts?: number };
};

const money=(v:number|null|undefined)=>v==null?"—":new Intl.NumberFormat("uk-UA",{style:"currency",currency:"UAH",maximumFractionDigits:0}).format(v);
const percent=(v:number|null|undefined)=>v==null?"—":`${new Intl.NumberFormat("uk-UA",{maximumFractionDigits:1}).format(v)}%`;
const dayLabel=(v:string)=>new Intl.DateTimeFormat("uk-UA",{day:"2-digit",month:"short"}).format(new Date(`${v}T12:00:00Z`));
const status=(s:OwnerProfitPlanSummary["status"])=>({AHEAD:"Вище плану",ON_TRACK:"Йдемо за планом",AT_RISK:"Ризик невиконання",CRITICAL:"План під загрозою",NOT_STARTED:"План ще не розпочався",COMPLETED_MET:"План виконано",COMPLETED_MISSED:"План не виконано",NO_PLAN:"План не заданий"} as const)[s];

async function finance(from:string,to:string,locationId?:string|null){
  const q=new URLSearchParams({from,to}); if(locationId) q.set("locationId",locationId);
  const r=await fetch(`/api/finance/v2?${q.toString()}`,{cache:"no-store",credentials:"include"});
  const p=await r.json().catch(()=>null) as FinancePayload|null;
  if(!r.ok||!p) throw new Error("Фінансовий результат тимчасово недоступний.");
  return p;
}

export function OwnerFinancialResultPanel({locationId}:{locationId?:string|null}){
  const [summary,setSummary]=useState<OwnerProfitPlanSummary|null>(null);
  const [error,setError]=useState("");
  const load=useCallback(async()=>{
    try{
      setError("");
      const fallback=ownerCurrentMonthBounds();
      const first=await finance(fallback.start,fallback.end,locationId);
      const plan=findOwnerProfitPlan(first.budgets);
      const period=plan?{from:plan.periodStart.slice(0,10),to:plan.periodEnd.slice(0,10)}:fallback;
      const data=plan&&(period.from!==fallback.start||period.to!==fallback.end)?await finance(period.from,period.to,locationId):first;
      setSummary(calculateOwnerProfitPlanSummary({
        plan:plan||findOwnerProfitPlan(data.budgets),facts:data.ownerSummary,comparison:data.ownerComparison,
        fixedMonthlyCosts:data.settings?.fixedMonthlyCosts,preliminary:data.financeCompleteness?.preliminaryNetProfit,
        dataQualityScore:data.financeCompleteness?.score,fallbackPeriod:period
      }));
    }catch(e){setError(e instanceof Error?e.message:"Фінансовий результат тимчасово недоступний.");}
  },[locationId]);

  useEffect(()=>{
    void load(); const refresh=()=>void load(); const timer=window.setInterval(refresh,30000);
    window.addEventListener("turbolev:data-changed",refresh);window.addEventListener("focus",refresh);
    return()=>{window.clearInterval(timer);window.removeEventListener("turbolev:data-changed",refresh);window.removeEventListener("focus",refresh);};
  },[load]);

  if(!summary)return <section className={styles.panel}><div className={styles.head}><div><span className={styles.eyebrow}>ФІНАНСОВИЙ РЕЗУЛЬТАТ</span><h2>План → Факт → Прогноз</h2><small>{error||"Завантажую дані Фінансового центру…"}</small></div>{error&&<button type="button" onClick={()=>void load()}>Повторити</button>}</div></section>;

  const plan=summary.plan,route={from:summary.start,to:summary.end,...(locationId?{locationId}:{})};
  const openPlan=()=>navigateCrm("Фінансовий центр",{...route,scope:"overview"});
  const openFact=()=>navigateCrm("Фінансовий центр",{...route,scope:"pnl"});
  const tone=summary.completionPercent==null?"neutral":summary.completionPercent>=100?"good":summary.completionPercent>=85?"warning":"danger";

  return <section className={styles.panel} aria-label="План факт прогноз">
    <div className={styles.head}><div><span className={styles.eyebrow}>ЧИСТИЙ ПРИБУТОК · ЄДИНІ ДАНІ ФІНАНСОВОГО ЦЕНТРУ</span><h2>План → Факт → Прогноз</h2><small>{dayLabel(summary.start)} — {dayLabel(summary.end)} · {locationId?"СТО":"Уся мережа"} · {status(summary.status)}{summary.preliminary?" · попередній результат":""}</small></div><div className={styles.weekNav}><button type="button" onClick={openPlan}>{plan?"Змінити план →":"+ Задати план"}</button></div></div>
    <div className={styles.kpis}>
      <button type="button" onClick={openPlan}><span>План</span><strong>{money(plan?.amount)}</strong><small>{plan?"редагується тільки у Фінансах":"ще не задано"}</small></button>
      <button type="button" onClick={openFact}><span>Факт</span><strong>{money(summary.actual)}</strong><small>{summary.expectedToNow==null?"без планового темпу":`мало бути ${money(summary.expectedToNow)}`}</small></button>
      <button type="button" onClick={openPlan}><span>Прогноз</span><strong>{money(summary.paceForecast)}</strong><small>{summary.forecastGap==null?"за поточним темпом":`${summary.forecastGap>=0?"+":"−"}${money(Math.abs(summary.forecastGap))} до плану`}</small></button>
      <div><span>Виконано</span><strong>{percent(summary.completionPercent)}</strong><small>{summary.gapToPace==null?"план не задано":summary.gapToPace>=0?`випередження ${money(summary.gapToPace)}`:`відставання ${money(Math.abs(summary.gapToPace))}`}</small></div>
      <div><span>Потрібно / день</span><strong>{money(summary.requiredPerDay)}</strong><small>{summary.remainingDays} днів до завершення</small></div>
      <div className={summary.forecastGap!=null&&summary.forecastGap<0?styles.kpiGap:styles.kpiGood}><span>До плану</span><strong>{money(summary.remaining)}</strong><small>прогноз виконання {percent(summary.projectedCompletionPercent)}</small></div>
    </div>
    {plan&&<div className={styles.progressBlock}><div className={styles.progressMeta}><span>Виконання фактом</span><strong className={styles[`tone_${tone}`]}>{percent(summary.completionPercent)}</strong></div><div className={styles.track}><i className={styles[`bar_${tone}`]} style={{width:`${Math.min(100,Math.max(0,summary.completionPercent||0))}%`}}/></div></div>}
    <div className={styles.foot}><div><span>До попереднього періоду</span><b>{percent(summary.previous.changePercent)}</b></div>{summary.preliminary?<div className={styles.dataWarning}><span>Якість даних</span><b>попередній результат · повнота {summary.dataQualityScore==null?"—":`${summary.dataQualityScore}%`}</b></div>:<div className={styles.dataOk}><span>Якість даних</span><b>фінансовий факт синхронізований</b></div>}</div>
    {summary.drivers.length>0&&<div className={styles.locations}><div className={styles.subhead}><strong>Що найбільше впливає на результат</strong><button type="button" onClick={openFact}>Детальніше →</button></div>{summary.drivers.map(d=><div className={styles.locationRow} style={{gridTemplateColumns:"minmax(0,1fr) auto"}} key={d.code}><div><strong>{d.label}</strong><small>{money(d.previous)} → {money(d.current)}</small></div><span><small>Вплив</small><b>{d.impact>=0?"+":"−"}{money(Math.abs(d.impact))}</b></span></div>)}</div>}
  </section>;
}
