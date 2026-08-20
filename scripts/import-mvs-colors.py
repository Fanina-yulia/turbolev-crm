#!/usr/bin/env python3
import csv
import importlib.util
import io
import os
from pathlib import Path
import sys
import tempfile
import zipfile

import psycopg
from psycopg import sql

BASE_PATH = Path(__file__).with_name("import-mvs-open-data.py")
SPEC = importlib.util.spec_from_file_location("turbolev_mvs_importer", BASE_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("Could not load base MVS importer")
base = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(base)

COLOR_ALIASES = (
    "color",
    "colour",
    "vehicle_color",
    "body_color",
    "колір",
    "колир",
    "цвет",
)
BATCH_SIZE = 20_000


def clean_color(value):
    text = str(value or "").strip()
    if not text:
        return None
    text = " ".join(text.split())
    return text[:48]


def resolve_color_column(fieldnames):
    fields = [base.normalize_header(x) for x in fieldnames]
    return next((alias for alias in COLOR_ALIASES if alias in fields), None)


def create_stage_table(conn):
    table = f"mvs_color_stage_{os.getpid()}"
    with conn.cursor() as cur:
        cur.execute(
            sql.SQL(
                '''
                CREATE TABLE {} (
                  "plateKey" BIGINT PRIMARY KEY,
                  color VARCHAR(48),
                  "sourceYear" SMALLINT
                )
                '''
            ).format(sql.Identifier(table))
        )
    conn.commit()
    return table


def drop_stage_table(conn, table):
    try:
        conn.rollback()
    except Exception:
        pass
    try:
        with conn.cursor() as cur:
            cur.execute(sql.SQL("DROP TABLE IF EXISTS {}").format(sql.Identifier(table)))
        conn.commit()
    except Exception as exc:
        conn.rollback()
        print(f"WARNING: could not drop color staging table {table}: {exc}", file=sys.stderr, flush=True)


def ensure_color_column(conn):
    with conn.cursor() as cur:
        cur.execute('ALTER TABLE "VehicleRegistryCompact" ADD COLUMN IF NOT EXISTS color VARCHAR(48)')
    conn.commit()


def flush_batch(conn, batch, stage_table):
    if not batch:
        return 0
    rows = list(batch.values())
    copy_sql = sql.SQL(
        'COPY {} ("plateKey", color, "sourceYear") FROM STDIN'
    ).format(sql.Identifier(stage_table))
    with conn.cursor().copy(copy_sql) as copy:
        for row in rows:
            copy.write_row(row)

    with conn.cursor() as cur:
        cur.execute(
            sql.SQL(
                '''
                UPDATE "VehicleRegistryCompact" AS target
                   SET color = source.color
                  FROM {} AS source
                 WHERE target."plateKey" = source."plateKey"
                   AND target."sourceYear" = source."sourceYear"
                   AND source.color IS NOT NULL
                   AND source.color <> ''
                '''
            ).format(sql.Identifier(stage_table))
        )
        updated = cur.rowcount
        cur.execute(sql.SQL("TRUNCATE {}").format(sql.Identifier(stage_table)))
    conn.commit()
    batch.clear()
    return updated


def import_text_member(conn, year, binary, label, batch, stage_table):
    encoding = base.detect_encoding(binary)
    sample_bytes = binary.read(base.SAMPLE_SIZE)
    binary.seek(0)
    sample_text = sample_bytes.decode(encoding, errors="replace")
    dialect = base.detect_dialect(sample_text)

    text = io.TextIOWrapper(binary, encoding=encoding, errors="replace", newline="")
    reader = csv.DictReader(text, dialect=dialect)
    if not reader.fieldnames:
        return 0, 0

    reader.fieldnames = [base.normalize_header(x) for x in reader.fieldnames]
    color_column = resolve_color_column(reader.fieldnames)
    if not color_column:
        print(f"  {label}: no COLOR column; skipped", flush=True)
        return 0, 0

    plate_column = next(
        (alias for alias in base.ALIASES["plate"] if alias in reader.fieldnames),
        None,
    )
    if not plate_column:
        sample_rows = []
        for _ in range(200):
            try:
                sample_rows.append(next(reader))
            except StopIteration:
                break
        mapping = base.resolve_columns(reader.fieldnames, sample_rows)
        plate_column = mapping.get("plate")
        rows = iter(sample_rows)
    else:
        rows = iter(())

    if not plate_column:
        print(f"  {label}: no trustworthy plate column; skipped", flush=True)
        return 0, 0

    processed = 0
    updated = 0

    def accept(row):
        nonlocal processed, updated
        color = clean_color(row.get(color_column))
        if not color:
            return
        plate = base.normalize_plate(row.get(plate_column))
        key = base.plate_key(plate)
        if key is None:
            return
        batch[key] = (key, color, year)
        processed += 1
        if len(batch) >= BATCH_SIZE:
            updated += flush_batch(conn, batch, stage_table)

    for row in rows:
        accept(row)
    for row in reader:
        accept(row)

    return processed, updated


def is_text_member(name):
    return base.is_probable_text_member(name)


def import_archive(conn, year, zip_path, stage_table):
    total = 0
    updated = 0
    batch = {}
    with zipfile.ZipFile(zip_path) as archive:
        members = [m for m in archive.infolist() if not m.is_dir()]
        for member in members:
            name = member.filename
            if name.lower().endswith(".zip"):
                nested_bytes = archive.read(member)
                with zipfile.ZipFile(io.BytesIO(nested_bytes)) as nested:
                    for inner in [m for m in nested.infolist() if not m.is_dir()]:
                        if not is_text_member(inner.filename):
                            continue
                        with nested.open(inner, "r") as binary:
                            processed, changed = import_text_member(
                                conn,
                                year,
                                binary,
                                f"{name}/{inner.filename}",
                                batch,
                                stage_table,
                            )
                            total += processed
                            updated += changed
                continue

            if is_text_member(name):
                with archive.open(member, "r") as binary:
                    processed, changed = import_text_member(conn, year, binary, name, batch, stage_table)
                    total += processed
                    updated += changed

    updated += flush_batch(conn, batch, stage_table)
    return total, updated


def import_year(conn, year, primary_url, temp_dir, stage_table):
    errors = []
    for attempt, url in enumerate(base.candidate_urls(year, primary_url), start=1):
        target = os.path.join(temp_dir, f"mvs-color-{year}-{attempt}.zip")
        try:
            base.download(url, target)
            processed, updated = import_archive(conn, year, target, stage_table)
            if processed > 0:
                return processed, updated
            errors.append(f"{url}: archive produced 0 rows with color")
        except Exception as exc:
            conn.rollback()
            errors.append(f"{url}: {exc}")
            print(f"{year}: color candidate {attempt} failed: {exc}", file=sys.stderr, flush=True)
        finally:
            try:
                os.remove(target)
            except OSError:
                pass
    raise RuntimeError(" | ".join(errors[-4:]) or "all color source candidates failed")


def backfill_crm_vehicle_colors(conn):
    with conn.cursor() as cur:
        cur.execute(
            '''
            SELECT id, "plateNormalized", "plateNumber",
                   "exteriorColorName", "exteriorColorHex", "exteriorPaintCode",
                   "exteriorColorSource"::text, "exteriorColorConfirmed"
              FROM "Vehicle"
             WHERE COALESCE("plateNormalized", "plateNumber") IS NOT NULL
            '''
        )
        vehicles = cur.fetchall()

    candidates = []
    for row in vehicles:
        vehicle_id, plate_normalized, plate_number, color_name, color_hex, paint_code, source, confirmed = row
        has_user_color = source == "USER" and any((color_name, color_hex, paint_code))
        protected_confirmed = confirmed and source in ("USER", "VIN", "PROVIDER")
        if has_user_color or protected_confirmed:
            continue
        plate = base.normalize_plate(plate_normalized or plate_number)
        key = base.plate_key(plate)
        if key is not None:
            candidates.append((vehicle_id, key))

    if not candidates:
        print("CRM color backfill: no eligible vehicles", flush=True)
        return 0

    keys = list({key for _, key in candidates})
    with conn.cursor() as cur:
        cur.execute(
            '''
            SELECT "plateKey", color
              FROM "VehicleRegistryCompact"
             WHERE "plateKey" = ANY(%s)
               AND color IS NOT NULL
               AND btrim(color) <> ''
            ''',
            (keys,),
        )
        color_by_key = {int(row[0]): clean_color(row[1]) for row in cur.fetchall() if clean_color(row[1])}

    updates = [(color_by_key[key], vehicle_id) for vehicle_id, key in candidates if key in color_by_key]
    if not updates:
        print("CRM color backfill: registry has no matching colors yet", flush=True)
        return 0

    with conn.cursor() as cur:
        cur.executemany(
            '''
            UPDATE "Vehicle"
               SET "exteriorColorName"=%s,
                   "exteriorColorSource"='REGISTRY',
                   "exteriorColorConfirmed"=true,
                   "updatedAt"=CURRENT_TIMESTAMP
             WHERE id=%s
               AND NOT (
                 "exteriorColorSource"='USER'
                 AND ("exteriorColorName" IS NOT NULL OR "exteriorColorHex" IS NOT NULL OR "exteriorPaintCode" IS NOT NULL)
               )
               AND NOT (
                 "exteriorColorConfirmed"=true
                 AND "exteriorColorSource" IN ('USER','VIN','PROVIDER')
               )
            ''',
            updates,
        )
    conn.commit()
    print(f"CRM color backfill: prepared {len(updates):,} vehicle update(s)", flush=True)
    return len(updates)


def main():
    database_url = os.environ.get("DATABASE_URL", "").strip()
    if not database_url:
        print("DATABASE_URL is required", file=sys.stderr)
        return 2

    requested = os.environ.get("MVS_IMPORT_YEARS", "").strip()
    years = {int(x.strip()) for x in requested.split(",") if x.strip()} if requested else None
    selected = [(year, url) for year, url in base.RESOURCES if years is None or year in years]
    failures = []

    with psycopg.connect(database_url, autocommit=False) as conn:
        ensure_color_column(conn)
        stage_table = create_stage_table(conn)
        try:
            with tempfile.TemporaryDirectory(prefix="turbolev-mvs-colors-") as temp_dir:
                for year, url in selected:
                    try:
                        processed, updated = import_year(conn, year, url, temp_dir, stage_table)
                        print(f"{year}: color rows={processed:,}; compact rows updated={updated:,}", flush=True)
                    except Exception as exc:
                        conn.rollback()
                        failures.append((year, str(exc)))
                        print(f"{year}: COLOR IMPORT FAILED: {exc}", file=sys.stderr, flush=True)
        finally:
            drop_stage_table(conn, stage_table)

        backfill_crm_vehicle_colors(conn)

    if failures:
        print(f"Color import incomplete: {len(failures)} year(s) failed", file=sys.stderr, flush=True)
        return 1
    print(f"Color import complete for {len(selected)} year(s)", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
