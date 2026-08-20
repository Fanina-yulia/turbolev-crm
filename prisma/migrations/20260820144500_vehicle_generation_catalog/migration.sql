-- SQL-managed vehicle popularity + generation reference used by the image library.
-- The large MVS registry remains external to Prisma; this catalog stores only a compact top-model snapshot.

CREATE TABLE IF NOT EXISTS public."VehicleModelPopularity" (
  "id" TEXT PRIMARY KEY,
  "rank" INTEGER NOT NULL,
  "make" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "normalizedMake" TEXT NOT NULL,
  "normalizedModel" TEXT NOT NULL,
  "vehicleCount" BIGINT NOT NULL,
  "coveragePct" NUMERIC(8,4) NOT NULL DEFAULT 0,
  "firstReliableYear" SMALLINT,
  "lastReliableYear" SMALLINT,
  "topYears" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "sourceTotalRows" BIGINT NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "refreshedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "VehicleModelPopularity_normalized_unique"
  ON public."VehicleModelPopularity" ("normalizedMake", "normalizedModel");
CREATE UNIQUE INDEX IF NOT EXISTS "VehicleModelPopularity_rank_unique"
  ON public."VehicleModelPopularity" ("rank") WHERE "status"='ACTIVE';
CREATE INDEX IF NOT EXISTS "VehicleModelPopularity_count_idx"
  ON public."VehicleModelPopularity" ("vehicleCount" DESC);

CREATE TABLE IF NOT EXISTS public."VehicleGenerationReference" (
  "id" TEXT PRIMARY KEY,
  "make" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "normalizedMake" TEXT NOT NULL,
  "normalizedModel" TEXT NOT NULL,
  "generationCode" TEXT NOT NULL,
  "generationLabel" TEXT NOT NULL,
  "fromYear" SMALLINT NOT NULL,
  "toYear" SMALLINT NOT NULL,
  "confidence" INTEGER NOT NULL DEFAULT 90,
  "verificationStatus" TEXT NOT NULL DEFAULT 'CURATED',
  "sourceLabel" TEXT,
  "sourceUrl" TEXT,
  "notes" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
  "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VehicleGenerationReference_years_check" CHECK ("fromYear" <= "toYear"),
  CONSTRAINT "VehicleGenerationReference_confidence_check" CHECK ("confidence" BETWEEN 0 AND 100)
);

CREATE UNIQUE INDEX IF NOT EXISTS "VehicleGenerationReference_identity_unique"
  ON public."VehicleGenerationReference" ("normalizedMake", "normalizedModel", "generationCode", "fromYear", "toYear");
CREATE INDEX IF NOT EXISTS "VehicleGenerationReference_resolve_idx"
  ON public."VehicleGenerationReference" ("normalizedMake", "normalizedModel", "fromYear", "toYear")
  WHERE "isActive"=TRUE;
CREATE INDEX IF NOT EXISTS "VehicleGenerationReference_status_idx"
  ON public."VehicleGenerationReference" ("verificationStatus", "confidence" DESC);

-- Curated high-volume generation boundaries. Overlap is intentional on transition years:
-- the resolver treats multiple matches as ambiguous and safely falls back to model-year identity.
INSERT INTO public."VehicleGenerationReference"
  ("id","make","model","normalizedMake","normalizedModel","generationCode","generationLabel","fromYear","toYear","confidence","verificationStatus","sourceLabel","notes")
VALUES
  ('gen:volkswagen:passat:b2','VOLKSWAGEN','PASSAT','volkswagen','passat','B2','Passat B2',1981,1988,90,'CURATED','TurboLEV curated v1','Transition years intentionally overlap when production/model-year boundaries vary by market.'),
  ('gen:volkswagen:passat:b3','VOLKSWAGEN','PASSAT','volkswagen','passat','B3','Passat B3',1988,1993,90,'CURATED','TurboLEV curated v1',NULL),
  ('gen:volkswagen:passat:b4','VOLKSWAGEN','PASSAT','volkswagen','passat','B4','Passat B4',1993,1997,90,'CURATED','TurboLEV curated v1',NULL),
  ('gen:volkswagen:passat:b5','VOLKSWAGEN','PASSAT','volkswagen','passat','B5','Passat B5',1996,2005,92,'CURATED','TurboLEV curated v1',NULL),
  ('gen:volkswagen:passat:b6','VOLKSWAGEN','PASSAT','volkswagen','passat','B6','Passat B6',2005,2010,94,'CURATED','TurboLEV curated v1',NULL),
  ('gen:volkswagen:passat:b7','VOLKSWAGEN','PASSAT','volkswagen','passat','B7','Passat B7',2010,2015,94,'CURATED','TurboLEV curated v1',NULL),
  ('gen:volkswagen:passat:b8','VOLKSWAGEN','PASSAT','volkswagen','passat','B8','Passat B8',2014,2023,94,'CURATED','TurboLEV curated v1',NULL),
  ('gen:volkswagen:passat:b9','VOLKSWAGEN','PASSAT','volkswagen','passat','B9','Passat B9',2023,2026,90,'CURATED','TurboLEV curated v1',NULL),

  ('gen:skoda:octavia:1u','SKODA','OCTAVIA','skoda','octavia','1U','Octavia I (1U)',1996,2010,92,'CURATED','TurboLEV curated v1','Tour production overlaps the second generation.'),
  ('gen:skoda:octavia:1z','SKODA','OCTAVIA','skoda','octavia','1Z','Octavia II (1Z)',2004,2013,94,'CURATED','TurboLEV curated v1',NULL),
  ('gen:skoda:octavia:5e','SKODA','OCTAVIA','skoda','octavia','5E','Octavia III (5E)',2012,2020,94,'CURATED','TurboLEV curated v1',NULL),
  ('gen:skoda:octavia:nx','SKODA','OCTAVIA','skoda','octavia','NX','Octavia IV (NX)',2019,2026,94,'CURATED','TurboLEV curated v1',NULL),

  ('gen:volkswagen:golf:mk1','VOLKSWAGEN','GOLF','volkswagen','golf','MK1','Golf I',1974,1983,90,'CURATED','TurboLEV curated v1',NULL),
  ('gen:volkswagen:golf:mk2','VOLKSWAGEN','GOLF','volkswagen','golf','MK2','Golf II',1983,1992,92,'CURATED','TurboLEV curated v1',NULL),
  ('gen:volkswagen:golf:mk3','VOLKSWAGEN','GOLF','volkswagen','golf','MK3','Golf III',1991,1998,92,'CURATED','TurboLEV curated v1',NULL),
  ('gen:volkswagen:golf:mk4','VOLKSWAGEN','GOLF','volkswagen','golf','MK4','Golf IV',1997,2006,94,'CURATED','TurboLEV curated v1',NULL),
  ('gen:volkswagen:golf:mk5','VOLKSWAGEN','GOLF','volkswagen','golf','MK5','Golf V',2003,2009,94,'CURATED','TurboLEV curated v1',NULL),
  ('gen:volkswagen:golf:mk6','VOLKSWAGEN','GOLF','volkswagen','golf','MK6','Golf VI',2008,2013,94,'CURATED','TurboLEV curated v1',NULL),
  ('gen:volkswagen:golf:mk7','VOLKSWAGEN','GOLF','volkswagen','golf','MK7','Golf VII',2012,2020,94,'CURATED','TurboLEV curated v1',NULL),
  ('gen:volkswagen:golf:mk8','VOLKSWAGEN','GOLF','volkswagen','golf','MK8','Golf VIII',2019,2026,94,'CURATED','TurboLEV curated v1',NULL),

  ('gen:daewoo:lanos:t100t150','DAEWOO','LANOS','daewoo','lanos','T100-T150','Lanos T100/T150',1997,2017,88,'CURATED','TurboLEV curated v1','Major facelift variants are visually close; keep review required for library masters.'),

  ('gen:renault:megane:i','RENAULT','MEGANE','renault','megane','I','Megane I',1995,2003,90,'CURATED','TurboLEV curated v1',NULL),
  ('gen:renault:megane:ii','RENAULT','MEGANE','renault','megane','II','Megane II',2002,2009,94,'CURATED','TurboLEV curated v1',NULL),
  ('gen:renault:megane:iii','RENAULT','MEGANE','renault','megane','III','Megane III',2008,2016,94,'CURATED','TurboLEV curated v1',NULL),
  ('gen:renault:megane:iv','RENAULT','MEGANE','renault','megane','IV','Megane IV',2015,2024,94,'CURATED','TurboLEV curated v1',NULL),

  ('gen:volkswagen:transporter:t3','VOLKSWAGEN','TRANSPORTER','volkswagen','transporter','T3','Transporter T3',1979,1992,90,'CURATED','TurboLEV curated v1',NULL),
  ('gen:volkswagen:transporter:t4','VOLKSWAGEN','TRANSPORTER','volkswagen','transporter','T4','Transporter T4',1990,2003,94,'CURATED','TurboLEV curated v1',NULL),
  ('gen:volkswagen:transporter:t5','VOLKSWAGEN','TRANSPORTER','volkswagen','transporter','T5','Transporter T5',2003,2015,94,'CURATED','TurboLEV curated v1',NULL),
  ('gen:volkswagen:transporter:t6','VOLKSWAGEN','TRANSPORTER','volkswagen','transporter','T6','Transporter T6/T6.1',2015,2024,92,'CURATED','TurboLEV curated v1','T6.1 facelift remains inside the same broad library generation.'),

  ('gen:chevrolet:aveo:t200','CHEVROLET','AVEO','chevrolet','aveo','T200','Aveo T200',2002,2008,90,'CURATED','TurboLEV curated v1',NULL),
  ('gen:chevrolet:aveo:t250','CHEVROLET','AVEO','chevrolet','aveo','T250','Aveo T250',2006,2011,94,'CURATED','TurboLEV curated v1',NULL),
  ('gen:chevrolet:aveo:t300','CHEVROLET','AVEO','chevrolet','aveo','T300','Aveo T300',2011,2020,94,'CURATED','TurboLEV curated v1',NULL),

  ('gen:ford:focus:mk1','FORD','FOCUS','ford','focus','MK1','Focus I',1998,2005,92,'CURATED','TurboLEV curated v1',NULL),
  ('gen:ford:focus:mk2','FORD','FOCUS','ford','focus','MK2','Focus II',2004,2011,94,'CURATED','TurboLEV curated v1',NULL),
  ('gen:ford:focus:mk3','FORD','FOCUS','ford','focus','MK3','Focus III',2010,2018,94,'CURATED','TurboLEV curated v1',NULL),
  ('gen:ford:focus:mk4','FORD','FOCUS','ford','focus','MK4','Focus IV',2018,2026,94,'CURATED','TurboLEV curated v1',NULL),

  ('gen:skoda:fabia:i','SKODA','FABIA','skoda','fabia','I','Fabia I',1999,2008,92,'CURATED','TurboLEV curated v1',NULL),
  ('gen:skoda:fabia:ii','SKODA','FABIA','skoda','fabia','II','Fabia II',2007,2014,94,'CURATED','TurboLEV curated v1',NULL),
  ('gen:skoda:fabia:iii','SKODA','FABIA','skoda','fabia','III','Fabia III',2014,2021,94,'CURATED','TurboLEV curated v1',NULL),
  ('gen:skoda:fabia:iv','SKODA','FABIA','skoda','fabia','IV','Fabia IV',2021,2026,94,'CURATED','TurboLEV curated v1',NULL),

  ('gen:renault:kangoo:i','RENAULT','KANGOO','renault','kangoo','I','Kangoo I',1997,2008,92,'CURATED','TurboLEV curated v1',NULL),
  ('gen:renault:kangoo:ii','RENAULT','KANGOO','renault','kangoo','II','Kangoo II',2007,2021,94,'CURATED','TurboLEV curated v1',NULL),
  ('gen:renault:kangoo:iii','RENAULT','KANGOO','renault','kangoo','III','Kangoo III',2021,2026,94,'CURATED','TurboLEV curated v1',NULL),

  ('gen:toyota:camry:xv10','TOYOTA','CAMRY','toyota','camry','XV10','Camry XV10',1991,1996,90,'CURATED','TurboLEV curated v1',NULL),
  ('gen:toyota:camry:xv20','TOYOTA','CAMRY','toyota','camry','XV20','Camry XV20',1996,2001,92,'CURATED','TurboLEV curated v1',NULL),
  ('gen:toyota:camry:xv30','TOYOTA','CAMRY','toyota','camry','XV30','Camry XV30',2001,2006,94,'CURATED','TurboLEV curated v1',NULL),
  ('gen:toyota:camry:xv40','TOYOTA','CAMRY','toyota','camry','XV40','Camry XV40',2006,2011,94,'CURATED','TurboLEV curated v1',NULL),
  ('gen:toyota:camry:xv50','TOYOTA','CAMRY','toyota','camry','XV50','Camry XV50',2011,2017,94,'CURATED','TurboLEV curated v1',NULL),
  ('gen:toyota:camry:xv70','TOYOTA','CAMRY','toyota','camry','XV70','Camry XV70',2017,2024,94,'CURATED','TurboLEV curated v1',NULL),
  ('gen:toyota:camry:xv80','TOYOTA','CAMRY','toyota','camry','XV80','Camry XV80',2024,2026,90,'CURATED','TurboLEV curated v1',NULL),

  ('gen:opel:astra:f','OPEL','ASTRA','opel','astra','F','Astra F',1991,2002,90,'CURATED','TurboLEV curated v1',NULL),
  ('gen:opel:astra:g','OPEL','ASTRA','opel','astra','G','Astra G',1998,2009,94,'CURATED','TurboLEV curated v1',NULL),
  ('gen:opel:astra:h','OPEL','ASTRA','opel','astra','H','Astra H',2004,2014,94,'CURATED','TurboLEV curated v1',NULL),
  ('gen:opel:astra:j','OPEL','ASTRA','opel','astra','J','Astra J',2009,2018,92,'CURATED','TurboLEV curated v1','Some markets continued production longer; transition overlap remains safe.'),
  ('gen:opel:astra:k','OPEL','ASTRA','opel','astra','K','Astra K',2015,2021,94,'CURATED','TurboLEV curated v1',NULL),
  ('gen:opel:astra:l','OPEL','ASTRA','opel','astra','L','Astra L',2021,2026,94,'CURATED','TurboLEV curated v1',NULL),

  ('gen:volkswagen:caddy:i','VOLKSWAGEN','CADDY','volkswagen','caddy','I','Caddy I',1979,1995,88,'CURATED','TurboLEV curated v1',NULL),
  ('gen:volkswagen:caddy:ii','VOLKSWAGEN','CADDY','volkswagen','caddy','II','Caddy II',1995,2004,92,'CURATED','TurboLEV curated v1',NULL),
  ('gen:volkswagen:caddy:iii','VOLKSWAGEN','CADDY','volkswagen','caddy','III','Caddy III',2003,2015,94,'CURATED','TurboLEV curated v1',NULL),
  ('gen:volkswagen:caddy:iv','VOLKSWAGEN','CADDY','volkswagen','caddy','IV','Caddy IV',2015,2020,94,'CURATED','TurboLEV curated v1',NULL),
  ('gen:volkswagen:caddy:v','VOLKSWAGEN','CADDY','volkswagen','caddy','V','Caddy V',2020,2026,94,'CURATED','TurboLEV curated v1',NULL),

  ('gen:audi:a6:c4','AUDI','A6','audi','a6','C4','A6 C4',1994,1997,92,'CURATED','TurboLEV curated v1',NULL),
  ('gen:audi:a6:c5','AUDI','A6','audi','a6','C5','A6 C5',1997,2004,94,'CURATED','TurboLEV curated v1',NULL),
  ('gen:audi:a6:c6','AUDI','A6','audi','a6','C6','A6 C6',2004,2011,94,'CURATED','TurboLEV curated v1',NULL),
  ('gen:audi:a6:c7','AUDI','A6','audi','a6','C7','A6 C7',2011,2018,94,'CURATED','TurboLEV curated v1',NULL),
  ('gen:audi:a6:c8','AUDI','A6','audi','a6','C8','A6 C8',2018,2026,94,'CURATED','TurboLEV curated v1',NULL),

  ('gen:hyundai:tucson:jm','HYUNDAI','TUCSON','hyundai','tucson','JM','Tucson JM',2004,2009,94,'CURATED','TurboLEV curated v1',NULL),
  ('gen:hyundai:tucson:lm','HYUNDAI','TUCSON','hyundai','tucson','LM','Tucson LM / ix35',2009,2015,92,'CURATED','TurboLEV curated v1','Regional naming differs; same broad generation.'),
  ('gen:hyundai:tucson:tl','HYUNDAI','TUCSON','hyundai','tucson','TL','Tucson TL',2015,2020,94,'CURATED','TurboLEV curated v1',NULL),
  ('gen:hyundai:tucson:nx4','HYUNDAI','TUCSON','hyundai','tucson','NX4','Tucson NX4',2020,2026,94,'CURATED','TurboLEV curated v1',NULL),

  ('gen:chevrolet:lacetti:j200','CHEVROLET','LACETTI','chevrolet','lacetti','J200','Lacetti J200',2002,2013,92,'CURATED','TurboLEV curated v1',NULL),

  ('gen:renault:trafic:i','RENAULT','TRAFIC','renault','trafic','I','Trafic I',1980,2001,90,'CURATED','TurboLEV curated v1',NULL),
  ('gen:renault:trafic:ii','RENAULT','TRAFIC','renault','trafic','II','Trafic II',2001,2014,94,'CURATED','TurboLEV curated v1',NULL),
  ('gen:renault:trafic:iii','RENAULT','TRAFIC','renault','trafic','III','Trafic III',2014,2026,94,'CURATED','TurboLEV curated v1',NULL),

  ('gen:toyota:rav4:xa10','TOYOTA','RAV4','toyota','rav4','XA10','RAV4 XA10',1994,2000,92,'CURATED','TurboLEV curated v1',NULL),
  ('gen:toyota:rav4:xa20','TOYOTA','RAV4','toyota','rav4','XA20','RAV4 XA20',2000,2005,94,'CURATED','TurboLEV curated v1',NULL),
  ('gen:toyota:rav4:xa30','TOYOTA','RAV4','toyota','rav4','XA30','RAV4 XA30',2005,2012,94,'CURATED','TurboLEV curated v1',NULL),
  ('gen:toyota:rav4:xa40','TOYOTA','RAV4','toyota','rav4','XA40','RAV4 XA40',2012,2018,94,'CURATED','TurboLEV curated v1',NULL),
  ('gen:toyota:rav4:xa50','TOYOTA','RAV4','toyota','rav4','XA50','RAV4 XA50',2018,2026,94,'CURATED','TurboLEV curated v1',NULL),

  ('gen:audi:a4:b5','AUDI','A4','audi','a4','B5','A4 B5',1994,2001,92,'CURATED','TurboLEV curated v1',NULL),
  ('gen:audi:a4:b6','AUDI','A4','audi','a4','B6','A4 B6',2000,2006,94,'CURATED','TurboLEV curated v1',NULL),
  ('gen:audi:a4:b7','AUDI','A4','audi','a4','B7','A4 B7',2004,2009,94,'CURATED','TurboLEV curated v1',NULL),
  ('gen:audi:a4:b8','AUDI','A4','audi','a4','B8','A4 B8',2007,2015,94,'CURATED','TurboLEV curated v1',NULL),
  ('gen:audi:a4:b9','AUDI','A4','audi','a4','B9','A4 B9',2015,2024,94,'CURATED','TurboLEV curated v1',NULL),

  ('gen:bmw:x5:e53','BMW','X5','bmw','x5','E53','X5 E53',1999,2006,94,'CURATED','TurboLEV curated v1',NULL),
  ('gen:bmw:x5:e70','BMW','X5','bmw','x5','E70','X5 E70',2006,2013,94,'CURATED','TurboLEV curated v1',NULL),
  ('gen:bmw:x5:f15','BMW','X5','bmw','x5','F15','X5 F15',2013,2018,94,'CURATED','TurboLEV curated v1',NULL),
  ('gen:bmw:x5:g05','BMW','X5','bmw','x5','G05','X5 G05',2018,2026,94,'CURATED','TurboLEV curated v1',NULL)
ON CONFLICT ("normalizedMake","normalizedModel","generationCode","fromYear","toYear") DO UPDATE SET
  "generationLabel"=EXCLUDED."generationLabel",
  "confidence"=EXCLUDED."confidence",
  "verificationStatus"=EXCLUDED."verificationStatus",
  "sourceLabel"=EXCLUDED."sourceLabel",
  "notes"=EXCLUDED."notes",
  "isActive"=TRUE,
  "updatedAt"=CURRENT_TIMESTAMP;
