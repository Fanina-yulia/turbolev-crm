#!/usr/bin/env python3
from __future__ import annotations

import re
import sys
from pathlib import Path


def esc(value: str) -> str:
    return value.replace("'", "''")


def make_idempotent(sql: str) -> str:
    def enum_repl(match: re.Match[str]) -> str:
        name, values = match.group(1), match.group(2)
        return f'''DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = '{name}') THEN
    CREATE TYPE "{name}" AS ENUM ({values});
  END IF;
END
$migration$;'''

    sql = re.sub(r'CREATE TYPE "([^"]+)" AS ENUM \(([^;]+)\);', enum_repl, sql)
    sql = re.sub(r'CREATE TABLE "(.*?)" \(', r'CREATE TABLE IF NOT EXISTS "\1" (', sql)
    sql = re.sub(r'CREATE UNIQUE INDEX "(.*?)" ON ', r'CREATE UNIQUE INDEX IF NOT EXISTS "\1" ON ', sql)
    sql = re.sub(r'CREATE INDEX "(.*?)" ON ', r'CREATE INDEX IF NOT EXISTS "\1" ON ', sql)

    constraint_pattern = re.compile(r'ALTER TABLE "([^"]+)" ADD CONSTRAINT "([^"]+)" (.*?);', re.S)

    def constraint_repl(match: re.Match[str]) -> str:
        table, constraint, definition = match.groups()
        definition = ' '.join(definition.split())
        return f'''DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '{constraint}') THEN
    ALTER TABLE "{table}" ADD CONSTRAINT "{constraint}" {definition};
  END IF;
END
$migration$;'''

    return constraint_pattern.sub(constraint_repl, sql)


ROLES = [
    ('role-owner', 'OWNER', 'Власник', 'MANAGEMENT', 10),
    ('role-executive-director', 'EXECUTIVE_DIRECTOR', 'Виконавчий директор', 'MANAGEMENT', 20),
    ('role-head-of-sales', 'HEAD_OF_SALES', 'Керівник відділу продажів', 'SALES', 30),
    ('role-sales', 'SALES', 'Продавець', 'SALES', 40),
    ('role-parts-specialist', 'PARTS_SPECIALIST', 'Підборщик запчастин', 'PARTS', 50),
    ('role-station-manager', 'STATION_MANAGER', 'Завідувач станцією', 'SERVICE', 60),
    ('role-mechanic', 'MECHANIC', 'Автомеханік', 'SERVICE', 70),
    ('role-accountant', 'ACCOUNTANT', 'Бухгалтер', 'FINANCE', 80),
    ('role-administrator', 'ADMINISTRATOR', 'Адміністратор', 'ADMIN', 90),
]

KPI = [
    ('MECHANIC_NORM_HOURS', 'Виробіток нормо-годин', 'NORM_HOURS', 'HIGHER_BETTER', 'WORK_ORDER'),
    ('MECHANIC_UTILIZATION', 'Завантаження механіка', 'PERCENT', 'HIGHER_BETTER', 'PRODUCTION'),
    ('MECHANIC_EFFICIENCY', 'Ефективність механіка', 'PERCENT', 'HIGHER_BETTER', 'PRODUCTION'),
    ('MECHANIC_LABOR_CONTRIBUTION', 'Прямий contribution по роботах', 'UAH', 'HIGHER_BETTER', 'ATTRIBUTION'),
    ('MECHANIC_QC_FIRST_PASS', 'QC з першого разу', 'PERCENT', 'HIGHER_BETTER', 'QUALITY_CONTROL'),
    ('MECHANIC_COMEBACK_RATE', 'Повернення після ремонту', 'PERCENT', 'LOWER_BETTER', 'WARRANTY'),
    ('MECHANIC_ON_TIME', 'Виконання робіт у строк', 'PERCENT', 'HIGHER_BETTER', 'PRODUCTION'),
    ('SALES_LEAD_CONTACT', 'Lead → Contact', 'PERCENT', 'HIGHER_BETTER', 'LEADS'),
    ('SALES_CONTACT_BOOKING', 'Contact → Booking', 'PERCENT', 'HIGHER_BETTER', 'LEADS'),
    ('SALES_BOOKING_ARRIVAL', 'Booking → Arrival', 'PERCENT', 'HIGHER_BETTER', 'PLANNER'),
    ('SALES_ESTIMATE_APPROVAL', 'Погодження кошторисів', 'PERCENT', 'HIGHER_BETTER', 'ESTIMATE'),
    ('SALES_DIRECT_CONTRIBUTION', 'Прямий contribution продажів', 'UAH', 'HIGHER_BETTER', 'ATTRIBUTION'),
    ('SALES_FIRST_CONTACT_SLA', 'SLA першого контакту', 'PERCENT', 'HIGHER_BETTER', 'LEADS'),
    ('SALES_LOST_DISCIPLINE', 'Дисципліна LOST', 'PERCENT', 'HIGHER_BETTER', 'LEADS'),
    ('HOS_MANAGED_GP_PLAN', 'Managed GP відділу vs план', 'PERCENT', 'HIGHER_BETTER', 'ANALYTICS'),
    ('HOS_LEAD_BOOKING', 'Lead → Booking команди', 'PERCENT', 'HIGHER_BETTER', 'LEADS'),
    ('HOS_BOOKING_ARRIVAL', 'Booking → Arrival команди', 'PERCENT', 'HIGHER_BETTER', 'PLANNER'),
    ('HOS_ESTIMATE_APPROVAL', 'Погодження кошторисів команди', 'PERCENT', 'HIGHER_BETTER', 'ESTIMATE'),
    ('HOS_GP_PER_FTE', 'GP на одного продавця', 'UAH', 'HIGHER_BETTER', 'FINANCE'),
    ('HOS_TEAM_SLA', 'SLA команди продажів', 'PERCENT', 'HIGHER_BETTER', 'LEADS'),
    ('HOS_FORECAST_ACCURACY', 'Точність прогнозу продажів', 'PERCENT', 'HIGHER_BETTER', 'ANALYTICS'),
    ('HOS_TEAM_DEVELOPMENT', 'Індекс розвитку команди', 'PERCENT', 'HIGHER_BETTER', 'ANALYTICS'),
    ('PARTS_REQUEST_SLA', 'SLA підбору запчастин', 'PERCENT', 'HIGHER_BETTER', 'PARTS'),
    ('PARTS_FIRST_QUOTE_TIME', 'Час до першої пропозиції', 'MINUTES', 'LOWER_BETTER', 'PARTS'),
    ('PARTS_FIT_ACCURACY', 'Точність підбору', 'PERCENT', 'HIGHER_BETTER', 'PARTS'),
    ('PARTS_RETURN_RATE', 'Повернення через помилку підбору', 'PERCENT', 'LOWER_BETTER', 'PARTS'),
    ('PARTS_MARGIN_QUALITY', 'Якість маржі запчастин', 'PERCENT', 'HIGHER_BETTER', 'FINANCE'),
    ('PARTS_PROCUREMENT_SAVING', 'Підтверджена економія закупівлі', 'UAH', 'HIGHER_BETTER', 'ATTRIBUTION'),
    ('PARTS_ON_TIME_AVAILABILITY', 'Запчастини вчасно', 'PERCENT', 'HIGHER_BETTER', 'PARTS'),
    ('STATION_POST_UTILIZATION', 'Завантаження постів', 'PERCENT', 'HIGHER_BETTER', 'PRODUCTION'),
    ('STATION_MECHANIC_UTILIZATION', 'Завантаження механіків', 'PERCENT', 'HIGHER_BETTER', 'PRODUCTION'),
    ('STATION_REVENUE_PER_POST', 'Виручка на пост', 'UAH', 'HIGHER_BETTER', 'FINANCE'),
    ('STATION_GP_PER_POST', 'GP на пост', 'UAH', 'HIGHER_BETTER', 'FINANCE'),
    ('STATION_CYCLE_TIME', 'Cycle time ремонту', 'HOURS', 'LOWER_BETTER', 'WORK_ORDER'),
    ('STATION_ON_TIME', 'Замовлення завершені в строк', 'PERCENT', 'HIGHER_BETTER', 'PRODUCTION'),
    ('STATION_QC_FIRST_PASS', 'QC з першого разу по станції', 'PERCENT', 'HIGHER_BETTER', 'QUALITY_CONTROL'),
    ('STATION_COMEBACK_RATE', 'Повернення по станції', 'PERCENT', 'LOWER_BETTER', 'WARRANTY'),
    ('ACCOUNTING_CLOSING_TIMELINESS', 'Своєчасність закриття періоду', 'PERCENT', 'HIGHER_BETTER', 'FINANCE'),
    ('ACCOUNTING_RECONCILIATION_ACCURACY', 'Точність звірок', 'PERCENT', 'HIGHER_BETTER', 'FINANCE'),
    ('ACCOUNTING_CASHFLOW_COMPLETENESS', 'Повнота Cash Flow', 'PERCENT', 'HIGHER_BETTER', 'FINANCE'),
    ('ACCOUNTING_AR_OVERDUE_RATE', 'Прострочена дебіторка', 'PERCENT', 'LOWER_BETTER', 'FINANCE'),
    ('ACCOUNTING_AP_OVERDUE_RATE', 'Прострочена кредиторка', 'PERCENT', 'LOWER_BETTER', 'FINANCE'),
    ('ACCOUNTING_ERROR_RATE', 'Рівень фінансових помилок', 'PERCENT', 'LOWER_BETTER', 'FINANCE'),
    ('ACCOUNTING_FORECAST_ACCURACY', 'Точність Cash Flow forecast', 'PERCENT', 'HIGHER_BETTER', 'FINANCE'),
    ('ACCOUNTING_COMPLIANCE_INCIDENTS', 'Критичні фінансові порушення', 'COUNT', 'LOWER_BETTER', 'FINANCE'),
    ('EXEC_REVENUE_PLAN', 'Виконання плану Revenue', 'PERCENT', 'HIGHER_BETTER', 'FINANCE'),
    ('EXEC_GP_PLAN', 'Виконання плану Gross Profit', 'PERCENT', 'HIGHER_BETTER', 'FINANCE'),
    ('EXEC_OPERATING_PROFIT_PLAN', 'Виконання плану Operating Profit', 'PERCENT', 'HIGHER_BETTER', 'FINANCE'),
    ('EXEC_GROSS_MARGIN', 'Gross Margin', 'PERCENT', 'HIGHER_BETTER', 'FINANCE'),
    ('EXEC_OPERATING_CASH_PLAN', 'Виконання плану Operating Cash', 'PERCENT', 'HIGHER_BETTER', 'FINANCE'),
    ('EXEC_GP_PER_FTE', 'GP на FTE', 'UAH', 'HIGHER_BETTER', 'ANALYTICS'),
    ('EXEC_CAPACITY_UTILIZATION', 'Завантаження потужностей', 'PERCENT', 'HIGHER_BETTER', 'ANALYTICS'),
    ('EXEC_OPERATIONAL_QUALITY', 'Операційна якість / SLA', 'SCORE', 'HIGHER_BETTER', 'ANALYTICS'),
    ('ADMIN_DATA_COMPLETENESS', 'Повнота даних', 'PERCENT', 'HIGHER_BETTER', 'CRM'),
    ('ADMIN_DUPLICATE_ERROR_RATE', 'Дублікати та помилки', 'PERCENT', 'LOWER_BETTER', 'CRM'),
    ('ADMIN_TASK_SLA', 'SLA адміністративних задач', 'PERCENT', 'HIGHER_BETTER', 'CRM'),
    ('ADMIN_STATUS_DISCIPLINE', 'Дисципліна статусів', 'PERCENT', 'HIGHER_BETTER', 'CRM'),
    ('ADMIN_WORKORDER_DOCUMENT_COMPLETENESS', 'Повнота документів WorkOrder', 'PERCENT', 'HIGHER_BETTER', 'WORK_ORDER'),
    ('ADMIN_INTERNAL_RESPONSE_SLA', 'SLA внутрішньої відповіді', 'PERCENT', 'HIGHER_BETTER', 'CRM'),
]

RULES = {
    'MECHANIC': [('MECHANIC_NORM_HOURS',20),('MECHANIC_UTILIZATION',15),('MECHANIC_EFFICIENCY',15),('MECHANIC_LABOR_CONTRIBUTION',20),('MECHANIC_QC_FIRST_PASS',10),('MECHANIC_COMEBACK_RATE',10),('MECHANIC_ON_TIME',10)],
    'SALES': [('SALES_LEAD_CONTACT',10),('SALES_CONTACT_BOOKING',20),('SALES_BOOKING_ARRIVAL',15),('SALES_ESTIMATE_APPROVAL',15),('SALES_DIRECT_CONTRIBUTION',25),('SALES_FIRST_CONTACT_SLA',10),('SALES_LOST_DISCIPLINE',5)],
    'HEAD_OF_SALES': [('HOS_MANAGED_GP_PLAN',25),('HOS_LEAD_BOOKING',15),('HOS_BOOKING_ARRIVAL',10),('HOS_ESTIMATE_APPROVAL',10),('HOS_GP_PER_FTE',15),('HOS_TEAM_SLA',10),('HOS_FORECAST_ACCURACY',10),('HOS_TEAM_DEVELOPMENT',5)],
    'PARTS_SPECIALIST': [('PARTS_REQUEST_SLA',15),('PARTS_FIRST_QUOTE_TIME',10),('PARTS_FIT_ACCURACY',20),('PARTS_RETURN_RATE',15),('PARTS_MARGIN_QUALITY',15),('PARTS_PROCUREMENT_SAVING',10),('PARTS_ON_TIME_AVAILABILITY',15)],
    'STATION_MANAGER': [('STATION_POST_UTILIZATION',15),('STATION_MECHANIC_UTILIZATION',10),('STATION_REVENUE_PER_POST',15),('STATION_GP_PER_POST',20),('STATION_CYCLE_TIME',10),('STATION_ON_TIME',10),('STATION_QC_FIRST_PASS',10),('STATION_COMEBACK_RATE',10)],
    'ACCOUNTANT': [('ACCOUNTING_CLOSING_TIMELINESS',15),('ACCOUNTING_RECONCILIATION_ACCURACY',15),('ACCOUNTING_CASHFLOW_COMPLETENESS',15),('ACCOUNTING_AR_OVERDUE_RATE',15),('ACCOUNTING_AP_OVERDUE_RATE',10),('ACCOUNTING_ERROR_RATE',10),('ACCOUNTING_FORECAST_ACCURACY',10),('ACCOUNTING_COMPLIANCE_INCIDENTS',10)],
    'EXECUTIVE_DIRECTOR': [('EXEC_REVENUE_PLAN',10),('EXEC_GP_PLAN',20),('EXEC_OPERATING_PROFIT_PLAN',20),('EXEC_GROSS_MARGIN',10),('EXEC_OPERATING_CASH_PLAN',10),('EXEC_GP_PER_FTE',10),('EXEC_CAPACITY_UTILIZATION',10),('EXEC_OPERATIONAL_QUALITY',10)],
    'ADMINISTRATOR': [('ADMIN_DATA_COMPLETENESS',25),('ADMIN_DUPLICATE_ERROR_RATE',20),('ADMIN_TASK_SLA',15),('ADMIN_STATUS_DISCIPLINE',15),('ADMIN_WORKORDER_DOCUMENT_COMPLETENESS',15),('ADMIN_INTERNAL_RESPONSE_SLA',10)],
}


def seed_sql() -> str:
    role_rows = ',\n'.join(
        f"('{rid}','{code}','{esc(name)}','{category}',true,{sort},CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)"
        for rid, code, name, category, sort in ROLES
    )
    kpi_rows = ',\n'.join(
        f"('kpi-{code.lower().replace('_','-')}','{code}','{esc(name)}',NULL,'{unit}','{direction}','{source}',true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)"
        for code, name, unit, direction, source in KPI
    )
    role_ids = {code: rid for rid, code, *_ in ROLES}
    rule_rows = []
    for role_code, rules in RULES.items():
        for kpi_code, weight in rules:
            role_id = role_ids[role_code]
            kpi_id = 'kpi-' + kpi_code.lower().replace('_','-')
            rule_id = f"rkr-{role_code.lower().replace('_','-')}-{kpi_code.lower().replace('_','-')}"
            rule_rows.append(f"('{rule_id}','{role_id}','{kpi_id}',{weight:.2f},NULL,NULL,NULL,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)")
    return f'''
-- Seed agreed role/KPI catalog. KPI targets and salary formulas intentionally remain unset.
INSERT INTO "StaffRole" ("id","code","name","category","isActive","sortOrder","createdAt","updatedAt") VALUES
{role_rows}
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "KpiDefinition" ("id","code","name","description","unit","direction","dataSource","isActive","createdAt","updatedAt") VALUES
{kpi_rows}
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "RoleKpiRule" ("id","roleId","kpiDefinitionId","weight","defaultTarget","yellowThresholdPct","redThresholdPct","isCore","createdAt","updatedAt") VALUES
{','.join(rule_rows)}
ON CONFLICT ("roleId","kpiDefinitionId") DO NOTHING;
'''


def invariants_sql() -> str:
    return '''
-- Database-level invariants for attribution and KPI configuration.
DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AttributionLedgerEntry_share_range_check') THEN
    ALTER TABLE "AttributionLedgerEntry" ADD CONSTRAINT "AttributionLedgerEntry_share_range_check"
      CHECK ("share" IS NULL OR ("share" >= 0 AND "share" <= 1));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AttributionLedgerEntry_additive_direct_check') THEN
    ALTER TABLE "AttributionLedgerEntry" ADD CONSTRAINT "AttributionLedgerEntry_additive_direct_check"
      CHECK (NOT "additiveContribution" OR "attributionType" = 'DIRECT');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PayrollPeriod_date_order_check') THEN
    ALTER TABLE "PayrollPeriod" ADD CONSTRAINT "PayrollPeriod_date_order_check"
      CHECK ("periodStart" <= "periodEnd");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'RoleKpiRule_weight_range_check') THEN
    ALTER TABLE "RoleKpiRule" ADD CONSTRAINT "RoleKpiRule_weight_range_check"
      CHECK ("weight" >= 0 AND "weight" <= 100);
  END IF;
END
$migration$;
'''


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit('usage: generate-employee-performance-migration.py RAW_SQL TARGET_SQL')
    raw_path, target_path = map(Path, sys.argv[1:])
    raw = raw_path.read_text()
    target = (
        '-- Turbo LEV employee performance core v1\n'
        '-- Compatible with clean DB and production where legacy HR tables already exist.\n\n'
        + make_idempotent(raw)
        + invariants_sql()
        + seed_sql()
    )
    target_path.parent.mkdir(parents=True, exist_ok=True)
    target_path.write_text(target)
    print(f'generated {target_path} ({len(target)} chars)')


if __name__ == '__main__':
    main()
