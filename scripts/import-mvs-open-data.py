#!/usr/bin/env python3
import csv
import io
import os
import re
import sys
import tempfile
import urllib.request
import zipfile
from datetime import datetime

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

CYR_TO_LAT = str.maketrans({
    "А": "A", "В": "B", "С": "C", "Е": "E", "Н": "H", "І": "I",
    "К": "K", "М": "M", "О": "O", "Р": "P", "Т": "T", "Х": "X",
})

PLATE_KEYS = ("n_reg_new", "plate", "registration_number", "n_reg")
VIN_KEYS = ("vin", "vin_code")
BRAND_KEYS = ("brand", "make")
MODEL_KEYS = ("model",)
YEAR_KEYS = ("make_year", "year")
CAPACITY_KEYS = ("capacity", "engine_capacity", "volume")
FUEL_KEYS = ("fuel", "fuel_type")
BODY_KEYS = ("body", "body_type")
KIND_KEYS = ("kind", "vehicle_kind", "type")
WEIGHT_KEYS = ("total_weight", "gross_weight")
DATE_KEYS = ("d_reg", "registration_date")


def clip(value, size):
    value = str(value or "").strip()
    return value[:size] if value else None


def first(row, keys):
    for key in keys:
        value = row.get(key)
        if value is not None and str(value).strip():
            return str(value).strip()
    return ""


def normalize_plate(value):
    compact = re.sub(r"[^A-ZА-ЯІЇЄ0-9]", "", str(value or "").upper())
    return compact.translate(CYR_TO_LAT)[:10]


def to_int(value):
    match = re.search(r"-?\d+", str(value or ""))
    if not match:
        return None
    try:
        return int(match.group(0))
    except ValueError:
        return None


def normalize_date(value):
    text = str(value or "").strip()
    if not text:
        return None
    candidates = ("%d.%m.%Y", "%Y-%m-%d", "%d/%m/%Y", "%Y.%m.%d", "%d-%m-%Y")
    for fmt in candidates:
        try:
            return datetime.strptime(text[:10], fmt).strftime("%Y-%m-%d")
        except ValueError:
            pass
    return clip(text, 16)


def normalize_headers(fieldnames):
    return [str(x or "").replace("\ufeff", "").strip().lower() for x in fieldnames]


def detect_encoding(stream):
    pos = stream.tell()
    sample = stream.read(8192)
    stream.seek(pos)
    try:
        sample.decode("utf-8-sig")
        return "utf-8-sig"
    except UnicodeDecodeError:
        return "cp1251"


def detect_dialect(text):
    try:
        return csv.Sniffer().sniff(text, delimiters=",;\t")
    except csv.Error:
        class Semi(csv.excel):
            delimiter = ";"
        return Semi


def row_payload(row, source_year):
    plate = normalize_plate(first(row, PLATE_KEYS))
    if len(plate) < 6:
        return None
    make_year = to_int(first(row, YEAR_KEYS))
    if make_year and not (1900 <= make_year <= 2100):
        make_year = None
    capacity = to_int(first(row, CAPACITY_KEYS))
    gross = to_int(first(row, WEIGHT_KEYS))
    return (
        plate,
        clip(first(row, VIN_KEYS).upper(), 17),
        clip(first(row, BRAND_KEYS), 48),
        clip(first(row, MODEL_KEYS), 64),
        make_year,
        capacity,
        clip(first(row, FUEL_KEYS), 24),
        clip(first(row, BODY_KEYS), 40),
        clip(first(row, KIND_KEYS), 40),
        gross,
        normalize_date(first(row, DATE_KEYS)),
        source_year,
    )


def download(url, destination):
    print(f"Downloading {url}", flush=True)
    request = urllib.request.Request(url, headers={"User-Agent": "TurboLEV-CRM/1.0"})
    with urllib.request.urlopen(request, timeout=120) as response, open(destination, "wb") as out:
        while True:
            chunk = response.read(1024 * 1024)
            if not chunk:
                break
            out.write(chunk)


def import_zip(conn, year, zip_path):
    total = 0
    with zipfile.ZipFile(zip_path) as archive:
        members = [m for m in archive.infolist() if not m.is_dir() and m.filename.lower().endswith((".csv", ".txt"))]
        for member in members:
            print(f"  Reading {member.filename}", flush=True)
            with archive.open(member, "r") as binary:
                encoding = detect_encoding(binary)
                sample = binary.read(8192)
                binary.seek(0)
                sample_text = sample.decode(encoding, errors="replace")
                dialect = detect_dialect(sample_text)
                text = io.TextIOWrapper(binary, encoding=encoding, errors="replace", newline="")
                reader = csv.DictReader(text, dialect=dialect)
                if not reader.fieldnames:
                    continue
                reader.fieldnames = normalize_headers(reader.fieldnames)

                with conn.cursor().copy(
                    'COPY mvs_stage ("plateNormalized", vin, brand, model, "makeYear", "engineVolumeCm3", "fuelType", "bodyType", "vehicleKind", "grossWeightKg", "registrationDate", "sourceYear") FROM STDIN'
                ) as copy:
                    for row in reader:
                        payload = row_payload(row, year)
                        if payload:
                            copy.write_row(payload)
                            total += 1

    with conn.cursor() as cur:
        cur.execute(
            '''
            INSERT INTO "VehicleRegistryEntry" (
              "plateNormalized", vin, brand, model, "makeYear", "engineVolumeCm3", "fuelType", "bodyType", "vehicleKind", "grossWeightKg", "registrationDate", "sourceYear"
            )
            SELECT DISTINCT ON ("plateNormalized")
              "plateNormalized", vin, brand, model, "makeYear", "engineVolumeCm3", "fuelType", "bodyType", "vehicleKind", "grossWeightKg", "registrationDate", "sourceYear"
            FROM mvs_stage
            ORDER BY "plateNormalized", "registrationDate" DESC NULLS LAST
            ON CONFLICT ("plateNormalized") DO NOTHING
            '''
        )
        cur.execute("TRUNCATE mvs_stage")
    conn.commit()
    return total


def main():
    database_url = os.environ.get("DATABASE_URL", "").strip()
    if not database_url:
        print("DATABASE_URL is required", file=sys.stderr)
        return 2

    requested = os.environ.get("MVS_IMPORT_YEARS", "").strip()
    years = None
    if requested:
        years = {int(x.strip()) for x in requested.split(",") if x.strip()}

    with psycopg.connect(database_url, autocommit=False) as conn:
        with conn.cursor() as cur:
            cur.execute(
                '''
                CREATE TEMP TABLE mvs_stage (
                  "plateNormalized" VARCHAR(10), vin VARCHAR(17), brand VARCHAR(48), model VARCHAR(64),
                  "makeYear" SMALLINT, "engineVolumeCm3" INTEGER, "fuelType" VARCHAR(24),
                  "bodyType" VARCHAR(40), "vehicleKind" VARCHAR(40), "grossWeightKg" INTEGER,
                  "registrationDate" VARCHAR(16), "sourceYear" SMALLINT
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
                    rows = import_zip(conn, year, target)
                    with conn.cursor() as cur:
                        cur.execute('SELECT count(*) FROM "VehicleRegistryEntry"')
                        indexed = cur.fetchone()[0]
                    print(f"{year}: processed {rows:,} rows; compact index now {indexed:,} plates", flush=True)
                except Exception as exc:
                    conn.rollback()
                    print(f"{year}: FAILED: {exc}", file=sys.stderr, flush=True)
                finally:
                    try:
                        os.remove(target)
                    except OSError:
                        pass

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
