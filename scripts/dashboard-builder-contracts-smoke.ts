import assert from "node:assert/strict";
import { sanitizeDashboardConfig } from "../src/dashboard-builder/config";
import { DASHBOARD_PRESET_ITEM_COUNT, DASHBOARD_ROLE_PRESETS } from "../src/dashboard-builder/presets";
import { DASHBOARD_WIDGET_REGISTRY, DASHBOARD_WIDGET_TYPES } from "../src/dashboard-builder/widget-registry";
import { DASHBOARD_GRID_COLUMNS } from "../src/dashboard-builder/types";

assert.equal(DASHBOARD_WIDGET_TYPES.length, 10, "P1 registry must expose exactly W01-W10");
assert.equal(DASHBOARD_PRESET_ITEM_COUNT, 14, "MVP preset catalog must stay inside the agreed 12-15 range");
assert.equal(DASHBOARD_ROLE_PRESETS.length, 4, "P1 must provide four primary role presets");

for (const definition of Object.values(DASHBOARD_WIDGET_REGISTRY)) {
  assert.ok(definition.minW > 0 && definition.minH > 0, `${definition.id}: invalid minimum size`);
  assert.ok(definition.maxW <= DASHBOARD_GRID_COLUMNS, `${definition.id}: width exceeds 12-column grid`);
  assert.ok(definition.defaultW >= definition.minW && definition.defaultW <= definition.maxW, `${definition.id}: invalid default width`);
  assert.ok(definition.defaultH >= definition.minH && definition.defaultH <= definition.maxH, `${definition.id}: invalid default height`);
}

for (const preset of DASHBOARD_ROLE_PRESETS) {
  const ids = new Set<string>();
  for (const widget of preset.config.widgets) {
    assert.ok(!ids.has(widget.instanceId), `${preset.presetId}: duplicate instanceId ${widget.instanceId}`);
    ids.add(widget.instanceId);
    assert.ok(widget.layout.x >= 0 && widget.layout.x + widget.layout.w <= DASHBOARD_GRID_COLUMNS, `${preset.presetId}: widget outside grid`);
  }
}

const advisorPreset = DASHBOARD_ROLE_PRESETS.find((item) => item.presetId === "service_advisor_v1");
assert.ok(advisorPreset);
const sanitized = sanitizeDashboardConfig(
  {
    ...advisorPreset.config,
    widgets: [
      ...advisorPreset.config.widgets,
      {
        instanceId: "forbidden-owner-widget",
        widgetType: "owner_decisions",
        layout: { x: 0, y: 0, w: 99, h: 99 },
        settings: {},
      },
    ],
  },
  {
    roleCodes: ["SERVICE_ADVISOR"],
    permissions: {
      "OVERVIEW.READ": "LOCATION",
      "WORK_ORDERS.READ": "LOCATION",
      "PLANNER.READ": "LOCATION",
      "PROCUREMENT.READ": "LOCATION",
    },
  },
  advisorPreset.presetId,
);
assert.equal(sanitized.widgets.some((widget) => widget.widgetType === "owner_decisions"), false, "server sanitizer leaked owner-only widget");

console.log("dashboard-builder contracts: ok");
