import type { ReactElement } from "react";

function SvgShell({
  label,
  children,
}: {
  label: string;
  children: ReactElement | ReactElement[];
}) {
  return (
    <svg
      viewBox="0 0 48 48"
      role="img"
      aria-label={`${label} logo`}
      className="carBrandSvg"
      xmlns="http://www.w3.org/2000/svg"
    >
      <title>{label}</title>
      {children}
    </svg>
  );
}

function MazdaLogo() {
  return (
    <SvgShell label="Mazda">
      <ellipse cx="24" cy="24" rx="19" ry="15" fill="none" stroke="currentColor" strokeWidth="2.6" />
      <path
        d="M11.5 18.5c4.6 1 8.7 4.3 12.5 10.8 3.8-6.5 7.9-9.8 12.5-10.8-3 5.3-6.8 9.3-12.5 12.7-5.7-3.4-9.5-7.4-12.5-12.7Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinejoin="round"
      />
    </SvgShell>
  );
}

function VolkswagenLogo() {
  return (
    <SvgShell label="Volkswagen">
      <circle cx="24" cy="24" r="18" fill="none" stroke="currentColor" strokeWidth="2.5" />
      <path d="m13 13 7.4 14L24 20l3.6 7L35 13" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" />
      <path d="m12.7 27.2 7.4 8.1L24 27.8l3.9 7.5 7.4-8.1" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" />
    </SvgShell>
  );
}

function FordLogo() {
  return (
    <SvgShell label="Ford">
      <ellipse cx="24" cy="24" rx="20" ry="12.5" fill="none" stroke="currentColor" strokeWidth="2.5" />
      <text
        x="24"
        y="28"
        textAnchor="middle"
        fontSize="11"
        fontWeight="800"
        fontFamily="ui-sans-serif, system-ui, sans-serif"
        fill="currentColor"
      >
        Ford
      </text>
    </SvgShell>
  );
}

function BmwLogo() {
  return (
    <SvgShell label="BMW">
      <circle cx="24" cy="24" r="19" fill="none" stroke="currentColor" strokeWidth="2.4" />
      <circle cx="24" cy="26" r="10" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M24 16v20M14 26h20" stroke="currentColor" strokeWidth="1.8" />
      <text
        x="24"
        y="12.8"
        textAnchor="middle"
        fontSize="6.8"
        fontWeight="900"
        letterSpacing="1.1"
        fontFamily="ui-sans-serif, system-ui, sans-serif"
        fill="currentColor"
      >
        BMW
      </text>
    </SvgShell>
  );
}

function GenericCarLogo() {
  return (
    <SvgShell label="Автомобіль">
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
    </SvgShell>
  );
}

function normalizeBrand(carBrand: string): string {
  return carBrand.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function getCarLogo(carBrand: string): ReactElement {
  const brand = normalizeBrand(carBrand);

  if (brand === "mazda") return <MazdaLogo />;
  if (brand === "volkswagen" || brand === "vw") return <VolkswagenLogo />;
  if (brand === "ford") return <FordLogo />;
  if (brand === "bmw") return <BmwLogo />;

  return <GenericCarLogo />;
}
