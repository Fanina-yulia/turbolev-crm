export type DiagnosticSeedItem = { code: string; name: string; position?: string; unit?: string; work?: string; part?: string };
export type DiagnosticSeedSection = { code: string; name: string; items: DiagnosticSeedItem[] };
export type DiagnosticTemplateSeed = { code: string; name: string; description: string; isDefault?: boolean; sortOrder: number; sections: DiagnosticSeedSection[] };

export const DIAGNOSTIC_TEMPLATE_SEEDS: DiagnosticTemplateSeed[] = [
  { code:"BASIC_INSPECTION", name:"Базовий комплексний огляд", description:"Швидкий обов’язковий огляд перед поглибленою діагностикою.", isDefault:true, sortOrder:10, sections:[
    { code:"VISUAL", name:"Візуальний огляд", items:[{code:"LEAKS",name:"Підтікання технічних рідин"},{code:"BELTS_HOSES",name:"Ремені та патрубки"},{code:"LIGHTS",name:"Зовнішнє освітлення"}] },
    { code:"FLUIDS", name:"Рідини", items:[{code:"ENGINE_OIL",name:"Рівень/стан моторної оливи"},{code:"COOLANT",name:"Охолоджувальна рідина"},{code:"BRAKE_FLUID",name:"Гальмівна рідина",work:"Заміна гальмівної рідини"}] },
    { code:"TYRES", name:"Шини та колеса", items:[{code:"TYRE_FL",name:"Передня ліва шина",position:"Передня ліва",unit:"мм"},{code:"TYRE_FR",name:"Передня права шина",position:"Передня права",unit:"мм"},{code:"TYRE_RL",name:"Задня ліва шина",position:"Задня ліва",unit:"мм"},{code:"TYRE_RR",name:"Задня права шина",position:"Задня права",unit:"мм"}] },
    { code:"BATTERY", name:"АКБ / зарядка", items:[{code:"BATTERY_VOLTAGE",name:"Напруга АКБ",unit:"V"},{code:"CHARGING",name:"Напруга заряджання",unit:"V"}] },
  ]},
  { code:"SUSPENSION", name:"Комплексна діагностика ходової", description:"Передня/задня ходова, рульове керування та стабілізація.", sortOrder:20, sections:[
    { code:"FRONT", name:"Передня ходова", items:[
      {code:"SHOCK_FL",name:"Лівий амортизатор",position:"Передній лівий",work:"Заміна переднього амортизатора",part:"Амортизатор передній"},{code:"SHOCK_FR",name:"Правий амортизатор",position:"Передній правий",work:"Заміна переднього амортизатора",part:"Амортизатор передній"},{code:"BALL_FL",name:"Ліва кульова опора",position:"Передня ліва",work:"Заміна кульової опори",part:"Кульова опора"},{code:"BALL_FR",name:"Права кульова опора",position:"Передня права",work:"Заміна кульової опори",part:"Кульова опора"},{code:"STAB_LINK_FL",name:"Ліва стійка стабілізатора",position:"Передня ліва",work:"Заміна стійки стабілізатора",part:"Стійка стабілізатора"},{code:"STAB_LINK_FR",name:"Права стійка стабілізатора",position:"Передня права",work:"Заміна стійки стабілізатора",part:"Стійка стабілізатора"},{code:"STAB_BUSH",name:"Втулки стабілізатора",work:"Заміна втулок стабілізатора",part:"Втулки стабілізатора"}
    ]},
    { code:"STEERING", name:"Рульове керування", items:[{code:"TIE_FL",name:"Лівий рульовий наконечник",position:"Передній лівий",work:"Заміна рульового наконечника",part:"Рульовий наконечник"},{code:"TIE_FR",name:"Правий рульовий наконечник",position:"Передній правий",work:"Заміна рульового наконечника",part:"Рульовий наконечник"},{code:"RACK",name:"Рульова рейка",work:"Ремонт / заміна рульової рейки",part:"Рульова рейка"}] },
    { code:"REAR", name:"Задня ходова", items:[{code:"SHOCK_RL",name:"Лівий задній амортизатор",position:"Задній лівий",work:"Заміна заднього амортизатора",part:"Амортизатор задній"},{code:"SHOCK_RR",name:"Правий задній амортизатор",position:"Задній правий",work:"Заміна заднього амортизатора",part:"Амортизатор задній"},{code:"BUSH_REAR",name:"Сайлентблоки задньої підвіски",work:"Заміна сайлентблока",part:"Сайлентблок"}] },
  ]},
  { code:"BRAKES", name:"Гальмівна система", description:"Колодки, диски, шланги та гальмівна рідина.", sortOrder:30, sections:[
    { code:"FRONT_BRAKES", name:"Передні гальма", items:[{code:"PADS_FRONT",name:"Передні колодки",unit:"мм",work:"Заміна передніх гальмівних колодок",part:"Передні гальмівні колодки"},{code:"DISC_FL",name:"Лівий передній диск",position:"Передній лівий",unit:"мм",work:"Заміна передніх гальмівних дисків",part:"Передній гальмівний диск"},{code:"DISC_FR",name:"Правий передній диск",position:"Передній правий",unit:"мм",work:"Заміна передніх гальмівних дисків",part:"Передній гальмівний диск"}] },
    { code:"REAR_BRAKES", name:"Задні гальма", items:[{code:"PADS_REAR",name:"Задні колодки",unit:"мм",work:"Заміна задніх гальмівних колодок",part:"Задні гальмівні колодки"},{code:"DISC_REAR",name:"Задні диски / барабани",unit:"мм",work:"Ремонт задньої гальмівної системи"}] },
    { code:"HYDRAULICS", name:"Гідравліка", items:[{code:"HOSES",name:"Гальмівні шланги",part:"Гальмівний шланг"},{code:"FLUID",name:"Стан гальмівної рідини",work:"Заміна гальмівної рідини"}] },
  ]},
  { code:"COMPUTER_DIAGNOSTICS", name:"Комп’ютерна діагностика", description:"Зчитування помилок, контрольні параметри та електроживлення.", sortOrder:40, sections:[
    { code:"DTC", name:"Коди несправностей", items:[{code:"ENGINE_DTC",name:"ЕБУ двигуна"},{code:"ABS_DTC",name:"ABS / ESP"},{code:"AIRBAG_DTC",name:"SRS / Airbag"},{code:"BODY_DTC",name:"Кузовна електроніка"}] },
    { code:"LIVE", name:"Контрольні параметри", items:[{code:"BATTERY",name:"Напруга бортмережі",unit:"V"},{code:"CHARGE",name:"Напруга генератора",unit:"V"},{code:"LIVE_DATA",name:"Ключові live-data параметри"}] },
  ]},
];
