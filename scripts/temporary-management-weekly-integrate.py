from pathlib import Path
import json

p = Path("app/owner-dashboard.tsx")
s = p.read_text()
anchor = 'import { OwnerDashboardVisual, type OwnerPeriodKey } from "./owner-dashboard-visual";\n'
if anchor not in s:
    raise SystemExit("owner import anchor missing")
if 'import { ManagementResultPanel } from "./management-result-panel";' not in s:
    s = s.replace(anchor, anchor + 'import { ManagementResultPanel } from "./management-result-panel";\n', 1)

old_trend = '''      <section className={styles.panel}>
        <div className={styles.panelHead}><div><p className="eyebrow">ТРЕНД</p><h2>Закриті КП та виручка</h2></div><button type="button" onClick={() => navigateCrm("Аналітика")}>Періоди →</button></div>
        <div className={styles.trend}>{trend.length ? trend.map((item) => <div key={item.date}><span>{dateLabel(item.date)}</span><i><b style={{ width: `${Math.max(4, (Math.abs(item.revenue || item.closed || 0) / trendMax) * 100)}%` }} /></i><strong>{item.revenue != null ? money(item.revenue) : `${item.closed} КП`}</strong></div>) : <div className={styles.empty}>Ще немає даних для тренду за період.</div>}</div>
      </section>'''
replacement = '      <ManagementResultPanel mode={isExecutive ? "EXECUTIVE" : "OWNER"} />'
if old_trend in s:
    s = s.replace(old_trend, replacement, 1)
elif replacement not in s:
    raise SystemExit("owner trend block missing")

s = s.replace('''  const trend = analytics?.trend?.slice(-10) ?? [];
  const trendMax = Math.max(1, ...trend.map((item) => Math.abs(item.revenue || item.closed || 0)));
''', '', 1)
p.write_text(s)

p = Path("app/role-cabinet.tsx")
s = p.read_text()
anchor = 'import { OwnerControlCenter } from "./owner-dashboard";\n'
if anchor not in s:
    raise SystemExit("role import anchor missing")
if 'import { ManagementResultPanel } from "./management-result-panel";' not in s:
    s = s.replace(anchor, anchor + 'import { ManagementResultPanel } from "./management-result-panel";\n', 1)

header_end = '''    </header>

    <section className={styles.managerKpis} aria-label="Ключові показники керівника станції">'''
replacement = '''    </header>

    <ManagementResultPanel mode="STATION" locationId={data.station.id} />

    <section className={styles.managerKpis} aria-label="Ключові показники керівника станції">'''
if header_end in s:
    s = s.replace(header_end, replacement, 1)
elif '<ManagementResultPanel mode="STATION" locationId={data.station.id} />' not in s:
    raise SystemExit("station insertion anchor missing")
p.write_text(s)

p = Path("package.json")
package = json.loads(p.read_text())
command = package["scripts"]["contracts:smoke"]
marker = "node --import tsx scripts/management-result-contract-smoke.ts"
if marker not in command:
    command = command.replace(
        "node --import tsx scripts/role-cabinet-contract-smoke.ts",
        "node --import tsx scripts/role-cabinet-contract-smoke.ts && " + marker,
    )
    package["scripts"]["contracts:smoke"] = command
p.write_text(json.dumps(package, ensure_ascii=False, indent=2) + "\n")
