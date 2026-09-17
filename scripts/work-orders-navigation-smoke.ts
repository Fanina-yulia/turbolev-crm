import assert from "node:assert/strict";
import {
  CRM_NAV,
  CRM_NAV_GROUPS,
  resolveCrmSection,
  sectionFromSlug,
  slugFromSection,
} from "@/app/crm-navigation";

assert.equal(CRM_NAV.find((item) => item.slug === "work-orders")?.label, "Комерційна пропозиція");
assert.equal(CRM_NAV.find((item) => item.slug === "work-journal")?.label, "Роботи");
const serviceItems = CRM_NAV_GROUPS.find((group) => group.label === "Сервіс")?.items.map((item) => item.slug);
assert.deepEqual(serviceItems, ["diagnostics", "work-journal", "parts", "work-orders"]);
assert.equal(resolveCrmSection("Комерційна пропозиція"), "Комерційна пропозиція");
assert.equal(resolveCrmSection("Наряди та ремонт"), "Комерційна пропозиція");
assert.equal(resolveCrmSection("Замовлення-наряди"), "Комерційна пропозиція");
assert.equal(resolveCrmSection("Роботи"), "Роботи");
assert.equal(sectionFromSlug("work-orders"), "Комерційна пропозиція");
assert.equal(sectionFromSlug("work-journal"), "Роботи");
assert.equal(slugFromSection("Комерційна пропозиція"), "work-orders");
assert.equal(slugFromSection("Наряди та ремонт"), "work-orders");
assert.equal(slugFromSection("Роботи"), "work-journal");

console.log("Work Orders navigation smoke: OK");
