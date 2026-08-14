#!/usr/bin/env python3
import csv
import io
import os
import re
import sys
import tempfile
import urllib.request
import zipfile
from itertools import chain

import psycopg

RESOURCES = [
    (2026, "https://data.gov.ua/dataset/0ffd8b75-0628-48cc-952a-9302f9799ec0/resource/3f13166f-090b-499e-8e23-e9851c5a5f67/download/reestrtz2026.zip"),
    (2025, "https://data.gov.ua/dataset/0ffd8b75-0628-48cc-952a-9302f9799ec0/resource/b7e72d22-55f5-4545-87dc-94e6c8ee03ef/download/reestrtz2025.zip"),
    (2024, "https://data.gov.ua/dataset/0ffd8b75-0628-48cc-952a-9302f9799ec0/resource/c3ffecc4-bb5c-4102-b761-6dcfeb60b4fe/download/reestrtz2024.zip"),
    (2023, "https://data.gov.ua/dataset/0ffd8b75-0628-48cc-952a-9302f9799ec0/resource/c3a12388-55c2-4546-8b71-b4b7ff0d8b16/download/reestrtz2023.zip"),
    (2022, "https://data.gov.ua/dataset/0ffd8b75-0628-48cc-952a-9302f9799ec0/resource/b1bcb4a9-8e60-4a1c-91c0-00faae008816/download/reestrtz2022.zip"),
    (2021, "https://data.gov.ua/dataset/0ffd8b75-0628-48cc-952a-9302f9799ec0/resource/c5cb530d-0533-40be-b9ad-f03e06c94b10/download/tz_opendata_z01012021_po01012022.zip"),
    (2020, "https://data.gov.ua/dataset/0ffd8b75-0628-48cc-952a-9302f9799ec0/resource/ebeb92fe-424c-41d1-aacf-288e91049dc9/download/tz_opendata_z01012020_po01012021.zip"),
    (2019, "https://data.gov.ua/dataset/0ffd8b75-0628-48cc-952a-9302f9799ec0/resource/7a58e8f7-9323-47d4-a21d-19486e014eb4/download/tz_opendata_z01012019_po01012020.zip"),
    (2018, "https://data.gov.ua/dataset/0ffd8b75-0628-48cc-952a-9302f9799ec0/resource/01323740-88df-46c2-b06e-fbb58c89fe17/download/tz_opendata_z01012018_po01012019.zip"),
    (2017, "https://data.gov.ua/dataset/0ffd8b75-0628-48cc-952a-9302f9799ec0/resource/9ce32352-bd11-4324-a2b4-5addbd228b1b/download/tz_opendata_z01012017_po31122017.zip"),
    (2016, "https://data.gov.ua/dataset/0ffd8b75-0628-48cc-952a-9302f9799ec0/resource/7bdc2a1b-5399-4ab0-97e0-633e68837b04/download/tz_opendata_z01012016_po31122016.zip"),
    (2015, "https://data.gov.ua/dataset/0ffd8b75-0628-48cc-952a-9302f9799ec0/resource/09c606dc-d740-40db-96f0-e679eeca6ace/download/tz_opendata_z01012015_po31122015.zip"),
    (2014, "https://data.gov.ua/dataset/0ffd8b75-0628-48cc-952a-9302f9799ec0/resource/80a115ae-61df-4a13-8771-36c2826268df/download/tz_opendata_z01012014_po31122014.zip"),
    (2013, "https://data.gov.ua/dataset/0ffd8b75-0628-48cc-952a-9302f9799ec0/resource/86a9548b-8323-4fa2-972e-0692edf6959f/download/tz_opendata_z01012013_po31122013.zip"),
]

BATCH_SIZE = 20_000
SAMPLE_SIZE = 64 * 1024
CYR_TO_LAT = str.maketrans({
    "А": "A", "В": "B", "С": "C", "Е": "E", "Н": "H", "І": "I",
    "К": "K", "М": "M", "О": "O", "Р": "P", "Т": "T", "Х": "X",
})

ALIASES = {
    "plate": ("n_reg_new", "n_reg", "plate", "registration_number", "number", "номерний_знак", "державний_номер", "реєстраційний_номер"),
    "vin": ("vin", "vin_code", "номер_кузова", "номер_шасі"),
    "brand": ("brand", "make", "марка"),
    "model": ("model", "модель"),
    "year": ("make_year", "year", "рік_випуску", "rik_vypusku"),
    "capacity": ("capacity", "engine_capacity", "volume", "обєм_двигуна", "об_єм_двигуна"),
    "fuel": ("fuel", "fuel_type", "паливо", "тип_палива"),
    "body": ("body", "body_type", "кузов", "тип_кузова"),
    "kind": ("kind", "vehicle_kind", "type", "тип_тз", "категорія_тз"),
}


def clip(value, size):
    value = str(value or "").strip()
    return value[:size] if value else None


def normalize_header(value):
    text = str(value or "").replace("\ufeff", "").strip().lower()
    text = re.sub(r"[\s.()\-/]+", "_", text)
    return re.sub(r"_+", "_", text).strip("_")


def normalize_plate(value):
    compact = re.sub(r"[^A-ZА-ЯІЇЄ0-9]", "", str(value or "").upper())
    return compact.translate(CYR_TO_LAT)[:10]


def plate_key(plate):
    if not plate or not re.fullmatch(r"[A-Z0-9]{6,10}", plate):
        return None
    return int(plate, 36) * 16 + len(plate)


def to_int(value):
    match = re.search(r"\d+", str(value or ""))
    if not match:
        return None
    try:
        return int(match.group(0))
    except ValueError:
        return None


def encoding_score(text):
    if not text:
        return -10_000
    first_lines = text[:12000].lower()
    score = 0
    score += sum(first_lines.count(token) * 30 for token in ("n_reg", "brand", "model", "vin", "make_year", "марка", "модель"))
    score += max(first_lines.count(";"), first_lines.count(","), first_lines.count("\t"))
    score -= first_lines.count("\x00") * 20
    replacement_ratio = first_lines.count("\ufffd") / max(1, len(first_lines))
    score -= int(replacement_ratio * 10_000)
    printable = sum(1 for ch in first_lines if ch.isprintable() or ch in "\r\n\t") / max(1, len(first_lines))
    score += int(printable * 100)
    return score


def detect_encoding(stream):
    pos = stream.tell()
    sample = stream.read(SAMPLE_SIZE)
    stream.seek(pos)

    if sample.startswith(b"\xef\xbb\xbf"):
        return "utf-8-sig"
    if sample.startswith(b"\xff\xfe"):
        return "utf-16-le"
    if sample.startswith(b"\xfe\xff"):
        return "utf-16-be"

    even_nulls = sample[0::2].count(0)
    odd_nulls = sample[1::2].count(0)
    pairs = max(1, len(sample) // 2)
    if odd_nulls / pairs > 0.20 and even_nulls / pairs < 0.05:
        return "utf-16-le"
    if even_nulls / pairs > 0.20 and odd_nulls / pairs < 0.05:
        return "utf-16-be"

    candidates = ("utf-8-sig", "utf-8", "cp1251", "utf-16-le", "utf-16-be")
    ranked = []
    for encoding in candidates:
        try:
            text = sample.decode(encoding, errors="strict")
        except (UnicodeDecodeError, UnicodeError):
            continue
        ranked.append((encoding_score(text), encoding))

    if not ranked:
        return "cp1251"
    ranked.sort(reverse=True)
    return ranked[0][1]


def detect_dialect(text):
    try:
        return csv.Sniffer().sniff(text, delimiters=",;\t|")
    except csv.Error:
        delimiter = max((";", ",", "\t", "|"), key=text.count)
        class Fallback(csv.excel):
            pass
        Fallback.delimiter = delimiter
        return Fallback


def looks_like_plate(value):
    plate = normalize_plate(value)
    return bool(
        re.fullmatch(r"[A-Z]{1,3}\d{3,6}[A-Z]{0,3}", plate)
        or (6 <= len(plate) <= 10 and any(c.isdigit() for c in plate) and any(c.isalpha() for c in plate))
    )


def resolve_columns(fieldnames, sample_rows):
    fields = [normalize_header(x) for x in fieldnames]
    mapping = {}
    for target, aliases in ALIASES.items():
        mapping[target] = next((a for a in aliases if a in fields), None)

    if not mapping["plate"] and sample_rows:
        best_field = None
        best_score = 0
        for field in fields:
            score = sum(1 for row in sample_rows if looks_like_plate(row.get(field)))
            if score > best_score:
                best_field, best_score = field, score
        threshold = max(3, len(sample_rows) // 20)
        if best_score >= threshold:
            mapping["plate"] = best_field

    return mapping


def row_payload(row, columns, source_year):
    def val(name):
        key = columns.get(name)
        return row.get(key, "") if key else ""

    plate = normalize_plate(val("plate"))
    key = plate_key(plate)
    if key is None:
        return None

    make_year = to_int(val("year"))
    if make_year and not (1900 <= make_year <= 2100):
        make_year = None
    capacity = to_int(val("capacity"))
    vehicle_type_raw = " / ".join(x for x in (str(val("kind")).strip(), str(val("body")).strip()) if x)

    return (
        key,
        clip(str(val("vin")).upper(), 17),
        clip(val("brand"), 32),
        clip(val("model"), 48),
        make_year,
        capacity,
        clip(val("fuel"), 24),
        clip(vehicle_type_raw, 48),
        source_year,
    )


def flush_batch(conn, batch):
    if not batch:
        return
    rows = list(batch.values())
    with conn.cursor().copy(
        'COPY mvs_stage ("plateKey", vin, brand, model, "makeYear", "engineVolumeCm3", "fuelType", "vehicleTypeRaw", "sourceYear") FROM STDIN'
    ) as copy:
        for row in rows:
            copy.write_row(row)

    with conn.cursor() as cur:
        cur.execute(
            '''
            INSERT INTO "VehicleRegistryCompact" (
              "plateKey", vin, brand, model, "makeYear", "engineVolumeCm3", "fuelType", "vehicleTypeRaw", "sourceYear"
            )
            SELECT "plateKey", vin, brand, model, "makeYear", "engineVolumeCm3", "fuelType", "vehicleTypeRaw", "sourceYear"
            FROM mvs_stage
            ON CONFLICT ("plateKey") DO UPDATE SET
              vin = COALESCE(EXCLUDED.vin, "VehicleRegistryCompact".vin),
              brand = COALESCE(EXCLUDED.brand, "VehicleRegistryCompact".brand),
              model = COALESCE(EXCLUDED.model, "VehicleRegistryCompact".model),
              "makeYear" = COALESCE(EXCLUDED."makeYear", "VehicleRegistryCompact"."makeYear"),
              "engineVolumeCm3" = COALESCE(EXCLUDED."engineVolumeCm3", "VehicleRegistryCompact"."engineVolumeCm3"),
              "fuelType" = COALESCE(EXCLUDED."fuelType", "VehicleRegistryCompact"."fuelType"),
              "vehicleTypeRaw" = COALESCE(EXCLUDED."vehicleTypeRaw", "VehicleRegistryCompact"."vehicleTypeRaw"),
              "sourceYear" = GREATEST(EXCLUDED."sourceYear", "VehicleRegistryCompact"."sourceYear")
            WHERE EXCLUDED."sourceYear" >= "VehicleRegistryCompact"."sourceYear"
            '''
        )
        cur.execute("TRUNCATE mvs_stage")
    conn.commit()
    batch.clear()


def import_text_member(conn, year, binary, label, batch):
    encoding = detect_encoding(binary)
    sample_bytes = binary.read(SAMPLE_SIZE)
    binary.seek(0)
    sample_text = sample_bytes.decode(encoding, errors="replace")
    dialect = detect_dialect(sample_text)
    print(f"  {label}: encoding={encoding}, delimiter={repr(dialect.delimiter)}", flush=True)

    text = io.TextIOWrapper(binary, encoding=encoding, errors="replace", newline="")
    reader = csv.DictReader(text, dialect=dialect)
    if not reader.fieldnames:
        print(f"  {label}: no headers", flush=True)
        return 0

    reader.fieldnames = [normalize_header(x) for x in reader.fieldnames]
    sample_rows = []
    for _ in range(200):
        try:
            sample_rows.append(next(reader))
        except StopIteration:
            break

    columns = resolve_columns(reader.fieldnames, sample_rows)
    print(f"  {label}: columns={reader.fieldnames}", flush=True)
    print(f"  {label}: mapped={columns}", flush=True)
    if not columns.get("plate"):
        print(f"  {label}: SKIPPED - registration plate column was not detected", flush=True)
        return 0

    total = 0
    for row in chain(sample_rows, reader):
        payload = row_payload(row, columns, year)
        if not payload:
            continue
        batch[payload[0]] = payload
        total += 1
        if len(batch) >= BATCH_SIZE:
            flush_batch(conn, batch)
    return total


def is_probable_text_member(name):
    lower = name.lower()
    basename = os.path.basename(lower)
    if lower.endswith(".zip"):
        return False
    if lower.endswith((".csv", ".txt", ".tsv", ".dat")):
        return True
    if "." not in basename:
        return True
    # Some historical MVS ZIPs contain damaged/non-ASCII CSV extensions (e.g. .ßsv).
    return basename.startswith(("tz_", "reestr", "registry", "opendata"))


def import_archive(conn, year, zip_path):
    total = 0
    batch = {}
    with zipfile.ZipFile(zip_path) as archive:
        members = [m for m in archive.infolist() if not m.is_dir()]
        print(f"{year}: archive members={[m.filename for m in members]}", flush=True)
        for member in members:
            name = member.filename
            lower = name.lower()
            if lower.endswith(".zip"):
                nested_bytes = archive.read(member)
                with zipfile.ZipFile(io.BytesIO(nested_bytes)) as nested:
                    nested_members = [m for m in nested.infolist() if not m.is_dir()]
                    print(f"  nested {name}: members={[m.filename for m in nested_members]}", flush=True)
                    for inner in nested_members:
                        if is_probable_text_member(inner.filename):
                            with nested.open(inner, "r") as binary:
                                total += import_text_member(conn, year, binary, f"{name}/{inner.filename}", batch)
                continue

            if is_probable_text_member(name):
                with archive.open(member, "r") as binary:
                    total += import_text_member(conn, year, binary, name, batch)

    flush_batch(conn, batch)
    return total


def download(url, destination):
    print(f"Downloading {url}", flush=True)
    request = urllib.request.Request(url, headers={"User-Agent": "TurboLEV-CRM/2.1"})
    with urllib.request.urlopen(request, timeout=120) as response, open(destination, "wb") as out:
        while True:
            chunk = response.read(1024 * 1024)
            if not chunk:
                break
            out.write(chunk)


def main():
    database_url = os.environ.get("DATABASE_URL", "").strip()
    if not database_url:
        print("DATABASE_URL is required", file=sys.stderr)
        return 2

    requested = os.environ.get("MVS_IMPORT_YEARS", "").strip()
    years = {int(x.strip()) for x in requested.split(",") if x.strip()} if requested else None
    selected_years = [year for year, _ in RESOURCES if years is None or year in years]
    failures = []
    imported = {}

    with psycopg.connect(database_url, autocommit=False) as conn:
        with conn.cursor() as cur:
            cur.execute(
                '''
                CREATE TEMP TABLE mvs_stage (
                  "plateKey" BIGINT PRIMARY KEY,
                  vin VARCHAR(17), brand VARCHAR(32), model VARCHAR(48),
                  "makeYear" SMALLINT, "engineVolumeCm3" INTEGER,
                  "fuelType" VARCHAR(24), "vehicleTypeRaw" VARCHAR(48), "sourceYear" SMALLINT
                ) ON COMMIT PRESERVE ROWS
                '''
            )
        conn.commit()

        with tempfile.TemporaryDirectory(prefix="turbolev-mvs-") as temp_dir:
            for year, url in RESOURCES:
                if years is not None and year not in years:
                    continue
                target = os.path.join(temp_dir, f"mvs-{year}.zip")
                try:
                    download(url, target)
                    rows = import_archive(conn, year, target)
                    if rows <= 0:
                        raise RuntimeError("archive produced 0 valid vehicle rows")
                    imported[year] = rows
                    with conn.cursor() as cur:
                        cur.execute('SELECT count(*) FROM "VehicleRegistryCompact"')
                        indexed = cur.fetchone()[0]
                    print(f"{year}: processed {rows:,} valid rows; compact index now {indexed:,} plates", flush=True)
                except Exception as exc:
                    conn.rollback()
                    failures.append((year, str(exc)))
                    print(f"{year}: FAILED: {exc}", file=sys.stderr, flush=True)
                finally:
                    try:
                        os.remove(target)
                    except OSError:
                        pass

    print("\nMVS import summary", flush=True)
    for year in selected_years:
        if year in imported:
            print(f"  {year}: OK - {imported[year]:,} valid rows", flush=True)
        else:
            detail = next((message for failed_year, message in failures if failed_year == year), "not processed")
            print(f"  {year}: FAILED - {detail}", file=sys.stderr, flush=True)

    if failures or len(imported) != len(selected_years):
        print(f"Import incomplete: {len(imported)}/{len(selected_years)} requested years succeeded", file=sys.stderr, flush=True)
        return 1

    print(f"Import complete: {len(imported)}/{len(selected_years)} requested years succeeded", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
