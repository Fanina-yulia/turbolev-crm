import { readFile } from "node:fs/promises";

const files = {
  component: await readFile("app/vehicle-plate.tsx", "utf8"),
  css: await readFile("app/vehicle-plate.module.css", "utf8"),
  bridge: await readFile("app/vehicle-presentation.css", "utf8"),
  identity: await readFile("app/vehicle-identity.tsx", "utf8"),
  libraryCss: await readFile("app/vehicle-image-library-settings-panel.module.css", "utf8"),
};

const checks = [
  ["canonical plate component", files.component.includes('data-vehicle-plate="true"') && files.component.includes("formatVehiclePlate")],
  ["canonical sizes xs/sm/md", [".xs", ".sm", ".md"].every((token) => files.css.includes(token))],
  ["high-contrast plate surface", files.css.includes("background:linear-gradient(180deg,#fff,#f3f5f7)")],
  ["black plate number", files.css.includes(".number") && files.css.includes("color:#10151b")],
  ["shared vehicle identity", files.identity.includes("VehiclePlate as SharedVehiclePlate")],
  ["compatibility bridge protection", files.bridge.includes(".turboLevVehiclePlateNumber{background:#f7f8fa!important;color:#10151b!important")],
  ["scoped image-library badge selector", files.libraryCss.includes(".testVehicles > span") && !files.libraryCss.includes(".testVehicles span {")],
];

const failed = checks.filter(([, ok]) => !ok).map(([name]) => name);
if (failed.length) {
  console.error(`Vehicle plate contract failed: ${failed.join(", ")}`);
  process.exit(1);
}

console.log(`Vehicle plate contract passed (${checks.length} checks).`);
