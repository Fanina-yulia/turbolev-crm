import { createHash } from "node:crypto";
import { CatalogEntityStatus, PartCatalogReviewStatus, PartSoldAs } from "@/src/generated/prisma/client";
import { getPrisma } from "@/src/lib/prisma";
import { normalizePartTerminology, resolvePartTerminology, listPartTerminology } from "@/src/services/parts-terminology.service";
import { calculateCatalogLaborPrice, type VehicleTechnicalInput } from "@/src/services/labor-pricing.service";
import type { SupplierOffer } from "@/src/services/suppliers/types";

export type PartCoverage = "SIDE" | "WHEEL" | "AXLE" | "VEHICLE" | "FLUID" | "UNKNOWN";
export type PartPriceBasis = "PER_PIECE" | "PER_WHEEL" | "PACKAGE" | "PER_LITER" | "UNKNOWN";
export type OperationPositionRule = "SIDE" | "AXLE" | "VEHICLE";

export type PartPackageRule = {
  canonicalCode: string | null;
  soldAs: "PIECE" | "PAIR" | "SET" | "KIT" | "ASSEMBLY" | "LITER" | "UNKNOWN";
  coverage: PartCoverage;
  unitsPerPackage: number | null;
  packageQuantity: number | null;
  priceQuantity: number | null;
  priceBasis: PartPriceBasis;
  unitLabel: string;
  packageLabel: string;
  requiresQuantityInput: boolean;
  note: string;
};

export type PartOperationDefinition = {
  operationCode: string;
  operationName: string;
  aliases: string[];
  positionRule: OperationPositionRule;
  defaultQuantity: number;
  source: "STATIC_PART_OPERATION_CATALOG";
};

export type RelatedPartOperation = {
  id: string;
  relationId: string | null;
  operationCode: string;
  name: string;
  serviceCatalogItemId: string | null;
  serviceCode: string | null;
  basePrice: number | null;
  adjustedPrice: number | null;
  currency: string;
  quantity: number;
  quantityLabel: string;
  positionRule: OperationPositionRule;
  positionRuleLabel: string;
  normMinutes: number | null;
  mapped: boolean;
  status: "MAPPED" | "NOT_IN_WORK_CATALOG";
  confidence: number;
  source: string;
  note: string | null;
  existingLineId: string | null;
  existingQuantity: number | null;
  existingTotal: number | null;
  catalogItem?: {
    id: string;
    code: string | null;
    displayName: string;
    internalName: string;
    basePrice: number | null;
    currency: string;
    vehicleCoefficientEnabled: boolean;
    normMinutes: number | null;
  } | null;
};

type PartOperationInput = {
  genericArticleId?: string | null;
  canonicalCode?: string | null;
  partName?: string | null;
  axis?: string | null;
  side?: string | null;
  position?: string | null;
  subPosition?: string | null;
  quantityHint?: number | null;
  soldAs?: string | null;
};

type StaticOperationRow = PartOperationDefinition & { operationNameBase?: string };

function clean(value: unknown, max = 240) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function numberValue(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function identity(...values: string[]) {
  return createHash("sha256").update(values.join("\u001f")).digest("hex");
}

function unique(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function normalizeCode(value: unknown) {
  return clean(value, 80).toUpperCase();
}

function axisValue(value: unknown): "FRONT" | "REAR" | null {
  const normalized = clean(value, 32).toUpperCase();
  if (normalized === "FRONT" || /перед/u.test(normalized)) return "FRONT";
  if (normalized === "REAR" || /зад/u.test(normalized)) return "REAR";
  return null;
}

function sideValue(value: unknown): "LEFT" | "RIGHT" | null {
  const normalized = clean(value, 32).toUpperCase();
  if (normalized === "LEFT" || /лів|лев/u.test(normalized)) return "LEFT";
  if (normalized === "RIGHT" || /прав/u.test(normalized)) return "RIGHT";
  return null;
}

function subPositionValue(value: unknown): "FRONT" | "REAR" | "UPPER" | "LOWER" | null {
  const normalized = clean(value, 32).toUpperCase();
  if (["FRONT", "REAR", "UPPER", "LOWER"].includes(normalized)) return normalized as "FRONT" | "REAR" | "UPPER" | "LOWER";
  if (/верх/u.test(normalized)) return "UPPER";
  if (/ниж/u.test(normalized)) return "LOWER";
  if (/перед/u.test(normalized)) return "FRONT";
  if (/зад/u.test(normalized)) return "REAR";
  return null;
}

function canonicalCodeFromInput(input: PartOperationInput) {
  if (normalizeCode(input.canonicalCode)) return normalizeCode(input.canonicalCode);
  const resolution = resolvePartTerminology({
    query: input.partName,
    partName: input.partName,
    axis: input.axis,
    side: input.side,
    position: input.position,
    subPosition: input.subPosition,
  });
  return resolution.definition?.code || null;
}

function rule(
  canonicalCode: string | null,
  soldAs: PartPackageRule["soldAs"],
  coverage: PartCoverage,
  priceBasis: PartPriceBasis,
  unitLabel: string,
  packageLabel: string,
  note: string,
  options: Partial<Pick<PartPackageRule, "unitsPerPackage" | "packageQuantity" | "priceQuantity" | "requiresQuantityInput">> = {},
): PartPackageRule {
  return {
    canonicalCode,
    soldAs,
    coverage,
    unitsPerPackage: options.unitsPerPackage ?? 1,
    packageQuantity: options.packageQuantity ?? 1,
    priceQuantity: options.priceQuantity ?? options.packageQuantity ?? 1,
    priceBasis,
    unitLabel,
    packageLabel,
    requiresQuantityInput: options.requiresQuantityInput ?? false,
    note,
  };
}

/**
 * The package rule is the commercial source of truth. A diagnostic checkbox
 * describes a finding, while this rule describes how many physical supplier
 * units have to be quoted for that finding.
 */
const PACKAGE_RULES: Record<string, PartPackageRule> = {
  BRAKE_PAD: rule("BRAKE_PAD", "SET", "AXLE", "PER_WHEEL", "комплект", "1 комплект на вісь · 2 колеса", "Колодки продаються для всієї осі. Якщо ціна постачальника вказана за одне колесо, сума множиться на 2.", { unitsPerPackage: 2, packageQuantity: 1, priceQuantity: 2 }),
  BRAKE_DISC: rule("BRAKE_DISC", "PIECE", "WHEEL", "PER_PIECE", "шт", "1 диск на колесо", "Гальмівні диски рахуються поштучно. Для двох сторін потрібні 2 диски.", { unitsPerPackage: 1, packageQuantity: 1, priceQuantity: 1 }),
  SHOCK_ABSORBER: rule("SHOCK_ABSORBER", "PIECE", "WHEEL", "PER_PIECE", "шт", "1 амортизатор на сторону", "Амортизатори рахуються окремо для кожної сторони; парна заміна показується як 2 шт.", { packageQuantity: 1, priceQuantity: 1 }),
  COIL_SPRING: rule("COIL_SPRING", "PIECE", "WHEEL", "PER_PIECE", "шт", "1 пружина на сторону", "Пружини рахуються поштучно. Рекомендовано перевірити парну заміну.", { packageQuantity: 1, priceQuantity: 1 }),
  STRUT_MOUNT: rule("STRUT_MOUNT", "PIECE", "WHEEL", "PER_PIECE", "шт", "1 опора на сторону", "Опора амортизатора рахується поштучно для кожної сторони.", { packageQuantity: 1, priceQuantity: 1 }),
  BALL_JOINT: rule("BALL_JOINT", "PIECE", "WHEEL", "PER_PIECE", "шт", "1 кульова опора на сторону", "Кульова опора є окремою деталлю лівої або правої сторони.", { packageQuantity: 1, priceQuantity: 1 }),
  WHEEL_HUB_BEARING: rule("WHEEL_HUB_BEARING", "PIECE", "WHEEL", "PER_PIECE", "шт", "1 підшипник на колесо", "Ступичний підшипник рахується по одному на колесо.", { packageQuantity: 1, priceQuantity: 1 }),
  WHEEL_HUB_ASSEMBLY: rule("WHEEL_HUB_ASSEMBLY", "ASSEMBLY", "WHEEL", "PER_PIECE", "шт", "1 ступиця на колесо", "Ступиця в зборі є окремою деталлю конкретної сторони.", { packageQuantity: 1, priceQuantity: 1 }),
  STABILIZER_LINK: rule("STABILIZER_LINK", "PIECE", "WHEEL", "PER_PIECE", "шт", "1 стійка на сторону", "Стійки стабілізатора рахуються окремо для кожної сторони.", { packageQuantity: 1, priceQuantity: 1 }),
  STABILIZER_BUSHING: rule("STABILIZER_BUSHING", "PAIR", "AXLE", "PACKAGE", "пара", "1 пара втулок на вісь", "Типова заміна — дві втулки на вісь. Фактичну комплектність постачальника потрібно підтвердити.", { unitsPerPackage: 2, packageQuantity: 1, priceQuantity: 1 }),
  CONTROL_ARM: rule("CONTROL_ARM", "PIECE", "WHEEL", "PER_PIECE", "шт", "1 важіль на сторону", "Важелі рахуються окремо для кожної сторони.", { packageQuantity: 1, priceQuantity: 1 }),
  CONTROL_ARM_BUSHING: rule("CONTROL_ARM_BUSHING", "PIECE", "WHEEL", "PER_PIECE", "шт", "1 сайлентблок на сторону", "Сайлентблок рахується окремо; кількість залежить від конкретного важеля.", { packageQuantity: 1, priceQuantity: 1 }),
  FRONT_ARM_FRONT_BUSHING: rule("FRONT_ARM_FRONT_BUSHING", "PIECE", "WHEEL", "PER_PIECE", "шт", "1 сайлентблок на сторону", "Передній сайлентблок переднього важеля — поштучно.", { packageQuantity: 1, priceQuantity: 1 }),
  FRONT_ARM_REAR_BUSHING: rule("FRONT_ARM_REAR_BUSHING", "PIECE", "WHEEL", "PER_PIECE", "шт", "1 сайлентблок на сторону", "Задній сайлентблок переднього важеля — поштучно.", { packageQuantity: 1, priceQuantity: 1 }),
  TIE_ROD_END: rule("TIE_ROD_END", "PIECE", "WHEEL", "PER_PIECE", "шт", "1 наконечник на сторону", "Рульові наконечники рахуються поштучно.", { packageQuantity: 1, priceQuantity: 1 }),
  TIE_ROD: rule("TIE_ROD", "PIECE", "WHEEL", "PER_PIECE", "шт", "1 тяга на сторону", "Рульові тяги рахуються поштучно.", { packageQuantity: 1, priceQuantity: 1 }),
  STEERING_RACK_BOOT: rule("STEERING_RACK_BOOT", "PIECE", "WHEEL", "PER_PIECE", "шт", "1 пильник на сторону", "Пильник рейки рахується поштучно.", { packageQuantity: 1, priceQuantity: 1 }),
  STEERING_RACK: rule("STEERING_RACK", "ASSEMBLY", "VEHICLE", "PACKAGE", "вузол", "1 вузол на автомобіль", "Рульова рейка — вузол у зборі; потрібна VIN-перевірка.", { packageQuantity: 1, priceQuantity: 1 }),
  BRAKE_CALIPER: rule("BRAKE_CALIPER", "ASSEMBLY", "WHEEL", "PER_PIECE", "шт", "1 супорт на сторону", "Супорт є окремим вузлом конкретної сторони.", { packageQuantity: 1, priceQuantity: 1 }),
  BRAKE_HOSE: rule("BRAKE_HOSE", "PIECE", "WHEEL", "PER_PIECE", "шт", "1 шланг на сторону", "Гальмівні шланги рахуються поштучно.", { packageQuantity: 1, priceQuantity: 1 }),
  CV_OUTER_JOINT: rule("CV_OUTER_JOINT", "ASSEMBLY", "WHEEL", "PER_PIECE", "шт", "1 зовнішній ШРУС на сторону", "Зовнішній ШРУС є окремим вузлом лівої або правої півосі.", { packageQuantity: 1, priceQuantity: 1 }),
  CV_INNER_JOINT: rule("CV_INNER_JOINT", "ASSEMBLY", "WHEEL", "PER_PIECE", "шт", "1 внутрішній ШРУС на сторону", "Внутрішній ШРУС є окремим вузлом лівої або правої півосі.", { packageQuantity: 1, priceQuantity: 1 }),
  CV_OUTER_BOOT: rule("CV_OUTER_BOOT", "KIT", "WHEEL", "PACKAGE", "комплект", "1 ремонтний комплект на сторону", "Комплект пильника зовнішнього ШРУСа зазвичай містить пильник, хомути та мастило.", { packageQuantity: 1, priceQuantity: 1 }),
  CV_INNER_BOOT: rule("CV_INNER_BOOT", "KIT", "WHEEL", "PACKAGE", "комплект", "1 ремонтний комплект на сторону", "Комплект пильника внутрішнього ШРУСа зазвичай містить пильник, хомути та мастило.", { packageQuantity: 1, priceQuantity: 1 }),
  DRIVESHAFT: rule("DRIVESHAFT", "ASSEMBLY", "WHEEL", "PER_PIECE", "шт", "1 піввісь на сторону", "Піввісь є вузлом конкретної сторони.", { packageQuantity: 1, priceQuantity: 1 }),
  REAR_UPPER_LATERAL_LINK: rule("REAR_UPPER_LATERAL_LINK", "PIECE", "WHEEL", "PER_PIECE", "шт", "1 тяга на сторону", "Верхня поперечна тяга рахується поштучно.", { packageQuantity: 1, priceQuantity: 1 }),
  REAR_UPPER_LATERAL_LINK_BUSHING: rule("REAR_UPPER_LATERAL_LINK_BUSHING", "PIECE", "WHEEL", "PER_PIECE", "шт", "1 сайлентблок на сторону", "Сайлентблок верхньої тяги рахується поштучно.", { packageQuantity: 1, priceQuantity: 1 }),
  REAR_LOWER_LATERAL_LINK: rule("REAR_LOWER_LATERAL_LINK", "PIECE", "WHEEL", "PER_PIECE", "шт", "1 тяга на сторону", "Нижня поперечна тяга рахується поштучно.", { packageQuantity: 1, priceQuantity: 1 }),
  REAR_LOWER_LATERAL_LINK_BUSHING: rule("REAR_LOWER_LATERAL_LINK_BUSHING", "PIECE", "WHEEL", "PER_PIECE", "шт", "1 сайлентблок на сторону", "Сайлентблок нижньої тяги рахується поштучно.", { packageQuantity: 1, priceQuantity: 1 }),
  REAR_TRAILING_LINK: rule("REAR_TRAILING_LINK", "PIECE", "WHEEL", "PER_PIECE", "шт", "1 тяга на сторону", "Поздовжня тяга рахується поштучно.", { packageQuantity: 1, priceQuantity: 1 }),
  REAR_TRAILING_LINK_BUSHING: rule("REAR_TRAILING_LINK_BUSHING", "PIECE", "WHEEL", "PER_PIECE", "шт", "1 сайлентблок на сторону", "Сайлентблок поздовжньої тяги рахується поштучно.", { packageQuantity: 1, priceQuantity: 1 }),
  REAR_TRAILING_ARM: rule("REAR_TRAILING_ARM", "PIECE", "WHEEL", "PER_PIECE", "шт", "1 важіль на сторону", "Поздовжній важіль рахується поштучно.", { packageQuantity: 1, priceQuantity: 1 }),
  REAR_TRAILING_ARM_BUSHING: rule("REAR_TRAILING_ARM_BUSHING", "PIECE", "WHEEL", "PER_PIECE", "шт", "1 сайлентблок на сторону", "Сайлентблок поздовжнього важеля рахується поштучно.", { packageQuantity: 1, priceQuantity: 1 }),
  ENGINE_OIL: rule("ENGINE_OIL", "LITER", "FLUID", "PER_LITER", "л", "Обсяг уточнюється за двигуном", "Моторна олива рахується за літрами; обсяг не можна вгадувати з діагностичної галочки.", { packageQuantity: null, priceQuantity: null, requiresQuantityInput: true }),
  COOLANT: rule("COOLANT", "LITER", "FLUID", "PER_LITER", "л", "Обсяг уточнюється за системою охолодження", "Охолоджувальна рідина рахується за літрами.", { packageQuantity: null, priceQuantity: null, requiresQuantityInput: true }),
  BRAKE_FLUID: rule("BRAKE_FLUID", "LITER", "FLUID", "PER_LITER", "л", "Обсяг уточнюється за процедурою", "Гальмівна рідина рахується за літрами.", { packageQuantity: null, priceQuantity: null, requiresQuantityInput: true }),
  POWER_STEERING_FLUID: rule("POWER_STEERING_FLUID", "LITER", "FLUID", "PER_LITER", "л", "Обсяг уточнюється за системою ГПК", "Рідина ГПК рахується за літрами.", { packageQuantity: null, priceQuantity: null, requiresQuantityInput: true }),
  TRANSMISSION_OIL: rule("TRANSMISSION_OIL", "LITER", "FLUID", "PER_LITER", "л", "Обсяг уточнюється за КПП або редуктором", "Трансмісійна олива рахується за літрами.", { packageQuantity: null, priceQuantity: null, requiresQuantityInput: true }),
  ENGINE_SEALING: rule("ENGINE_SEALING", "UNKNOWN", "VEHICLE", "UNKNOWN", "робота", "За результатом дефектування", "Герметичність — це робота/діагностика, а не товарна деталь.", { packageQuantity: 1, priceQuantity: 1 }),
  VALVE_COVER: rule("VALVE_COVER", "PIECE", "VEHICLE", "PER_PIECE", "шт", "1 кришка на автомобіль", "Клапанна кришка — вузол автомобіля; потрібна VIN-перевірка.", { packageQuantity: 1, priceQuantity: 1 }),
  ENGINE_OIL_PAN: rule("ENGINE_OIL_PAN", "PIECE", "VEHICLE", "PER_PIECE", "шт", "1 піддон на автомобіль", "Піддон двигуна рахується як вузол.", { packageQuantity: 1, priceQuantity: 1 }),
  CRANKSHAFT_FRONT_SEAL: rule("CRANKSHAFT_FRONT_SEAL", "PIECE", "VEHICLE", "PER_PIECE", "шт", "1 сальник на автомобіль", "Передній сальник колінвала — поштучно.", { packageQuantity: 1, priceQuantity: 1 }),
  CRANKSHAFT_REAR_SEAL: rule("CRANKSHAFT_REAR_SEAL", "PIECE", "VEHICLE", "PER_PIECE", "шт", "1 сальник на автомобіль", "Задній сальник колінвала — поштучно.", { packageQuantity: 1, priceQuantity: 1 }),
  COOLING_SYSTEM_HOSES: rule("COOLING_SYSTEM_HOSES", "PIECE", "VEHICLE", "PER_PIECE", "шт", "Кількість за дефектуванням", "Патрубки не мають універсальної кількості; кожен патрубок — окрема позиція.", { packageQuantity: 1, priceQuantity: 1 }),
  TRANSMISSION_CASE_SEALING: rule("TRANSMISSION_CASE_SEALING", "UNKNOWN", "VEHICLE", "UNKNOWN", "робота", "За результатом дефектування", "Герметичність корпусу трансмісії — сервісна робота.", { packageQuantity: 1, priceQuantity: 1 }),
  TRANSMISSION_OIL_PAN: rule("TRANSMISSION_OIL_PAN", "PIECE", "VEHICLE", "PER_PIECE", "шт", "1 піддон на автомобіль", "Піддон КПП рахується як вузол.", { packageQuantity: 1, priceQuantity: 1 }),
  TRANSMISSION_INPUT_SHAFT_SEAL: rule("TRANSMISSION_INPUT_SHAFT_SEAL", "PIECE", "VEHICLE", "PER_PIECE", "шт", "1 сальник на автомобіль", "Сальник первинного валу — поштучно.", { packageQuantity: 1, priceQuantity: 1 }),
  AXLE_SHAFT_SEAL: rule("AXLE_SHAFT_SEAL", "PIECE", "WHEEL", "PER_PIECE", "шт", "1 сальник на сторону", "Сальники півосей рахуються за стороною.", { packageQuantity: 1, priceQuantity: 1 }),
  EXHAUST_MANIFOLD: rule("EXHAUST_MANIFOLD", "ASSEMBLY", "VEHICLE", "PER_PIECE", "шт", "1 колектор на автомобіль", "Випускний колектор — вузол у зборі.", { packageQuantity: 1, priceQuantity: 1 }),
  EXHAUST_FLEX_PIPE: rule("EXHAUST_FLEX_PIPE", "PIECE", "VEHICLE", "PER_PIECE", "шт", "1 гофра на автомобіль", "Гофра рахується як окрема деталь.", { packageQuantity: 1, priceQuantity: 1 }),
  EXHAUST_FRONT_PIPE: rule("EXHAUST_FRONT_PIPE", "ASSEMBLY", "VEHICLE", "PER_PIECE", "шт", "1 приймальна труба на автомобіль", "Приймальна труба — вузол.", { packageQuantity: 1, priceQuantity: 1 }),
  CATALYTIC_CONVERTER: rule("CATALYTIC_CONVERTER", "ASSEMBLY", "VEHICLE", "PER_PIECE", "шт", "1 каталізатор на автомобіль", "Каталізатор — вузол; потрібна VIN-перевірка.", { packageQuantity: 1, priceQuantity: 1 }),
  DIESEL_PARTICULATE_FILTER: rule("DIESEL_PARTICULATE_FILTER", "ASSEMBLY", "VEHICLE", "PER_PIECE", "шт", "1 DPF на автомобіль", "DPF — вузол; потрібна VIN-перевірка.", { packageQuantity: 1, priceQuantity: 1 }),
  RESONATOR: rule("RESONATOR", "ASSEMBLY", "VEHICLE", "PER_PIECE", "шт", "1 резонатор на автомобіль", "Резонатор — вузол.", { packageQuantity: 1, priceQuantity: 1 }),
  MUFFLER: rule("MUFFLER", "ASSEMBLY", "VEHICLE", "PER_PIECE", "шт", "1 глушник на автомобіль", "Глушник — вузол.", { packageQuantity: 1, priceQuantity: 1 }),
  EXHAUST_HANGER: rule("EXHAUST_HANGER", "PIECE", "VEHICLE", "PER_PIECE", "шт", "Кількість за дефектуванням", "Підвіси вихлопу рахуються за фактичною кількістю.", { packageQuantity: 1, priceQuantity: 1 }),
  EXHAUST_CLAMP: rule("EXHAUST_CLAMP", "PIECE", "VEHICLE", "PER_PIECE", "шт", "Кількість за дефектуванням", "Хомути та з’єднання рахуються за фактичною кількістю.", { packageQuantity: 1, priceQuantity: 1 }),
  EXHAUST_SYSTEM_SEALING: rule("EXHAUST_SYSTEM_SEALING", "UNKNOWN", "VEHICLE", "UNKNOWN", "робота", "За результатом дефектування", "Герметичність вихлопу — сервісна робота.", { packageQuantity: 1, priceQuantity: 1 }),
};

const STATIC_OPERATIONS: Record<string, StaticOperationRow[]> = {
  SHOCK_ABSORBER: [{ operationCode: "REPLACE_SHOCK_ABSORBER", operationName: "Заміна амортизатора", aliases: ["Заміна переднього амортизатора", "Заміна заднього амортизатора"], positionRule: "SIDE", defaultQuantity: 1, source: "STATIC_PART_OPERATION_CATALOG" }],
  COIL_SPRING: [{ operationCode: "REPLACE_COIL_SPRING", operationName: "Заміна пружини підвіски", aliases: ["Заміна передньої пружини", "Заміна задньої пружини"], positionRule: "SIDE", defaultQuantity: 1, source: "STATIC_PART_OPERATION_CATALOG" }],
  STRUT_MOUNT: [{ operationCode: "REPLACE_STRUT_MOUNT", operationName: "Заміна опори амортизатора", aliases: ["Заміна опори стійки"], positionRule: "SIDE", defaultQuantity: 1, source: "STATIC_PART_OPERATION_CATALOG" }],
  BALL_JOINT: [{ operationCode: "REPLACE_BALL_JOINT", operationName: "Заміна кульової опори", aliases: ["Заміна шарової опори"], positionRule: "SIDE", defaultQuantity: 1, source: "STATIC_PART_OPERATION_CATALOG" }],
  CONTROL_ARM: [{ operationCode: "REPLACE_CONTROL_ARM", operationName: "Заміна переднього важеля", aliases: ["Заміна важеля підвіски", "Заміна заднього важеля"], positionRule: "SIDE", defaultQuantity: 1, source: "STATIC_PART_OPERATION_CATALOG" }],
  FRONT_ARM_FRONT_BUSHING: [{ operationCode: "REPLACE_FRONT_ARM_FRONT_BUSHING", operationName: "Заміна переднього сайлентблока переднього важеля", aliases: ["Заміна переднього сайлентблока важеля"], positionRule: "SIDE", defaultQuantity: 1, source: "STATIC_PART_OPERATION_CATALOG" }],
  FRONT_ARM_REAR_BUSHING: [{ operationCode: "REPLACE_FRONT_ARM_REAR_BUSHING", operationName: "Заміна заднього сайлентблока переднього важеля", aliases: ["Заміна заднього сайлентблока важеля"], positionRule: "SIDE", defaultQuantity: 1, source: "STATIC_PART_OPERATION_CATALOG" }],
  CONTROL_ARM_BUSHING: [{ operationCode: "REPLACE_CONTROL_ARM_BUSHING", operationName: "Заміна сайлентблока важеля", aliases: ["Заміна сайлентблока"], positionRule: "SIDE", defaultQuantity: 1, source: "STATIC_PART_OPERATION_CATALOG" }],
  STABILIZER_LINK: [{ operationCode: "REPLACE_STABILIZER_LINK", operationName: "Заміна стійки стабілізатора", aliases: ["Заміна тяги стабілізатора", "Заміна кісточки стабілізатора"], positionRule: "SIDE", defaultQuantity: 1, source: "STATIC_PART_OPERATION_CATALOG" }],
  STABILIZER_BUSHING: [{ operationCode: "REPLACE_STABILIZER_BUSHING", operationName: "Заміна втулок стабілізатора", aliases: ["Заміна передніх втулок стабілізатора", "Заміна задніх втулок стабілізатора"], positionRule: "AXLE", defaultQuantity: 1, source: "STATIC_PART_OPERATION_CATALOG" }],
  WHEEL_HUB_BEARING: [{ operationCode: "REPLACE_WHEEL_HUB_BEARING", operationName: "Заміна ступичного підшипника", aliases: ["Заміна переднього ступичного підшипника", "Заміна заднього ступичного підшипника"], positionRule: "SIDE", defaultQuantity: 1, source: "STATIC_PART_OPERATION_CATALOG" }],
  WHEEL_HUB_ASSEMBLY: [{ operationCode: "REPLACE_WHEEL_HUB_ASSEMBLY", operationName: "Заміна ступиці в зборі", aliases: ["Заміна маточини"], positionRule: "SIDE", defaultQuantity: 1, source: "STATIC_PART_OPERATION_CATALOG" }],
  TIE_ROD_END: [{ operationCode: "REPLACE_TIE_ROD_END", operationName: "Заміна рульового наконечника", aliases: ["Заміна наконечника рульової тяги"], positionRule: "SIDE", defaultQuantity: 1, source: "STATIC_PART_OPERATION_CATALOG" }],
  TIE_ROD: [{ operationCode: "REPLACE_TIE_ROD", operationName: "Заміна рульової тяги", aliases: ["Заміна тяги рульового керування"], positionRule: "SIDE", defaultQuantity: 1, source: "STATIC_PART_OPERATION_CATALOG" }],
  STEERING_RACK_BOOT: [{ operationCode: "REPLACE_STEERING_RACK_BOOT", operationName: "Заміна пильника рульової рейки", aliases: ["Заміна пильника рейки"], positionRule: "SIDE", defaultQuantity: 1, source: "STATIC_PART_OPERATION_CATALOG" }],
  STEERING_RACK: [{ operationCode: "REPAIR_STEERING_RACK", operationName: "Ремонт / заміна рульової рейки", aliases: ["Ремонт рульової рейки", "Заміна рульової рейки"], positionRule: "VEHICLE", defaultQuantity: 1, source: "STATIC_PART_OPERATION_CATALOG" }],
  BRAKE_PAD: [
    { operationCode: "REPLACE_FRONT_BRAKE_PADS", operationName: "Заміна передніх гальмівних колодок", aliases: ["Заміна передніх колодок", "Заміна тормозних колодок перед"], positionRule: "AXLE", defaultQuantity: 1, source: "STATIC_PART_OPERATION_CATALOG" },
    { operationCode: "REPLACE_REAR_BRAKE_PADS", operationName: "Заміна задніх гальмівних колодок", aliases: ["Заміна задніх колодок", "Заміна тормозних колодок зад"], positionRule: "AXLE", defaultQuantity: 1, source: "STATIC_PART_OPERATION_CATALOG" },
    { operationCode: "SERVICE_BRAKE_CALIPER_GUIDES", operationName: "Обслуговування направляючих супорта", aliases: ["Обслуговування направляючих переднього супорта", "Обслуговування направляючих заднього супорта"], positionRule: "AXLE", defaultQuantity: 1, source: "STATIC_PART_OPERATION_CATALOG" },
  ],
  BRAKE_DISC: [
    { operationCode: "REPLACE_FRONT_BRAKE_DISCS", operationName: "Заміна передніх гальмівних дисків", aliases: ["Заміна передніх дисків"], positionRule: "AXLE", defaultQuantity: 1, source: "STATIC_PART_OPERATION_CATALOG" },
    { operationCode: "REPLACE_REAR_BRAKE_DISCS", operationName: "Заміна задніх гальмівних дисків", aliases: ["Заміна задніх дисків", "Ремонт задньої гальмівної системи"], positionRule: "AXLE", defaultQuantity: 1, source: "STATIC_PART_OPERATION_CATALOG" },
  ],
  BRAKE_CALIPER: [{ operationCode: "REPAIR_BRAKE_CALIPER", operationName: "Ремонт / заміна гальмівного супорта", aliases: ["Ремонт переднього супорта", "Ремонт заднього супорта", "Заміна супорта"], positionRule: "SIDE", defaultQuantity: 1, source: "STATIC_PART_OPERATION_CATALOG" }],
  BRAKE_HOSE: [{ operationCode: "REPLACE_BRAKE_HOSE", operationName: "Заміна гальмівного шланга", aliases: ["Заміна переднього гальмівного шланга", "Заміна заднього гальмівного шланга"], positionRule: "SIDE", defaultQuantity: 1, source: "STATIC_PART_OPERATION_CATALOG" }],
  CV_OUTER_JOINT: [{ operationCode: "REPLACE_OUTER_CV_JOINT", operationName: "Заміна зовнішнього ШРУСа", aliases: ["Заміна зовнішньої гранати"], positionRule: "SIDE", defaultQuantity: 1, source: "STATIC_PART_OPERATION_CATALOG" }],
  CV_INNER_JOINT: [{ operationCode: "REPLACE_INNER_CV_JOINT", operationName: "Заміна внутрішнього ШРУСа", aliases: ["Заміна внутрішньої гранати"], positionRule: "SIDE", defaultQuantity: 1, source: "STATIC_PART_OPERATION_CATALOG" }],
  CV_OUTER_BOOT: [{ operationCode: "REPLACE_OUTER_CV_BOOT", operationName: "Заміна пильника зовнішнього ШРУСа", aliases: ["Заміна пильника зовнішньої гранати"], positionRule: "SIDE", defaultQuantity: 1, source: "STATIC_PART_OPERATION_CATALOG" }],
  CV_INNER_BOOT: [{ operationCode: "REPLACE_INNER_CV_BOOT", operationName: "Заміна пильника внутрішнього ШРУСа", aliases: ["Заміна пильника внутрішньої гранати"], positionRule: "SIDE", defaultQuantity: 1, source: "STATIC_PART_OPERATION_CATALOG" }],
  DRIVESHAFT: [{ operationCode: "REPLACE_DRIVESHAFT", operationName: "Заміна півосі", aliases: ["Заміна приводного валу"], positionRule: "SIDE", defaultQuantity: 1, source: "STATIC_PART_OPERATION_CATALOG" }],
  REAR_UPPER_LATERAL_LINK: [{ operationCode: "REPLACE_REAR_UPPER_LATERAL_LINK", operationName: "Заміна верхньої поперечної тяги", aliases: ["Заміна верхнього поперечного важеля"], positionRule: "SIDE", defaultQuantity: 1, source: "STATIC_PART_OPERATION_CATALOG" }],
  REAR_UPPER_LATERAL_LINK_BUSHING: [{ operationCode: "REPLACE_REAR_UPPER_LATERAL_LINK_BUSHING", operationName: "Заміна сайлентблока верхньої поперечної тяги", aliases: ["Заміна сайлентблока верхньої тяги"], positionRule: "SIDE", defaultQuantity: 1, source: "STATIC_PART_OPERATION_CATALOG" }],
  REAR_LOWER_LATERAL_LINK: [{ operationCode: "REPLACE_REAR_LOWER_LATERAL_LINK", operationName: "Заміна нижньої поперечної тяги", aliases: ["Заміна нижнього поперечного важеля"], positionRule: "SIDE", defaultQuantity: 1, source: "STATIC_PART_OPERATION_CATALOG" }],
  REAR_LOWER_LATERAL_LINK_BUSHING: [{ operationCode: "REPLACE_REAR_LOWER_LATERAL_LINK_BUSHING", operationName: "Заміна сайлентблока нижньої поперечної тяги", aliases: ["Заміна сайлентблока нижньої тяги"], positionRule: "SIDE", defaultQuantity: 1, source: "STATIC_PART_OPERATION_CATALOG" }],
  REAR_TRAILING_LINK: [{ operationCode: "REPLACE_REAR_TRAILING_LINK", operationName: "Заміна поздовжньої тяги", aliases: ["Заміна поздовжнього важеля"], positionRule: "SIDE", defaultQuantity: 1, source: "STATIC_PART_OPERATION_CATALOG" }],
  REAR_TRAILING_LINK_BUSHING: [{ operationCode: "REPLACE_REAR_TRAILING_LINK_BUSHING", operationName: "Заміна сайлентблока поздовжньої тяги", aliases: ["Заміна сайлентблока поздовжньої тяги"], positionRule: "SIDE", defaultQuantity: 1, source: "STATIC_PART_OPERATION_CATALOG" }],
  REAR_TRAILING_ARM: [{ operationCode: "REPLACE_REAR_TRAILING_ARM", operationName: "Заміна поздовжнього важеля", aliases: ["Заміна поздовжнього важеля задньої підвіски"], positionRule: "SIDE", defaultQuantity: 1, source: "STATIC_PART_OPERATION_CATALOG" }],
  REAR_TRAILING_ARM_BUSHING: [{ operationCode: "REPLACE_REAR_TRAILING_ARM_BUSHING", operationName: "Заміна сайлентблока поздовжнього важеля", aliases: ["Заміна сайлентблока поздовжнього важеля"], positionRule: "SIDE", defaultQuantity: 1, source: "STATIC_PART_OPERATION_CATALOG" }],
  AXLE_SHAFT_SEAL: [{ operationCode: "REPLACE_AXLE_SHAFT_SEAL", operationName: "Заміна сальника півосі", aliases: ["Заміна сальника диференціала"], positionRule: "SIDE", defaultQuantity: 1, source: "STATIC_PART_OPERATION_CATALOG" }],
  ENGINE_OIL: [{ operationCode: "REPLACE_ENGINE_OIL", operationName: "Заміна моторної оливи", aliases: ["Заміна моторного масла", "Заміна масла двигуна"], positionRule: "VEHICLE", defaultQuantity: 1, source: "STATIC_PART_OPERATION_CATALOG" }],
  COOLANT: [{ operationCode: "REPLACE_COOLANT", operationName: "Заміна охолоджувальної рідини", aliases: ["Заміна антифризу"], positionRule: "VEHICLE", defaultQuantity: 1, source: "STATIC_PART_OPERATION_CATALOG" }],
  BRAKE_FLUID: [{ operationCode: "REPLACE_BRAKE_FLUID", operationName: "Заміна гальмівної рідини", aliases: ["Заміна тормозної рідини"], positionRule: "VEHICLE", defaultQuantity: 1, source: "STATIC_PART_OPERATION_CATALOG" }],
  POWER_STEERING_FLUID: [{ operationCode: "REPLACE_POWER_STEERING_FLUID", operationName: "Заміна рідини ГПК", aliases: ["Заміна рідини гідропідсилювача"], positionRule: "VEHICLE", defaultQuantity: 1, source: "STATIC_PART_OPERATION_CATALOG" }],
  TRANSMISSION_OIL: [{ operationCode: "REPLACE_TRANSMISSION_OIL", operationName: "Заміна оливи трансмісії / редуктора", aliases: ["Заміна масла КПП", "Заміна масла редуктора"], positionRule: "VEHICLE", defaultQuantity: 1, source: "STATIC_PART_OPERATION_CATALOG" }],
  ENGINE_SEALING: [{ operationCode: "REPAIR_ENGINE_SEALING", operationName: "Усунення підтікання двигуна", aliases: ["Ремонт герметичності двигуна"], positionRule: "VEHICLE", defaultQuantity: 1, source: "STATIC_PART_OPERATION_CATALOG" }],
  VALVE_COVER: [{ operationCode: "REPLACE_VALVE_COVER", operationName: "Заміна клапанної кришки", aliases: ["Заміна кришки клапанів"], positionRule: "VEHICLE", defaultQuantity: 1, source: "STATIC_PART_OPERATION_CATALOG" }],
  ENGINE_OIL_PAN: [{ operationCode: "REPLACE_ENGINE_OIL_PAN", operationName: "Заміна піддона двигуна", aliases: ["Заміна піддона мотора"], positionRule: "VEHICLE", defaultQuantity: 1, source: "STATIC_PART_OPERATION_CATALOG" }],
  CRANKSHAFT_FRONT_SEAL: [{ operationCode: "REPLACE_CRANKSHAFT_FRONT_SEAL", operationName: "Заміна переднього сальника колінвала", aliases: [], positionRule: "VEHICLE", defaultQuantity: 1, source: "STATIC_PART_OPERATION_CATALOG" }],
  CRANKSHAFT_REAR_SEAL: [{ operationCode: "REPLACE_CRANKSHAFT_REAR_SEAL", operationName: "Заміна заднього сальника колінвала", aliases: [], positionRule: "VEHICLE", defaultQuantity: 1, source: "STATIC_PART_OPERATION_CATALOG" }],
  COOLING_SYSTEM_HOSES: [{ operationCode: "REPLACE_COOLING_SYSTEM_HOSES", operationName: "Заміна патрубка системи охолодження", aliases: ["Заміна патрубків охолодження"], positionRule: "VEHICLE", defaultQuantity: 1, source: "STATIC_PART_OPERATION_CATALOG" }],
  TRANSMISSION_CASE_SEALING: [{ operationCode: "REPAIR_TRANSMISSION_CASE_SEALING", operationName: "Усунення підтікання трансмісії", aliases: ["Ремонт герметичності коробки передач"], positionRule: "VEHICLE", defaultQuantity: 1, source: "STATIC_PART_OPERATION_CATALOG" }],
  TRANSMISSION_OIL_PAN: [{ operationCode: "REPLACE_TRANSMISSION_OIL_PAN", operationName: "Заміна піддона КПП", aliases: ["Заміна піддона коробки передач"], positionRule: "VEHICLE", defaultQuantity: 1, source: "STATIC_PART_OPERATION_CATALOG" }],
  TRANSMISSION_INPUT_SHAFT_SEAL: [{ operationCode: "REPLACE_TRANSMISSION_INPUT_SHAFT_SEAL", operationName: "Заміна сальника первинного валу КПП", aliases: ["Заміна сальника первинного вала"], positionRule: "VEHICLE", defaultQuantity: 1, source: "STATIC_PART_OPERATION_CATALOG" }],
  EXHAUST_MANIFOLD: [{ operationCode: "REPLACE_EXHAUST_MANIFOLD", operationName: "Заміна випускного колектора", aliases: [], positionRule: "VEHICLE", defaultQuantity: 1, source: "STATIC_PART_OPERATION_CATALOG" }],
  EXHAUST_FLEX_PIPE: [{ operationCode: "REPLACE_EXHAUST_FLEX_PIPE", operationName: "Заміна гофри вихлопної системи", aliases: ["Заміна гофри глушника"], positionRule: "VEHICLE", defaultQuantity: 1, source: "STATIC_PART_OPERATION_CATALOG" }],
  EXHAUST_FRONT_PIPE: [{ operationCode: "REPLACE_EXHAUST_FRONT_PIPE", operationName: "Заміна приймальної труби", aliases: ["Заміна передньої труби вихлопу"], positionRule: "VEHICLE", defaultQuantity: 1, source: "STATIC_PART_OPERATION_CATALOG" }],
  CATALYTIC_CONVERTER: [{ operationCode: "REPLACE_CATALYTIC_CONVERTER", operationName: "Заміна каталізатора", aliases: [], positionRule: "VEHICLE", defaultQuantity: 1, source: "STATIC_PART_OPERATION_CATALOG" }],
  DIESEL_PARTICULATE_FILTER: [{ operationCode: "REPLACE_DIESEL_PARTICULATE_FILTER", operationName: "Заміна сажового фільтра / DPF", aliases: ["Заміна DPF"], positionRule: "VEHICLE", defaultQuantity: 1, source: "STATIC_PART_OPERATION_CATALOG" }],
  RESONATOR: [{ operationCode: "REPLACE_RESONATOR", operationName: "Заміна резонатора", aliases: [], positionRule: "VEHICLE", defaultQuantity: 1, source: "STATIC_PART_OPERATION_CATALOG" }],
  MUFFLER: [{ operationCode: "REPLACE_MUFFLER", operationName: "Заміна глушника", aliases: ["Заміна задньої банки"], positionRule: "VEHICLE", defaultQuantity: 1, source: "STATIC_PART_OPERATION_CATALOG" }],
  EXHAUST_HANGER: [{ operationCode: "REPLACE_EXHAUST_HANGER", operationName: "Заміна підвісу вихлопу", aliases: ["Заміна кріплення глушника"], positionRule: "VEHICLE", defaultQuantity: 1, source: "STATIC_PART_OPERATION_CATALOG" }],
  EXHAUST_CLAMP: [{ operationCode: "REPLACE_EXHAUST_CLAMP", operationName: "Заміна хомута вихлопної системи", aliases: ["Заміна з’єднання вихлопу"], positionRule: "VEHICLE", defaultQuantity: 1, source: "STATIC_PART_OPERATION_CATALOG" }],
  EXHAUST_SYSTEM_SEALING: [{ operationCode: "REPAIR_EXHAUST_SYSTEM_SEALING", operationName: "Усунення негерметичності вихлопної системи", aliases: ["Ремонт герметичності вихлопу"], positionRule: "VEHICLE", defaultQuantity: 1, source: "STATIC_PART_OPERATION_CATALOG" }],
};

function axisName(axis: "FRONT" | "REAR" | null) {
  return axis === "FRONT" ? "передн" : axis === "REAR" ? "задн" : "";
}

function operationNameFor(row: StaticOperationRow, code: string, axis: "FRONT" | "REAR" | null, subPosition: "FRONT" | "REAR" | "UPPER" | "LOWER" | null) {
  const prefix = axisName(axis);
  const names: Record<string, string> = {
    SHOCK_ABSORBER: prefix ? "Заміна " + prefix + "ього амортизатора" : row.operationName,
    COIL_SPRING: prefix ? "Заміна " + prefix + "ьої пружини" : row.operationName,
    WHEEL_HUB_BEARING: prefix ? "Заміна " + prefix + "ього ступичного підшипника" : row.operationName,
    STABILIZER_LINK: prefix ? "Заміна " + prefix + "ої стійки стабілізатора" : row.operationName,
    STABILIZER_BUSHING: prefix ? "Заміна втулок " + prefix + "ого стабілізатора" : row.operationName,
    BRAKE_PAD: prefix ? "Заміна " + prefix + "ніх гальмівних колодок" : row.operationName,
    BRAKE_DISC: prefix ? "Заміна " + prefix + "ніх гальмівних дисків" : row.operationName,
    BRAKE_CALIPER: prefix ? "Ремонт / заміна " + prefix + "нього супорта" : row.operationName,
    BRAKE_HOSE: prefix ? "Заміна " + prefix + "нього гальмівного шланга" : row.operationName,
    CONTROL_ARM_BUSHING: subPosition === "FRONT" ? "Заміна переднього сайлентблока переднього важеля" : subPosition === "REAR" ? "Заміна заднього сайлентблока переднього важеля" : row.operationName,
    FRONT_ARM_FRONT_BUSHING: "Заміна переднього сайлентблока переднього важеля",
    FRONT_ARM_REAR_BUSHING: "Заміна заднього сайлентблока переднього важеля",
  };
  return names[code] || row.operationName;
}

export function getPartPackageRule(input: PartOperationInput = {}): PartPackageRule {
  const code = canonicalCodeFromInput(input);
  const base = code ? PACKAGE_RULES[code] : null;
  const axis = axisValue(input.axis) || axisValue(input.position);
  const side = sideValue(input.side) || sideValue(input.position);
  const defaultRule = rule(code, "UNKNOWN", "UNKNOWN", "UNKNOWN", "шт", "Кількість уточнюється", "Для цієї позиції ще не визначено одиницю продажу.", { packageQuantity: 1, priceQuantity: 1 });
  const current = base ? { ...base } : defaultRule;
  const storedSoldAs = clean(input.soldAs, 32).toUpperCase();
  const allowedSoldAs = new Set(["PIECE", "PAIR", "SET", "KIT", "ASSEMBLY", "LITER", "UNKNOWN"]);
  if (allowedSoldAs.has(storedSoldAs)) current.soldAs = storedSoldAs as PartPackageRule["soldAs"];
  let packageQuantity = current.packageQuantity;
  let priceQuantity = current.priceQuantity;
  if (current.coverage === "WHEEL" && current.soldAs !== "LITER" && !side && axis) {
    packageQuantity = 2;
    priceQuantity = 2;
    current.packageLabel = current.packageLabel + " · 2 сторони";
  }
  if (current.soldAs === "SET" && current.coverage === "AXLE") {
    packageQuantity = 1;
    priceQuantity = current.priceBasis === "PER_WHEEL" ? 2 : 1;
  }
  const quantityHint = numberValue(input.quantityHint, 0);
  if (quantityHint > 0 && current.soldAs !== "LITER") {
    packageQuantity = quantityHint;
    if (current.priceBasis === "PER_PIECE") priceQuantity = quantityHint;
  }
  const packageLabel = code === "BRAKE_PAD" ? "1 комплект на вісь · 2 колеса" : current.packageLabel;
  const requiresQuantityInput = current.requiresQuantityInput || current.soldAs === "LITER";
  return { ...current, canonicalCode: code, packageQuantity, priceQuantity, packageLabel, requiresQuantityInput };
}

function explicitPackageName(value: string) {
  return /(?:комплект|набір|set|kit|pair|пар[аи]|axle|2\s*(?:шт|pcs)|4\s*(?:шт|pcs)|за\s*(?:вісь|ось))/iu.test(value);
}

function explicitPerPieceName(value: string) {
  return /(?:за\s*колес|per\s*wheel|поштуч|1\s*(?:шт|pc|piece)|single)/iu.test(value);
}

export function resolveSupplierOfferQuantity(ruleInput: PartPackageRule, offer: Pick<SupplierOffer, "name" | "multiplicity">) {
  const name = clean(offer.name, 320);
  const packageInName = explicitPackageName(name);
  const pieceInName = explicitPerPieceName(name);
  let quantity = ruleInput.priceQuantity ?? ruleInput.packageQuantity ?? 1;
  let priceBasis = ruleInput.priceBasis;
  if (ruleInput.soldAs === "LITER") {
    return { quantity: 1, priceBasis: "PER_LITER" as const, label: "обсяг уточнюється", note: ruleInput.note, packageLabel: ruleInput.packageLabel, multiplicity: offer.multiplicity ?? null };
  }
  if (packageInName && ruleInput.coverage === "AXLE") {
    quantity = ruleInput.packageQuantity ?? 1;
    priceBasis = "PACKAGE";
  } else if (pieceInName && ruleInput.coverage === "AXLE") {
    quantity = 2;
    priceBasis = "PER_WHEEL";
  } else if (ruleInput.soldAs === "SET" && ruleInput.coverage === "AXLE") {
    quantity = ruleInput.priceBasis === "PER_WHEEL" ? 2 : 1;
  }
  const label = ruleInput.canonicalCode === "BRAKE_PAD"
    ? quantity === 1 ? "1 комплект / 2 колеса" : quantity + " од. · 2 колеса"
    : quantity + " " + ruleInput.unitLabel;
  const note = priceBasis === "PER_WHEEL"
    ? "Ціна розрахована за одне колесо та помножена на кількість коліс."
    : ruleInput.note;
  return { quantity, priceBasis, label, note, packageLabel: ruleInput.packageLabel, multiplicity: offer.multiplicity ?? null };
}

export function decorateSupplierOffersWithPackaging(offers: SupplierOffer[], input: PartOperationInput = {}) {
  const partRule = getPartPackageRule(input);
  return offers.map((offer) => {
    const resolved = resolveSupplierOfferQuantity(partRule, offer);
    const purchasePrice = offer.purchasePrice == null ? null : Math.round(offer.purchasePrice * resolved.quantity * 100) / 100;
    const sellPrice = offer.sellPrice == null ? null : Math.round(offer.sellPrice * resolved.quantity * 100) / 100;
    return {
      ...offer,
      catalogQuantity: resolved.quantity,
      catalogPriceBasis: resolved.priceBasis,
      catalogQuantityLabel: resolved.label,
      catalogPackageLabel: resolved.packageLabel,
      catalogPurchaseTotal: purchasePrice,
      catalogSellTotal: sellPrice,
      catalogPackagingNote: resolved.note,
    };
  });
}

const POSITION_RULE_LABELS: Record<OperationPositionRule, string> = {
  SIDE: "за сторону",
  AXLE: "за вісь",
  VEHICLE: "за автомобіль",
};

function defaultOperationsForCode(code: string): StaticOperationRow[] {
  const definition = listPartTerminology().find((item) => item.code === code);
  const name = definition?.canonicalName || code;
  const lowerName = name.charAt(0).toLocaleLowerCase("uk-UA") + name.slice(1);
  return [{
    operationCode: "REPLACE_" + code,
    operationName: "Заміна " + lowerName,
    aliases: [],
    positionRule: "VEHICLE",
    defaultQuantity: 1,
    source: "STATIC_PART_OPERATION_CATALOG",
  }];
}

export function listPartOperationDefinitions(input: PartOperationInput = {}): PartOperationDefinition[] {
  const code = canonicalCodeFromInput(input);
  if (!code) return [];
  const axis = axisValue(input.axis) || axisValue(input.position);
  const subPosition = subPositionValue(input.subPosition) || subPositionValue(input.partName);
  const rows = STATIC_OPERATIONS[code] || defaultOperationsForCode(code);
  const scopedRows = rows.filter((row) => {
    if (!axis || !["BRAKE_PAD", "BRAKE_DISC"].includes(code)) return true;
    const operationCode = row.operationCode.toUpperCase();
    if (operationCode.includes("FRONT")) return axis === "FRONT";
    if (operationCode.includes("REAR")) return axis === "REAR";
    return true;
  });
  return scopedRows.map((row) => ({
    operationCode: row.operationCode,
    operationName: operationNameFor(row, code, axis, subPosition),
    aliases: unique([...row.aliases, row.operationName]),
    positionRule: row.positionRule,
    defaultQuantity: row.defaultQuantity,
    source: row.source,
  }));
}

function scoreCatalogItem(item: { displayName: string; internalName: string; nameOperation: string | null; searchAliases: string[]; code: string | null }, operation: PartOperationDefinition) {
  const targets = unique([operation.operationName, ...operation.aliases].map(normalizePartTerminology));
  const sources = [item.displayName, item.internalName, item.nameOperation || "", item.code || "", ...item.searchAliases].map(normalizePartTerminology);
  let score = 0;
  for (const target of targets) {
    if (!target) continue;
    if (sources.includes(target)) score = Math.max(score, 1000);
    const tokens = target.split(" ").filter((token) => token.length >= 3 && !["заміна", "ремонт", "заміни", "замена"].includes(token));
    const overlap = tokens.filter((token) => sources.some((source) => source.includes(token))).length;
    if (tokens.length && overlap === tokens.length) score = Math.max(score, 700 + Math.min(200, tokens.length * 8));
    if (sources.some((source) => source.includes(target))) score = Math.max(score, 850);
  }
  return score;
}

type ServiceCatalogCandidate = {
  id: string;
  code: string | null;
  displayName: string;
  internalName: string;
  nameOperation: string | null;
  searchAliases: string[];
  basePrice: unknown;
  currency: string;
  vehicleCoefficientEnabled: boolean;
  normMinutes: number | null;
};

async function loadServiceCatalogCandidates(prisma: any) {
  return prisma.serviceCatalogItem.findMany({
    where: { isActive: true, showToOperator: true, reviewStatus: "READY", itemType: "LABOR", basePrice: { not: null } },
    select: { id: true, code: true, displayName: true, internalName: true, nameOperation: true, searchAliases: true, basePrice: true, currency: true, vehicleCoefficientEnabled: true, normMinutes: true },
    take: 1000,
  }) as Promise<ServiceCatalogCandidate[]>;
}

function selectCatalogItem(candidates: ServiceCatalogCandidate[], operation: PartOperationDefinition, linkedId?: string | null) {
  if (linkedId) {
    const linked = candidates.find((item) => item.id === linkedId);
    if (linked) return linked;
  }
  const ranked = candidates.map((item) => ({ item, score: scoreCatalogItem(item, operation) })).filter((row) => row.score >= 700).sort((a, b) => b.score - a.score || a.item.displayName.localeCompare(b.item.displayName, "uk"));
  return ranked[0]?.item || null;
}

function vehicleInput(value: unknown): VehicleTechnicalInput | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  return {
    make: clean(item.make ?? item.brand, 100) || undefined,
    model: clean(item.model, 100) || undefined,
    year: item.year == null ? undefined : String(item.year),
    engine: clean(item.engine ?? item.engineName, 160) || undefined,
    engineVolume: item.engineVolume == null && item.engineVolumeCm3 == null ? undefined : String(item.engineVolume ?? item.engineVolumeCm3),
    fuelType: clean(item.fuelType, 64) || undefined,
    bodyType: clean(item.bodyType, 64) || undefined,
    grossWeight: item.grossWeight == null && item.grossWeightKg == null ? undefined : String(item.grossWeight ?? item.grossWeightKg),
    driveType: clean(item.driveType, 64) || undefined,
    vehicleType: clean(item.vehicleType, 64) || undefined,
  };
}

function positionLabel(ruleName: OperationPositionRule, axis: "FRONT" | "REAR" | null, side: "LEFT" | "RIGHT" | null) {
  const axisLabel = axis === "FRONT" ? "передня вісь" : axis === "REAR" ? "задня вісь" : "";
  const sideLabel = side === "LEFT" ? "ліва сторона" : side === "RIGHT" ? "права сторона" : "";
  if (ruleName === "SIDE") return [axisLabel, sideLabel].filter(Boolean).join(" · ") || "конкретна сторона";
  if (ruleName === "AXLE") return axisLabel || "конкретна вісь";
  return "автомобіль";
}

export async function listRelatedPartOperations(input: PartOperationInput & { vehicle?: unknown; workOrderId?: string | null; findingId?: string | null }) {
  let code = canonicalCodeFromInput(input);
  const axis = axisValue(input.axis) || axisValue(input.position);
  const side = sideValue(input.side) || sideValue(input.position);
  const subPosition = subPositionValue(input.subPosition) || subPositionValue(input.partName);
  const partRule = getPartPackageRule({ ...input, canonicalCode: code, axis, side, subPosition });
  let prisma: any = null;
  let article: any = null;
  let dbOperations: any[] = [];
  let candidates: ServiceCatalogCandidate[] = [];
  let existingLine: any = null;

  try {
    prisma = getPrisma();
    if (input.genericArticleId) {
      article = await prisma.genericArticle.findUnique({
        where: { id: clean(input.genericArticleId, 160) },
        select: { id: true, code: true, name: true, soldAs: true, quantityPerVehicle: true, operations: { where: { status: CatalogEntityStatus.ACTIVE }, orderBy: { updatedAt: "desc" } } },
      });
    }
    if (!article && code) {
      article = await prisma.genericArticle.findFirst({
        where: { code, status: { in: [CatalogEntityStatus.ACTIVE, CatalogEntityStatus.DRAFT] } },
        select: { id: true, code: true, name: true, soldAs: true, quantityPerVehicle: true, operations: { where: { status: CatalogEntityStatus.ACTIVE }, orderBy: { updatedAt: "desc" } } },
      });
    }
    if (article?.code) {
      code = normalizeCode(article.code);
      Object.assign(partRule, getPartPackageRule({ ...input, canonicalCode: code, axis, side, subPosition }));
    }
    if (article?.soldAs) {
      const storedSoldAs = String(article.soldAs).toUpperCase();
      if (storedSoldAs !== "UNKNOWN") Object.assign(partRule, getPartPackageRule({ ...input, canonicalCode: article.code || code, soldAs: storedSoldAs, axis, side, subPosition }));
    }
    if (article?.operations?.length) dbOperations = article.operations;
    candidates = await loadServiceCatalogCandidates(prisma);
    if (input.workOrderId && input.findingId) {
      existingLine = await prisma.workOrderLine.findFirst({
        where: { workOrderId: clean(input.workOrderId, 160), sourceEntityId: clean(input.findingId, 160) + ":LABOR", status: { not: "CANCELLED" } },
        select: { id: true, plannedQuantity: true, plannedUnitPrice: true },
      });
    }
  } catch (error) {
    console.warn("Related part operations catalog unavailable; returning static relations", error instanceof Error ? error.message : "unknown error");
  }

  const staticOperations = listPartOperationDefinitions({ ...input, canonicalCode: code, axis, side, subPosition });
  const operationsByCode = new Map<string, { definition?: PartOperationDefinition; relation?: any }>();
  for (const definition of staticOperations) operationsByCode.set(definition.operationCode, { definition });
  for (const relation of dbOperations) {
    const existing = operationsByCode.get(relation.operationCode);
    operationsByCode.set(relation.operationCode, { definition: existing?.definition, relation });
  }

  const operations = await Promise.all([...operationsByCode.values()].map(async ({ definition, relation }) => {
    const operation: PartOperationDefinition = definition || {
      operationCode: relation.operationCode,
      operationName: relation.operationName,
      aliases: [],
      positionRule: relation.positionRule === "SIDE" || relation.positionRule === "AXLE" ? relation.positionRule : "VEHICLE",
      defaultQuantity: Math.max(1, numberValue(relation.defaultQuantity, 1)),
      source: "STATIC_PART_OPERATION_CATALOG",
    };
    const catalogItem = selectCatalogItem(candidates, operation, relation?.serviceCatalogItemId);
    const quantity = Math.max(1, numberValue(relation?.defaultQuantity, operation.defaultQuantity));
    const basePrice = catalogItem?.basePrice == null ? null : numberValue(catalogItem.basePrice, 0);
    let adjustedPrice = basePrice == null ? null : Math.round(basePrice * quantity * 100) / 100;
    let pricingNote: string | null = null;
    const technicalVehicle = vehicleInput(input.vehicle);
    if (catalogItem && basePrice != null && technicalVehicle) {
      try {
        const pricing = await calculateCatalogLaborPrice({ basePrice, vehicle: technicalVehicle, quantity, vehicleCoefficientEnabled: catalogItem.vehicleCoefficientEnabled, replacementOperation: true });
        adjustedPrice = pricing.total;
        pricingNote = pricing.coefficientApplied && pricing.coefficient !== 1 ? "Коефіцієнт авто " + pricing.coefficient + " застосовано." : null;
      } catch {
        pricingNote = "Ціну взято без коефіцієнта авто.";
      }
    }
    const publicCatalogItem = catalogItem ? {
      id: catalogItem.id,
      code: catalogItem.code,
      displayName: catalogItem.displayName,
      internalName: catalogItem.internalName,
      basePrice,
      currency: catalogItem.currency || "UAH",
      vehicleCoefficientEnabled: catalogItem.vehicleCoefficientEnabled,
      normMinutes: catalogItem.normMinutes,
    } : null;
    return {
      id: relation?.id || identity("STATIC_OPERATION", code || "", operation.operationCode),
      relationId: relation?.id || null,
      operationCode: operation.operationCode,
      name: relation?.operationName || operation.operationName,
      serviceCatalogItemId: catalogItem?.id || relation?.serviceCatalogItemId || null,
      serviceCode: catalogItem?.code || null,
      basePrice,
      adjustedPrice,
      currency: catalogItem?.currency || "UAH",
      quantity,
      quantityLabel: quantity + " " + positionLabel(operation.positionRule, axis, side),
      positionRule: operation.positionRule,
      positionRuleLabel: positionLabel(operation.positionRule, axis, side),
      normMinutes: relation?.normMinutesOverride ?? catalogItem?.normMinutes ?? null,
      mapped: Boolean(catalogItem),
      status: catalogItem ? "MAPPED" as const : "NOT_IN_WORK_CATALOG" as const,
      confidence: catalogItem ? relation ? Math.max(80, numberValue(relation.confidence, 0)) : 82 : 0,
      source: relation?.source || operation.source,
      note: [partRule.note, pricingNote].filter(Boolean).join(" ") || null,
      existingLineId: existingLine?.id || null,
      existingQuantity: existingLine ? numberValue(existingLine.plannedQuantity, 0) : null,
      existingTotal: existingLine ? numberValue(existingLine.plannedUnitPrice, 0) * numberValue(existingLine.plannedQuantity, 1) : null,
      catalogItem: publicCatalogItem,
    } satisfies RelatedPartOperation;
  }));
  return {
    part: {
      genericArticleId: article?.id || input.genericArticleId || null,
      canonicalCode: article?.code || code,
      canonicalName: article?.name || resolvePartTerminology(input).definition?.canonicalName || clean(input.partName) || "Деталь",
      axis,
      side,
      subPosition,
    },
    packaging: partRule,
    operations: operations.sort((a, b) => Number(b.mapped) - Number(a.mapped) || a.name.localeCompare(b.name, "uk")),
  };
}

export async function findReplacementOperation(input: PartOperationInput & { vehicle?: unknown }) {
  const result = await listRelatedPartOperations(input);
  return result.operations.find((operation) => operation.mapped) || result.operations[0] || null;
}

export async function seedPartOperationCatalog() {
  const prisma = getPrisma();
  const terminology = listPartTerminology();
  let articles = 0;
  let operations = 0;
  let linkedOperations = 0;
  let candidates: ServiceCatalogCandidate[] = [];
  try { candidates = await loadServiceCatalogCandidates(prisma); } catch { candidates = []; }
  for (const definition of terminology) {
    const partRule = getPartPackageRule({ canonicalCode: definition.code });
    let article = await prisma.genericArticle.findFirst({ where: { code: definition.code } });
    if (!article) {
      article = await prisma.genericArticle.create({
        data: { code: definition.code, name: definition.canonicalName, slug: definition.slug, status: CatalogEntityStatus.ACTIVE, reviewStatus: PartCatalogReviewStatus.APPROVED, soldAs: partRule.soldAs as PartSoldAs, quantityPerVehicle: partRule.packageQuantity ?? 1, requiresVin: true, confidence: 100 },
      });
    } else {
      article = await prisma.genericArticle.update({
        where: { id: article.id },
        data: { name: definition.canonicalName, status: CatalogEntityStatus.ACTIVE, reviewStatus: PartCatalogReviewStatus.APPROVED, soldAs: partRule.soldAs as PartSoldAs, quantityPerVehicle: partRule.packageQuantity ?? 1, requiresVin: true, confidence: Math.max(100, article.confidence || 0) },
      });
    }
    articles += 1;
    for (const operation of listPartOperationDefinitions({ canonicalCode: definition.code })) {
      const key = identity("STATIC_OPERATION", article.id, operation.operationCode);
      const current = await prisma.genericArticleOperation.findUnique({ where: { identityKey: key } });
      if (current && current.source !== "STATIC_PART_OPERATION_CATALOG") continue;
      const serviceItem = selectCatalogItem(candidates, operation);
      const data = {
        genericArticleId: article.id,
        operationCode: operation.operationCode,
        operationName: operation.operationName,
        serviceCatalogItemId: serviceItem?.id || null,
        positionRule: operation.positionRule,
        defaultQuantity: operation.defaultQuantity,
        status: CatalogEntityStatus.ACTIVE,
        source: operation.source,
        sourceVersion: "v2",
        notes: partRule.note,
        identityKey: key,
      };
      if (current) await prisma.genericArticleOperation.update({ where: { id: current.id }, data });
      else await prisma.genericArticleOperation.create({ data });
      operations += 1;
      if (serviceItem) linkedOperations += 1;
    }
  }
  return { articles, operations, linkedOperations, sourceVersion: "v2" };
}
