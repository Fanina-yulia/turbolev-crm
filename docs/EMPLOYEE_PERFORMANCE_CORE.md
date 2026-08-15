# Turbo LEV — Employee Performance Core v1

## Purpose

One source of truth for:

- employee KPI;
- own salary by day / week / month;
- full employee cost;
- direct economic contribution;
- role break-even and ROI;
- required FTE / capacity;
- attribution of business events;
- personnel analytics without double-counting accounting profit.

Salary formulas are intentionally **not fixed in v1**. KPI measurement and economic attribution are independent from compensation rules.

## Core principle

Financial Ledger answers **what happened to money**.

Attribution Ledger answers **who did what and how that result should be attributed**.

The Attribution Ledger never replaces P&L / Cash Flow and must never multiply the same business GP across employees.

## Attribution types

### DIRECT
The employee directly created a measurable result.

Examples:
- salesperson closed an estimate;
- mechanic completed a labor line;
- parts specialist created verified procurement savings.

Only explicitly marked additive DIRECT economic values may participate in employee ROI.

### MANAGED
The employee manages a system that produced the result.

Examples:
- Head of Sales → managed Sales GP;
- Station Manager → managed Workshop GP;
- Executive Director → managed Operating Result.

MANAGED values are explanatory and are **not added again** to business GP.

### INFLUENCED
The employee affected the outcome, but the result cannot be economically assigned to that employee without double counting.

Examples:
- first lead touch;
- SMM touchpoint;
- administrator intervention;
- technical help during estimate explanation.

## Employee economics

For each employee and period:

- `Full Employee Cost` = posted payroll accruals + employer / workplace / software / tools / training / other direct employee costs;
- `Direct Contribution` = additive DIRECT attribution only;
- `Break-even %` = Direct Contribution / Full Employee Cost × 100;
- `ROI %` = (Direct Contribution − Full Employee Cost) / Full Employee Cost × 100;
- `Break-even date` = first date when cumulative additive DIRECT contribution reaches Full Employee Cost;
- `KPI Score` and `Capacity Utilization` are shown separately and do not alter accounting profit.

A negative ROI does **not** automatically mean an employee should be dismissed. Analytics must distinguish:

1. insufficient demand / low capacity utilization;
2. sufficient workload but weak performance;
3. onboarding / incomplete period;
4. support or management roles that should be evaluated through managed / risk / capacity metrics rather than fake revenue attribution.

## Capacity and required FTE

`Required FTE = verified demand / verified productive capacity per FTE`

Examples:
- sales: active leads / lead capacity per salesperson;
- mechanics: demanded norm-hours / productive norm-hours per mechanic;
- parts: PartsRequest volume / verified PartsRequest capacity;
- support: transaction/task volume / verified task capacity.

Capacity standards are effective-dated and can vary by role and service location.

## Salary

Every authenticated employee must later receive an OWN-scoped view:

- today accrued;
- current week accrued;
- selected month accrued;
- paid;
- amount due;
- detailed accrual sources.

`SalaryAccrual` is an immutable business fact after posting. Corrections are made via reversal / adjustment, not destructive deletion.

Payroll periods have lifecycle:

`OPEN → REVIEW → CLOSED`

After CLOSED, attribution or payroll corrections affect a later period through an adjustment; closed payroll is not silently rewritten.

## Role catalog v1

- OWNER
- EXECUTIVE_DIRECTOR
- HEAD_OF_SALES
- SALES
- PARTS_SPECIALIST
- STATION_MANAGER
- MECHANIC
- ACCOUNTANT
- ADMINISTRATOR

Roles are effective-dated through `EmployeeRoleAssignment`, so a person can change role or location without rewriting history.

## KPI map v1

### Mechanic
- produced norm-hours;
- utilization;
- efficiency;
- labor direct contribution;
- QC first-pass rate;
- comeback rate;
- on-time completion.

### Sales
- lead → contact;
- contact → booking;
- booking → arrival;
- estimate approval;
- sales direct contribution;
- first-contact SLA;
- LOST discipline.

### Head of Sales
- managed Sales GP vs plan;
- team lead → booking;
- booking → arrival;
- estimate approval;
- GP / sales FTE;
- team SLA;
- forecast accuracy;
- team development index.

### Parts Specialist
- PartsRequest SLA;
- first quote time;
- fit accuracy;
- return/error rate;
- parts margin quality;
- verified procurement saving;
- on-time parts availability.

### Station Manager
- post utilization;
- mechanic utilization;
- revenue/post;
- GP/post;
- cycle time;
- on-time completion;
- QC first pass;
- comeback rate.

### Accountant
- closing timeliness;
- reconciliation accuracy;
- Cash Flow completeness;
- overdue AR control;
- overdue AP control;
- financial error rate;
- forecast accuracy;
- compliance incidents.

### Executive Director
- revenue plan;
- gross profit plan;
- operating profit plan;
- gross margin;
- operating cash result;
- GP/FTE;
- capacity utilization;
- operational quality/SLA.

### Administrator
- data completeness;
- duplicate/error rate;
- task SLA;
- status discipline;
- WorkOrder document completeness;
- internal response SLA.

## Stage attribution — Sales

A client is not owned forever by one salesperson.

The system should record stage responsibility:

- lead owner → contact / qualification KPI;
- booking owner → booking and arrival KPI;
- estimate owner → estimate approval and sales direct contribution;
- relationship owner → retention context only.

When ownership is transferred, historical events remain attributed to the person who actually performed them. New events use the new owner.

## Labor attribution — Mechanics

A `WorkOrderLine` should ultimately identify the performing mechanic(s).

If one mechanic performed the work: 100% attribution.

If several mechanics performed the work: split by verified actual time when available.

Example: 70 min + 50 min = 58.33% / 41.67%.

Manual split is a fallback only and must be audited.

## Analytics hierarchy

Every metric should support drill-down:

`Company → Location → Department / Role → Employee → Business Event`

Personnel analytics reads the same KPI / attribution / payroll / economics facts; it does not maintain a parallel spreadsheet or second calculation model.

Primary personnel analytics:

- Payroll;
- Full Staff Cost;
- Payroll / Revenue;
- Payroll / GP;
- Revenue/FTE;
- GP/FTE;
- Direct Contribution/FTE;
- employee KPI / cost / contribution / ROI / capacity;
- role actual FTE / required FTE / role economics;
- employee break-even dates;
- capacity shortage / overstaffing indicators.

## Security requirement

Salary detail must **not** be exposed before authentication/RBAC is active.

Required permissions later include:

- `PAYROLL_VIEW_OWN` — every employee;
- `PAYROLL_VIEW_ALL` — owner / authorized finance / authorized executive;
- `PAYROLL_POST`;
- `PAYROLL_ADJUST`;
- `PAYROLL_CLOSE_PERIOD`;
- `EMPLOYEE_ECONOMICS_VIEW`;
- `ROLE_ECONOMICS_VIEW`.

UI hiding is not security. The API/server must enforce these permissions and scopes.

## Data models v1

- `EmployeeProfile`
- `EmployeeDocument`
- `StaffRole`
- `EmployeeRoleAssignment`
- `KpiDefinition`
- `RoleKpiRule`
- `EmployeeKpiResult`
- `PayrollPeriod`
- `SalaryAccrual`
- `SalaryPayment`
- `EmployeeCostEntry`
- `PerformanceEvent`
- `AttributionLedgerEntry`
- `EmployeeEconomicsSnapshot`
- `RoleCapacityStandard`
- `RoleEconomicsSnapshot`

## Non-negotiable invariants

1. MANAGED and INFLUENCED values never inflate accounting GP.
2. Employee ROI uses only explicitly additive DIRECT contribution.
3. Posted payroll history is corrected by reversal / adjustment, not deletion.
4. Employee records with history are deactivated, not physically deleted.
5. Closed payroll periods are frozen.
6. Every attribution correction must remain auditable.
7. Required FTE is based on observed demand and verified capacity, not management intuition alone.
8. KPI definitions are separate from salary formulas.
