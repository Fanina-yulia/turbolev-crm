import { readFile } from "node:fs/promises";

const files = {
  component: await readFile("app/vehicle-plate.tsx", "utf8"),
  css: await readFile("app/vehicle-plate.module.css", "utf8"),
  bridge: await readFile("app/vehicle-presentation.css", "utf8"),
  identity: await readFile("app/vehicle-identity.tsx", "utf8"),
  libraryCss: await readFile("app/vehicle-image-library-settings-panel.module.css", "utf8"),
};

const checks = [
  ["canonical plate component", files.component.includes('data-vehicle-plate="true"') && files.component.includes('data-plate-standard="turbo-lev-reference-v2"') && files.component.includes("formatVehiclePlate")],
  ["canonical sizes xs/sm/md", [".xs", ".sm", ".md"].every((token) => files.css.includes(token))],
  ["reference plate proportions", files.css.includes("4.98") && files.css.includes("--plate-height")],
  ["reference text scale", files.css.includes("scaleX(1.07)") && files.css.includes(".sm .number{font-size:21px}") && files.css.includes(".md .number{font-size:26px}")],
  ["white plate surface", files.css.includes("background:#fff")],
  ["black plate number", files.css.includes(".number") && files.css.includes("color:#000")],
  ["no legacy gradient or undersized override", !files.css.includes("height:34px") && !files.css.includes("linear-gradient") && !files.bridge.includes("linear-gradient")],
  ["shared vehicle identity", files.identity.includes("VehiclePlate as SharedVehiclePlate")],
  ["compatibility bridge protection", files.bridge.includes(".turboLevVehiclePlateNumber{background:#fff!important;color:#000!important")],
  ["legacy bridge reference marker", files.bridge.includes("4.98") && files.bridge.includes(".turboLevVehiclePlateBand:before")],
  ["scoped image-library badge selector", files.libraryCss.includes(".testVehicles > span") && !files.libraryCss.includes(".testVehicles span {")],
];

const failed = checks.filter(([, ok]) => !ok).map(([name]) => name);
if (failed.length) {
  console.error(`Vehicle plate contract failed: ${failed.join(", ")}`);
  process.exit(1);
}

console.log(`Vehicle plate contract passed (${checks.length} checks).`);
