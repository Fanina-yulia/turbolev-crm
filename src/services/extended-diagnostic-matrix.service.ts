import { getPrisma } from "@/src/lib/prisma";

type ExtraItem = {
  code: string;
  name: string;
  position?: string;
  work?: string;
  part?: string;
};

type ExtraSection = {
  code: string;
  name: string;
  items: ExtraItem[];
};

const EXTRA_MATRIX_SECTIONS: ExtraSection[] = [
  {
    code: "ENGINE_LEAKS",
    name: "Двигун — підтікання",
    items: [
      { code: "ENGINE_LEAK_GENERAL", name: "Двигун — загальна герметичність", work: "Усунення підтікання двигуна" },
      { code: "VALVE_COVER_LEAK", name: "Клапанна кришка", work: "Усунення підтікання клапанної кришки" },
      { code: "ENGINE_PAN_LEAK", name: "Піддон двигуна", work: "Усунення підтікання піддона двигуна" },
      { code: "CRANK_SEAL_FRONT", name: "Передній сальник колінвала", work: "Заміна переднього сальника колінвала", part: "Сальник колінвала передній" },
      { code: "CRANK_SEAL_REAR", name: "Задній сальник колінвала", work: "Заміна заднього сальника колінвала", part: "Сальник колінвала задній" },
      { code: "COOLING_LEAK", name: "Система охолодження / патрубки", work: "Усунення підтікання системи охолодження" },
    ],
  },
  {
    code: "TRANSMISSION_LEAKS",
    name: "КПП / трансмісія — підтікання",
    items: [
      { code: "GEARBOX_BODY_LEAK", name: "Корпус / стики КПП", work: "Усунення підтікання КПП" },
      { code: "GEARBOX_PAN_LEAK", name: "Піддон КПП", work: "Усунення підтікання піддона КПП" },
      { code: "GEARBOX_INPUT_SEAL", name: "Сальник первинного валу КПП", work: "Заміна сальника первинного валу КПП", part: "Сальник первинного валу КПП" },
    ],
  },
  {
    code: "AXLE_SEALS_FRONT",
    name: "Сальники півосей — передня вісь",
    items: [
      { code: "AXLE_SEAL_FL", name: "Лівий сальник півосі", position: "Передня ліва", work: "Заміна переднього лівого сальника півосі", part: "Сальник півосі" },
      { code: "AXLE_SEAL_FR", name: "Правий сальник півосі", position: "Передня права", work: "Заміна переднього правого сальника півосі", part: "Сальник півосі" },
    ],
  },
  {
    code: "AXLE_SEALS_REAR",
    name: "Сальники півосей — задня вісь",
    items: [
      { code: "AXLE_SEAL_RL", name: "Лівий сальник півосі", position: "Задня ліва", work: "Заміна заднього лівого сальника півосі", part: "Сальник півосі" },
      { code: "AXLE_SEAL_RR", name: "Правий сальник півосі", position: "Задня права", work: "Заміна заднього правого сальника півосі", part: "Сальник півосі" },
    ],
  },
  {
    code: "EXHAUST",
    name: "Вихлопна система",
    items: [
      { code: "EXHAUST_MANIFOLD", name: "Випускний колектор", work: "Ремонт / заміна випускного колектора" },
      { code: "EXHAUST_FLEX", name: "Гофра", work: "Заміна гофри вихлопної системи", part: "Гофра вихлопної системи" },
      { code: "EXHAUST_FRONT_PIPE", name: "Приймальна труба", work: "Ремонт / заміна приймальної труби" },
      { code: "CATALYST", name: "Каталізатор", work: "Діагностика / ремонт каталізатора" },
      { code: "DPF", name: "Сажовий фільтр / DPF", work: "Діагностика / обслуговування DPF" },
      { code: "RESONATOR", name: "Резонатор", work: "Ремонт / заміна резонатора" },
      { code: "MUFFLER", name: "Глушник", work: "Ремонт / заміна глушника" },
      { code: "EXHAUST_HANGERS", name: "Підвіси / кріплення", work: "Заміна підвісів вихлопної системи" },
      { code: "EXHAUST_JOINTS", name: "З’єднання / хомути", work: "Ремонт з’єднань вихлопної системи" },
      { code: "EXHAUST_TIGHTNESS", name: "Герметичність системи", work: "Усунення негерметичності вихлопної системи" },
    ],
  },
  {
    code: "FLUIDS_EXTENDED",
    name: "Технічні рідини",
    items: [
      { code: "ENGINE_OIL_LEVEL", name: "Рівень моторної оливи" },
      { code: "ENGINE_OIL_CONDITION", name: "Стан моторної оливи", work: "Заміна моторної оливи" },
      { code: "COOLANT_LEVEL", name: "Рівень охолоджувальної рідини" },
      { code: "COOLANT_CONDITION", name: "Стан охолоджувальної рідини", work: "Заміна охолоджувальної рідини" },
      { code: "BRAKE_FLUID_LEVEL", name: "Рівень гальмівної рідини" },
      { code: "BRAKE_FLUID_CONDITION", name: "Стан гальмівної рідини", work: "Заміна гальмівної рідини" },
      { code: "POWER_STEERING_LEVEL", name: "Рівень рідини ГПК" },
      { code: "POWER_STEERING_CONDITION", name: "Стан рідини ГПК", work: "Заміна рідини ГПК" },
      { code: "GEARBOX_OIL_LEVEL", name: "Рівень оливи КПП" },
      { code: "GEARBOX_OIL_CONDITION", name: "Стан оливи КПП", work: "Заміна оливи КПП" },
    ],
  },
];

export async function ensureExtendedDiagnosticMatrix(diagnosticRequestId: string) {
  const prisma = getPrisma();
  const template = await prisma.diagnosticTemplate.findUnique({ where: { code: "SUSPENSION_MATRIX" } });
  if (!template) return;

  const itemIds: string[] = [];
  for (let sectionIndex = 0; sectionIndex < EXTRA_MATRIX_SECTIONS.length; sectionIndex += 1) {
    const seed = EXTRA_MATRIX_SECTIONS[sectionIndex];
    const section = await prisma.diagnosticTemplateSection.upsert({
      where: { templateId_code: { templateId: template.id, code: seed.code } },
      create: {
        templateId: template.id,
        code: seed.code,
        name: seed.name,
        sortOrder: 70 + sectionIndex * 10,
      },
      update: { name: seed.name, sortOrder: 70 + sectionIndex * 10 },
    });

    for (let itemIndex = 0; itemIndex < seed.items.length; itemIndex += 1) {
      const item = seed.items[itemIndex];
      const saved = await prisma.diagnosticTemplateItem.upsert({
        where: { sectionId_code: { sectionId: section.id, code: item.code } },
        create: {
          sectionId: section.id,
          code: item.code,
          name: item.name,
          position: item.position || null,
          suggestedWorkName: item.work || null,
          suggestedPartName: item.part || null,
          sortOrder: (itemIndex + 1) * 10,
        },
        update: {
          name: item.name,
          position: item.position || null,
          suggestedWorkName: item.work || null,
          suggestedPartName: item.part || null,
          sortOrder: (itemIndex + 1) * 10,
        },
      });
      itemIds.push(saved.id);
    }
  }

  const inspection = await prisma.diagnosticInspection.findUnique({
    where: {
      diagnosticRequestId_templateId: {
        diagnosticRequestId,
        templateId: template.id,
      },
    },
    select: { id: true },
  });
  if (!inspection || !itemIds.length) return;

  await prisma.diagnosticCheck.createMany({
    data: itemIds.map((templateItemId) => ({ inspectionId: inspection.id, templateItemId })),
    skipDuplicates: true,
  });
}
