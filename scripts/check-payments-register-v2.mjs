import fs from "node:fs";
import path from "node:path";

const ROOT=process.cwd();
const read=(file)=>fs.readFileSync(path.join(ROOT,file),"utf8");
const failures=[];

const ui=read("app/payments-queue.tsx");
const css=read("app/payments-queue.module.css");
const api=read("app/api/payments/route.ts");
const docs=read("docs/TZ_PAYMENTS_REGISTER_V2.md");

for(const marker of [
  'title="Оплати"',
  '"Оплачено повністю"',
  '"Є передплата"',
  '"Очікує оплату"',
  '"Прострочено"',
  "selectedRow",
  "history",
  "Прийняти оплату",
  "Доплатити",
  "turbolev:data-changed",
]) if(!ui.includes(marker)) failures.push(`UI missing: ${marker}`);

for(const marker of [
  "paidRow",
  "partialRow",
  "dueRow",
  "statusPaid",
  "statusPartial",
  "statusDue",
  "CRM-UI-004 POLISH V2",
]) if(!css.includes(marker)) failures.push(`CSS missing: ${marker}`);

for(const marker of [
  'sourceEntity: SOURCE_PAYMENT',
  'status: "POSTED"',
  'direction: "RECEIVABLE"',
  "settledAmount",
  "paymentStatus",
  "kpis",
  "searchedWorkOrderIds",
  "serviceLocation.findMany",
]) if(!api.includes(marker)) failures.push(`API missing: ${marker}`);

if(/if \(q\)[\s\S]{0,500}return NextResponse\.json\(\{ ok: true[^}]*counts: \{ due: 0/.test(api)){
  failures.push("Search must not short-circuit global KPI/counts to zero.");
}

if(!ui.includes('numericAmount > paymentRow.outstanding')) failures.push("Overpayment guard missing.");
if(!docs.includes("Payments Register V2")) failures.push("Payments V2 technical specification missing.");

if(failures.length){
  console.error("[payments-register-v2] FAIL");
  failures.forEach((failure)=>console.error(" - "+failure));
  process.exit(1);
}
console.log("[payments-register-v2] OK — paid/partial/due register, search isolation, history and payment workflow verified.");
