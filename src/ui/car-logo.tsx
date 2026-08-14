import type { ReactElement } from "react";
import carBrands from "@/src/data/car-brands.json";

type CarBrandLogoRecord = {
  id: string;
  name: string;
  aliases: string[];
  slug: string;
  logoPngUrl: string | null;
  logoSvgUrl: string | null;
};

const catalog = carBrands as CarBrandLogoRecord[];

function normalizeBrand(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase("uk-UA")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9а-яіїєґ]/gi, "");
}

function findCarBrand(carBrand: string): CarBrandLogoRecord | undefined {
  const requested = normalizeBrand(carBrand);
  if (!requested) return undefined;

  return catalog.find((brand) => {
    const candidates = [brand.id, brand.name, brand.slug, ...brand.aliases];
    return candidates.some((candidate) => normalizeBrand(candidate) === requested);
  });
}

function GenericCarLogo() {
  return (
    <svg
      viewBox="0 0 48 48"
      role="img"
      aria-label="Автомобіль"
      className="carBrandSvg"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M8 29.5h32v5.2H8v-5.2Zm4-1.2 3.3-9.4c.6-1.7 2-2.7 3.8-2.7h9.8c1.8 0 3.2 1 3.8 2.7l3.3 9.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.3"
        strokeLinejoin="round"
      />
      <circle cx="15" cy="35" r="3" fill="none" stroke="currentColor" strokeWidth="2.2" />
      <circle cx="33" cy="35" r="3" fill="none" stroke="currentColor" strokeWidth="2.2" />
      <path d="M15 22h18" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" />
    </svg>
  );
}

export function getCarLogo(carBrand: string): ReactElement {
  const brand = findCarBrand(carBrand);
  const logoUrl = brand?.logoSvgUrl || brand?.logoPngUrl;

  if (!brand || !logoUrl) return <GenericCarLogo />;

  const monochrome = Boolean(brand.logoSvgUrl) || logoUrl.toLowerCase().includes(".svg");

  return (
    <img
      src={logoUrl}
      alt={`${brand.name} logo`}
      title={brand.name}
      className={`carBrandImage${monochrome ? " carBrandImageMono" : ""}`}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
    />
  );
}

export function getCarBrandMeta(carBrand: string) {
  return findCarBrand(carBrand) ?? null;
}
