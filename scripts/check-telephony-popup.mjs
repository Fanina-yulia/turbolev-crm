import fs from "node:fs";

const bridge = fs.readFileSync("app/telephony-realtime-bridge.tsx", "utf8");

if (!/call\.phase\s*===\s*["']RINGING["']\s*&&\s*!dismissed\.has\(call\.callId\)/.test(bridge)) {
  throw new Error("[telephony-popup] incoming popup must select only RINGING calls");
}

if (!/if\s*\(incoming\)[\s\S]*?setActive\(incoming\)[\s\S]*?else\s*\{[\s\S]*?setActive\(null\)/.test(bridge)) {
  throw new Error("[telephony-popup] popup must clear when the live call leaves RINGING");
}

console.log("[telephony-popup] contracts OK");
