import { readFile } from "node:fs/promises";

const files = {
  component: await readFile("app/vehicle-plate.tsx", "utf8"),
  art: await readFile("app/vehicle-plate-art.ts", "utf8"),
  css: await readFile("app/vehicle-plate.module.css", "utf8"),
  bridge: await readFile("app/vehicle-presentation.css", "utf8"),
  identity: await readFile("app/vehicle-identity.tsx", "utf8"),
  libraryCss: await readFile("app/vehicle-image-library-settings-panel.module.css", "utf8"),
};

const checks = [
  ["canonical plate component", files.component.includes('data-vehicle-plate="true"') && files.component.includes('data-plate-standard="turbo-lev-reference-v2"') && files.component.includes("formatVehiclePlate")],
  ["canonical sizes xs/sm/md", [".xs", ".sm", ".md"].every((token) => files.css.includes(token))],
  ["reference plate proportions", files.css.includes("4.9756097561") && files.css.includes("--plate-height") && files.art.includes("PLATE_VIEWBOX")],
  ["canonical SVG artwork", files.component.includes("plateSvgMarkup") && files.bridge.includes(">svg") && files.art.includes('data-plate-art=\"${PLATE_ART_VERSION}\"')],
  ["reference text geometry", files.art.includes('textLength=\"514\"') && files.art.includes('font-size=\"106\"') && files.art.includes('font-size:106px!important') && files.art.includes('letter-spacing=\"2\"')],
  ["uniform glyph scale", files.art.includes('lengthAdjust=\"spacing\"') && !files.art.includes('spacingAndGlyphs') && files.art.includes('xml:space=\"preserve\"')],
  ["white plate surface", files.art.includes('fill=\"#fff\"')],
  ["black plate number", files.art.includes('fill=\"#050505\"') && files.art.includes('stroke=\"#050505\"')],
  ["no legacy gradient or undersized override", !files.css.includes("height:34px") && !files.css.includes("linear-gradient") && !files.bridge.includes("linear-gradient")],
  ["shared vehicle identity", files.identity.includes("VehiclePlate as SharedVehiclePlate")],
  ["compatibility bridge uses SVG", files.bridge.includes(".turboLevVehiclePlate") && files.bridge.includes(".turboLevVehiclePlate>svg")],
  ["legacy bridge reference marker", files.bridge.includes("4.9756097561")],
  ["scoped image-library badge selector", files.libraryCss.includes(".testVehicles > span") && !files.libraryCss.includes(".testVehicles span {")],
];

const failed = checks.filter(([, ok]) => !ok).map(([name]) => name);
if (failed.length) {
  console.error(`Vehicle plate contract failed: ${failed.join(", ")}`);
  process.exit(1);
}

console.log(`Vehicle plate contract passed (${checks.length} checks).`);
