from pathlib import Path

p = Path('src/services/personnel-access.service.ts')
text = p.read_text()
old = '''const SYSTEM_ROLE_CODES = [
  "OWNER",
  "EXECUTIVE_DIRECTOR",
  "HEAD_OF_SALES",
  "SALES",
  "PARTS_SPECIALIST",
  "STATION_MANAGER",
  "MECHANIC",
  "ACCOUNTANT",
  "ADMINISTRATOR",
] as const;'''
new = '''const SYSTEM_ROLE_CODES = [
  "OWNER",
  "EXECUTIVE_DIRECTOR",
  "HEAD_OF_SALES",
  "SALES",
  "PARTS_SPECIALIST",
  "STATION_MANAGER",
  "SERVICE_ADVISOR",
  "SHIFT_MASTER",
  "MECHANIC",
  "ACCOUNTANT",
  "ADMINISTRATOR",
] as const;'''
if old not in text:
    raise SystemExit('SYSTEM_ROLE_CODES pattern not found')
text = text.replace(old, new, 1)
old = '''const STATION_MANAGER_DELEGATION = new Set<SystemRoleCode>([
  "MECHANIC",
  "PARTS_SPECIALIST",
  "ADMINISTRATOR",
]);'''
new = '''const STATION_MANAGER_DELEGATION = new Set<SystemRoleCode>([
  "SERVICE_ADVISOR",
  "SHIFT_MASTER",
  "MECHANIC",
  "PARTS_SPECIALIST",
  "ADMINISTRATOR",
]);'''
if old not in text:
    raise SystemExit('STATION_MANAGER_DELEGATION pattern not found')
text = text.replace(old, new, 1)
p.write_text(text)
Path('scripts/one-off-personnel-role-delegation.py').unlink(missing_ok=True)
Path('.github/workflows/one-off-personnel-role-delegation.yml').unlink(missing_ok=True)
