import assert from "node:assert/strict";
import {
  CANONICAL_ROLE_CODES,
  LEGACY_ROLE_ALIASES,
  ROLE_CABINET_BY_CODE,
  isCanonicalRoleCode,
  normalizeRoleCode,
  resolveRoleCabinet,
} from "@/src/security/role-contract";

assert.equal(CANONICAL_ROLE_CODES.length, 15);
for (const code of CANONICAL_ROLE_CODES) {
  assert.equal(isCanonicalRoleCode(code), true);
  assert.equal(normalizeRoleCode(code), code);
  assert.ok(ROLE_CABINET_BY_CODE[code]);
}

assert.equal(normalizeRoleCode("SERVICE_MANAGER"), "SERVICE_ADVISOR");
assert.equal(normalizeRoleCode("PARTS_MANAGER"), "PARTS_SPECIALIST");
assert.equal(normalizeRoleCode("QUALITY_CONTROLLER"), "STATION_MANAGER");
assert.equal(normalizeRoleCode("CASHIER_ACCOUNTING"), "ACCOUNTANT");
assert.equal(normalizeRoleCode("SHIFT_MASTER"), "MECHANIC");
assert.equal(normalizeRoleCode("unknown"), null);
assert.equal(Object.keys(LEGACY_ROLE_ALIASES).length, 6);

assert.equal(resolveRoleCabinet([{ code: "OWNER", isPrimary: true }, { code: "MECHANIC" }]), "OWNER");
assert.equal(resolveRoleCabinet([{ code: "SERVICE_MANAGER", isPrimary: true }]), "SERVICE_ADVISOR");
assert.equal(resolveRoleCabinet([{ code: "PARTS_MANAGER", isPrimary: true }]), "PARTS");
assert.equal(resolveRoleCabinet([{ code: "MECHANIC", isPrimary: true }]), "MECHANIC");
assert.equal(resolveRoleCabinet([{ code: "STATION_MANAGER", isPrimary: true }]), "STATION_MANAGER");
assert.equal(resolveRoleCabinet([{ code: "ACCOUNTANT", isPrimary: true }]), "STATION_OVERVIEW");
assert.equal(resolveRoleCabinet([]), "STATION_OVERVIEW");

console.log("Role and cabinet contract smoke: OK");
