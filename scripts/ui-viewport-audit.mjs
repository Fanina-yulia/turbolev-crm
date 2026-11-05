#!/usr/bin/env node
/**
 * CRM-UI-003 viewport audit (visual/runtime). Needs a RUNNING CRM and a logged-in Playwright session.
 *
 *   # 1) save a session of a TEST account (never a real employee account) once:
 *   #    npx playwright codegen --save-storage=auth.json https://<preview-or-localhost>
 *   # 2) run:
 *   BASE_URL=https://<preview> STORAGE_STATE=auth.json node scripts/ui-viewport-audit.mjs
 *
 * Optional: SECTIONS=overview,planner  VIEWPORTS=1920x1080,1366x768  OUT_DIR=./ui-audit
 * Output: OUT_DIR/report.md + report.json + one PNG per section/viewport. Exit code 1 if any hard failure.
 * Hard failures: horizontal page overflow; elements clipped beyond the viewport; no H1; text below the 11px floor.
 */
import fs from "node:fs";
import path from "node:path";

let chromium;
try { ({ chromium } = await import("playwright")); }
catch { console.error("Playwright is not installed (npm i -D playwright && npx playwright install chromium)."); process.exit(2); }

const BASE = (process.env.BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const OUT = process.env.OUT_DIR || "ui-audit";
const SECTIONS = (process.env.SECTIONS || "overview,tasks,communications,clients,vehicles,planner,diagnostics,work-journal,work-orders,warranties,parts,procurement,finance,payments,analytics,settings").split(",");
// CRM-UI-003 viewports (docs/CRM_RESPONSIVE_STANDARDS.md)
const VIEWPORTS = (process.env.VIEWPORTS || "1920x1080,1440x900,1366x768,1280x720,1024x768,768x1024,390x844,360x800")
  .split(",").map((v) => { const [w, h] = v.split("x").map(Number); return { w, h }; });

fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({ storageState: process.env.STORAGE_STATE || undefined });
const results = [];

async function measure(page) {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const doc = document.documentElement;
    const overflowX = Math.max(doc.scrollWidth, document.body.scrollWidth) - vw;
    const clipped = [];
    for (const el of document.querySelectorAll("body *")) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === "hidden" || cs.display === "none" || cs.position === "fixed") continue;
      // ignore content inside an intentionally horizontally scrollable ancestor
      let scroller = false;
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        const o = getComputedStyle(p).overflowX;
        if (o === "auto" || o === "scroll" || o === "hidden") { scroller = true; break; }
      }
      if (!scroller && r.right > vw + 1) clipped.push(`${el.tagName.toLowerCase()}${el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/)[0] : ""} (+${Math.round(r.right - vw)}px)`);
      if (clipped.length >= 6) break;
    }
    let tiny = 0;
    for (const el of document.querySelectorAll("body *")) {
      if (!el.childNodes.length || ![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
      const fs = parseFloat(getComputedStyle(el).fontSize);
      if (fs && fs < 11) tiny++;
    }
    return { vw, overflowX: Math.max(0, Math.round(overflowX)), clipped, h1: document.querySelectorAll("h1").length, tiny };
  });
}

for (const slug of SECTIONS) {
  for (const vp of VIEWPORTS) {
    const page = await context.newPage();
    await page.setViewportSize({ width: vp.w, height: vp.h });
    const row = { slug, viewport: `${vp.w}x${vp.h}`, ok: true, problems: [] };
    try {
      const url = slug === "overview" ? `${BASE}/` : `${BASE}/?section=${encodeURIComponent(slug)}`;
      const resp = await page.goto(url, { waitUntil: "networkidle", timeout: 45000 });
      if (!resp || resp.status() >= 400) row.problems.push(`HTTP ${resp ? resp.status() : "no response"}`);
      if (/\/auth\/sign-in/.test(page.url())) row.problems.push("redirected to sign-in (session invalid)");
      const m = await measure(page);
      if (m.overflowX > 0) row.problems.push(`horizontal page overflow ${m.overflowX}px`);
      if (m.clipped.length) row.problems.push(`elements beyond viewport: ${m.clipped.join(", ")}`);
      if (m.h1 === 0) row.problems.push("no H1 (CRM-UI-006)");
      if (m.tiny > 0) row.problems.push(`${m.tiny} text nodes below 11px floor`);
      await page.screenshot({ path: path.join(OUT, `${slug}__${vp.w}x${vp.h}.png`), fullPage: false });
    } catch (e) {
      row.problems.push(`error: ${e.message.split("\n")[0]}`);
    }
    row.ok = row.problems.length === 0;
    results.push(row);
    await page.close();
  }
}
await browser.close();

fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(results, null, 2));
const bad = results.filter((r) => !r.ok);
const md = [`# CRM viewport audit — ${new Date().toISOString()}`, `Base: ${BASE}; sections: ${SECTIONS.length}; viewports: ${VIEWPORTS.length}; checks: ${results.length}; failures: ${bad.length}`, "",
  "| Section | Viewport | Result |", "|---|---|---|",
  ...results.map((r) => `| ${r.slug} | ${r.viewport} | ${r.ok ? "OK" : r.problems.join("; ")} |`)].join("\n");
fs.writeFileSync(path.join(OUT, "report.md"), md);
console.log(md.split("\n").slice(0, 2).join("\n"));
process.exit(bad.length ? 1 : 0);
