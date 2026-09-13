import { getPrisma } from "@/src/lib/prisma";
import { renderXlsx } from "@/src/services/financial-export.service";
import { bodySideLabel, calculatorOperationLabel } from "@/src/services/service-catalog-name-builder.service";

const MS_MASTER_HEADERS = [
  "Послуга",
  "Назва",
  "Назва (друк)",
  "Категорія послуг",
  "Ціна",
  "Тривалість роботи механіка (хв.)",
  "Кількість по замовчуванню при додаванні в Н/З",
  "Гарантійний пробіг (км)",
  "Гарантійний термін (днів)",
  "Категорія для зарплат",
  "Тип нарахування зарплат",
  "Назва частина авто",
  "Сторона",
  "Послуги калькулятора",
  "Активний",
  "Показувати на Landing",
];

function decimal(value: unknown) {
  if (value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export async function buildActiveServiceCatalogExport() {
  const prisma = getPrisma();
  const items = await prisma.serviceCatalogItem.findMany({
    where: { isActive: true },
    orderBy: [{ category: { sortOrder: "asc" } }, { displayName: "asc" }],
    select: {
      externalServiceId: true,
      code: true,
      internalName: true,
      displayName: true,
      sourceCategory: true,
      category: { select: { name: true } },
      basePrice: true,
      normMinutes: true,
      defaultQuantity: true,
      warrantyKm: true,
      warrantyDays: true,
      payrollCategory: true,
      payrollType: true,
      bodyPart: true,
      bodySide: true,
      calculatorOperation: true,
      showOnLanding: true,
    },
  });

  const rows = [
    MS_MASTER_HEADERS,
    ...items.map((item) => [
      item.externalServiceId || item.code || "",
      item.internalName,
      item.displayName,
      item.sourceCategory || item.category?.name || "",
      decimal(item.basePrice),
      item.normMinutes,
      decimal(item.defaultQuantity),
      item.warrantyKm,
      item.warrantyDays,
      item.payrollCategory || "",
      item.payrollType === "PERCENT_NORM_HOURS" ? "Відсоток від норми часу" : "",
      item.bodyPart || "",
      bodySideLabel(item.bodySide),
      calculatorOperationLabel(item.calculatorOperation),
      "Так",
      item.showOnLanding ? "Так" : "Ні",
    ]),
  ];

  return { bytes: renderXlsx("Прайс робіт", rows), count: items.length };
}
