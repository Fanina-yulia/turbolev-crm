import assert from "node:assert/strict";
import {
  CRM_NAV,
  CRM_NAV_GROUPS,
  resolveCrmSection,
  sectionFromSlug,
  slugFromSection,
} from "@/app/crm-navigation";

assert.equal(CRM_NAV.find((item) => item.slug === "work-orders")?.label, "Наряди та ремонт");
assert.equal(CRM_NAV_GROUPS.find((group) => group.label === "Сервіс")?.items.some((item) => item.slug === "work-orders"), true);
assert.equal(resolveCrmSection("Комерційна пропозиція"), "Наряди та ремонт");
assert.equal(resolveCrmSection("Замовлення-наряди"), "Наряди та ремонт");
assert.equal(sectionFromSlug("work-orders"), "Наряди та ремонт");
assert.equal(slugFromSection("Комерційна пропозиція"), "work-orders");
assert.equal(slugFromSection("Наряди та ремонт"), "work-orders");

console.log("Work Orders navigation smoke: OK");
