import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const planner = readFileSync("app/planner-v2.tsx", "utf8");
const plannerCss = readFileSync("app/planner-v2.module.css", "utf8");
const day = readFileSync("app/planner-day-view.tsx", "utf8");
const dayCss = readFileSync("app/planner-day-view.module.css", "utf8");
const drawer = readFileSync("app/planner-detail-drawer.tsx", "utf8");
const drawerCss = readFileSync("app/planner-detail-drawer.module.css", "utf8");

assert.match(planner, /item\.status==="NO_SHOW"\|\|isOverdue/, "NO_SHOW must be an attention condition");
assert.match(planner, /quickFilter==="NO_SHOW"/, "planner must expose a dedicated no-show quick filter");
assert.match(planner, /daySnapshot\.noShow>0/, "zero no-show KPI must stay hidden");
assert.match(planner, /daySnapshot\.completed>0/, "zero completed KPI must stay hidden");
assert.match(plannerCss, /repeat\(auto-fit,minmax\(145px,1fr\)\)/, "planner KPIs must use compact auto-fit layout");
assert.match(plannerCss, /padding-right:clamp\(360px,30vw,430px\)/, "desktop calendar must reserve viewport drawer width");

assert.match(day, /availability\?\.slots\?\.length/, "resource utilization must prefer authoritative availability slots");
assert.match(day, /Вільно \$\{minuteLabel\(slots\[index\]\)\}–/, "resource row must show a concrete free window");
assert.match(day, /const noShow = item\.status === "NO_SHOW"/, "no-show cards must have an explicit visual state");
assert.match(dayCss, /\.eventNoShow\{/, "no-show visual contract must exist");
assert.match(day, /const visualSpan = Math\.max\(2, span\)/, "every planner card must have a minimum visual width of two 30-minute cells");
assert.equal(/eventShortVisual|eventNarrow/.test(day), false, "planner must use one canonical card layout, not separate short/narrow card designs");
assert.match(day, /gridColumn: `\$\{startIndex \+ 2\} \/ span \$\{visualSpan\}`/, "card width must follow the 30-minute grid");
assert.match(day, /zIndex: minimumVisualOverlap \? 20 \+ \(slots\.length - startIndex\)/, "a 30-minute card must stay in front when its two-cell visual minimum overlaps the next record");
assert.equal(/canResizeAppointment[\s\S]{0,160}isActualWalkIn/.test(day), false, "walk-in cards must keep resize support");
assert.match(day, /!NON_BLOCKING\.has\(item\.status\) && <>/, "active cards must expose resize handles");

assert.match(drawerCss, /height:100dvh/, "detail drawer must span the viewport height");
assert.equal(/position:sticky/.test(drawerCss), false, "wide drawer must never fall back to inline sticky mode");
assert.match(drawer, /event\.key === "Escape"/, "Escape must close the detail drawer");
assert.match(drawer, /statusNoShow/, "drawer must visibly distinguish NO_SHOW");

console.log("[planner-dispatch] utilization, attention, compact KPI and viewport drawer contracts OK");
