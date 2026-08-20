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
  { code:"SUSPENSION", name:"Комплексна діагностика ходової", description:"Матриця ходової: передня/задня вісь, ліва/права сторона, підвіска, рульове, привід і гальма.", sortOrder:20, sections:[
    { code:"FRONT_SUSPENSION", name:"Передня підвіска", items:[
      {code:"SHOCK_FL",name:"Лівий амортизатор",position:"Передня ліва",work:"Заміна переднього амортизатора",part:"Амортизатор передній"},
      {code:"SHOCK_FR",name:"Правий амортизатор",position:"Передня права",work:"Заміна переднього амортизатора",part:"Амортизатор передній"},
      {code:"SPRING_FL",name:"Ліва пружина",position:"Передня ліва",work:"Заміна передньої пружини",part:"Пружина передня"},
      {code:"SPRING_FR",name:"Права пружина",position:"Передня права",work:"Заміна передньої пружини",part:"Пружина передня"},
      {code:"MOUNT_FL",name:"Ліва опора амортизатора",position:"Передня ліва",work:"Заміна опори амортизатора",part:"Опора амортизатора"},
      {code:"MOUNT_FR",name:"Права опора амортизатора",position:"Передня права",work:"Заміна опори амортизатора",part:"Опора амортизатора"},
      {code:"BALL_FL",name:"Ліва кульова опора",position:"Передня ліва",work:"Заміна кульової опори",part:"Кульова опора"},
      {code:"BALL_FR",name:"Права кульова опора",position:"Передня права",work:"Заміна кульової опори",part:"Кульова опора"},
      {code:"ARM_FL",name:"Лівий важіль",position:"Передня ліва",work:"Заміна переднього важеля",part:"Важіль передній"},
      {code:"ARM_FR",name:"Правий важіль",position:"Передня права",work:"Заміна переднього важеля",part:"Важіль передній"},
      {code:"BUSH_FRONT_FL",name:"Лівий передній сайлентблок важеля",position:"Передня ліва",work:"Заміна сайлентблока важеля",part:"Сайлентблок важеля"},
      {code:"BUSH_FRONT_FR",name:"Правий передній сайлентблок важеля",position:"Передня права",work:"Заміна сайлентблока важеля",part:"Сайлентблок важеля"},
      {code:"BUSH_REAR_FL",name:"Лівий задній сайлентблок важеля",position:"Передня ліва",work:"Заміна сайлентблока важеля",part:"Сайлентблок важеля"},
      {code:"BUSH_REAR_FR",name:"Правий задній сайлентблок важеля",position:"Передня права",work:"Заміна сайлентблока важеля",part:"Сайлентблок важеля"},
      {code:"STAB_LINK_FL",name:"Ліва стійка стабілізатора",position:"Передня ліва",work:"Заміна стійки стабілізатора",part:"Стійка стабілізатора"},
      {code:"STAB_LINK_FR",name:"Права стійка стабілізатора",position:"Передня права",work:"Заміна стійки стабілізатора",part:"Стійка стабілізатора"},
      {code:"BEARING_FL",name:"Лівий ступичний підшипник",position:"Передня ліва",work:"Заміна переднього ступичного підшипника",part:"Ступичний підшипник"},
      {code:"BEARING_FR",name:"Правий ступичний підшипник",position:"Передня права",work:"Заміна переднього ступичного підшипника",part:"Ступичний підшипник"},
      {code:"STAB_BUSH_FRONT",name:"Втулки переднього стабілізатора",work:"Заміна втулок стабілізатора",part:"Втулки стабілізатора"}
    ]},
    { code:"FRONT_STEERING", name:"Переднє рульове", items:[
      {code:"TIE_END_FL",name:"Лівий рульовий наконечник",position:"Передня ліва",work:"Заміна рульового наконечника",part:"Рульовий наконечник"},
      {code:"TIE_END_FR",name:"Правий рульовий наконечник",position:"Передня права",work:"Заміна рульового наконечника",part:"Рульовий наконечник"},
      {code:"TIE_ROD_FL",name:"Ліва рульова тяга",position:"Передня ліва",work:"Заміна рульової тяги",part:"Рульова тяга"},
      {code:"TIE_ROD_FR",name:"Права рульова тяга",position:"Передня права",work:"Заміна рульової тяги",part:"Рульова тяга"},
      {code:"RACK_BOOT_FL",name:"Лівий пильник рульової рейки",position:"Передня ліва",work:"Заміна пильника рульової рейки",part:"Пильник рульової рейки"},
      {code:"RACK_BOOT_FR",name:"Правий пильник рульової рейки",position:"Передня права",work:"Заміна пильника рульової рейки",part:"Пильник рульової рейки"},
      {code:"RACK",name:"Рульова рейка",work:"Ремонт / заміна рульової рейки",part:"Рульова рейка"}
    ]},
    { code:"FRONT_DRIVE", name:"Передній привід", items:[
      {code:"CV_OUTER_FL",name:"Лівий зовнішній ШРУС",position:"Передня ліва",work:"Заміна зовнішнього ШРУСа",part:"ШРУС зовнішній"},
      {code:"CV_OUTER_FR",name:"Правий зовнішній ШРУС",position:"Передня права",work:"Заміна зовнішнього ШРУСа",part:"ШРУС зовнішній"},
      {code:"CV_INNER_FL",name:"Лівий внутрішній ШРУС",position:"Передня ліва",work:"Заміна внутрішнього ШРУСа",part:"ШРУС внутрішній"},
      {code:"CV_INNER_FR",name:"Правий внутрішній ШРУС",position:"Передня права",work:"Заміна внутрішнього ШРУСа",part:"ШРУС внутрішній"},
      {code:"CV_BOOT_FL",name:"Лівий пильник ШРУСа",position:"Передня ліва",work:"Заміна пильника ШРУСа",part:"Пильник ШРУСа"},
      {code:"CV_BOOT_FR",name:"Правий пильник ШРУСа",position:"Передня права",work:"Заміна пильника ШРУСа",part:"Пильник ШРУСа"},
      {code:"DRIVESHAFT_FL",name:"Ліва піввісь",position:"Передня ліва",work:"Заміна півосі",part:"Піввісь"},
      {code:"DRIVESHAFT_FR",name:"Права піввісь",position:"Передня права",work:"Заміна півосі",part:"Піввісь"}
    ]},
    { code:"FRONT_BRAKES", name:"Передні гальма", items:[
      {code:"PAD_FL",name:"Ліві передні колодки",position:"Передня ліва",work:"Заміна передніх гальмівних колодок",part:"Передні гальмівні колодки"},
      {code:"PAD_FR",name:"Праві передні колодки",position:"Передня права",work:"Заміна передніх гальмівних колодок",part:"Передні гальмівні колодки"},
      {code:"DISC_FL",name:"Лівий передній диск",position:"Передня ліва",work:"Заміна передніх гальмівних дисків",part:"Передній гальмівний диск"},
      {code:"DISC_FR",name:"Правий передній диск",position:"Передня права",work:"Заміна передніх гальмівних дисків",part:"Передній гальмівний диск"},
      {code:"CALIPER_FL",name:"Лівий передній супорт",position:"Передня ліва",work:"Ремонт / заміна переднього супорта",part:"Супорт передній"},
      {code:"CALIPER_FR",name:"Правий передній супорт",position:"Передня права",work:"Ремонт / заміна переднього супорта",part:"Супорт передній"},
      {code:"HOSE_FL",name:"Лівий передній гальмівний шланг",position:"Передня ліва",work:"Заміна гальмівного шланга",part:"Гальмівний шланг"},
      {code:"HOSE_FR",name:"Правий передній гальмівний шланг",position:"Передня права",work:"Заміна гальмівного шланга",part:"Гальмівний шланг"}
    ]},
    { code:"REAR_SUSPENSION", name:"Задня підвіска", items:[
      {code:"SHOCK_RL",name:"Лівий задній амортизатор",position:"Задня ліва",work:"Заміна заднього амортизатора",part:"Амортизатор задній"},
      {code:"SHOCK_RR",name:"Правий задній амортизатор",position:"Задня права",work:"Заміна заднього амортизатора",part:"Амортизатор задній"},
      {code:"SPRING_RL",name:"Ліва задня пружина",position:"Задня ліва",work:"Заміна задньої пружини",part:"Пружина задня"},
      {code:"SPRING_RR",name:"Права задня пружина",position:"Задня права",work:"Заміна задньої пружини",part:"Пружина задня"},
      {code:"ARM_RL",name:"Лівий задній важіль",position:"Задня ліва",work:"Заміна заднього важеля",part:"Важіль задній"},
      {code:"ARM_RR",name:"Правий задній важіль",position:"Задня права",work:"Заміна заднього важеля",part:"Важіль задній"},
      {code:"BUSH_RL",name:"Лівий сайлентблок задньої підвіски",position:"Задня ліва",work:"Заміна сайлентблока задньої підвіски",part:"Сайлентблок"},
      {code:"BUSH_RR",name:"Правий сайлентблок задньої підвіски",position:"Задня права",work:"Заміна сайлентблока задньої підвіски",part:"Сайлентблок"},
      {code:"STAB_LINK_RL",name:"Ліва задня стійка стабілізатора",position:"Задня ліва",work:"Заміна задньої стійки стабілізатора",part:"Стійка стабілізатора"},
      {code:"STAB_LINK_RR",name:"Права задня стійка стабілізатора",position:"Задня права",work:"Заміна задньої стійки стабілізатора",part:"Стійка стабілізатора"},
      {code:"BEARING_RL",name:"Лівий задній ступичний підшипник",position:"Задня ліва",work:"Заміна заднього ступичного підшипника",part:"Ступичний підшипник"},
      {code:"BEARING_RR",name:"Правий задній ступичний підшипник",position:"Задня права",work:"Заміна заднього ступичного підшипника",part:"Ступичний підшипник"},
      {code:"STAB_BUSH_REAR",name:"Втулки заднього стабілізатора",work:"Заміна втулок заднього стабілізатора",part:"Втулки стабілізатора"}
    ]},
    { code:"REAR_BRAKES", name:"Задні гальма", items:[
      {code:"PAD_RL",name:"Ліві задні колодки",position:"Задня ліва",work:"Заміна задніх гальмівних колодок",part:"Задні гальмівні колодки"},
      {code:"PAD_RR",name:"Праві задні колодки",position:"Задня права",work:"Заміна задніх гальмівних колодок",part:"Задні гальмівні колодки"},
      {code:"DISC_RL",name:"Лівий задній диск",position:"Задня ліва",work:"Заміна задніх гальмівних дисків",part:"Задній гальмівний диск"},
      {code:"DISC_RR",name:"Правий задній диск",position:"Задня права",work:"Заміна задніх гальмівних дисків",part:"Задній гальмівний диск"},
      {code:"CALIPER_RL",name:"Лівий задній супорт",position:"Задня ліва",work:"Ремонт / заміна заднього супорта",part:"Супорт задній"},
      {code:"CALIPER_RR",name:"Правий задній супорт",position:"Задня права",work:"Ремонт / заміна заднього супорта",part:"Супорт задній"}
    ]},
  ]},
  { code:"BRAKES", name:"Гальмівна система", description:"Колодки, диски, шланги та гальмівна рідина.", sortOrder:30, sections:[
    { code:"FRONT_BRAKES", name:"Передні гальма", items:[{code:"PADS_FRONT",name:"Передні колодки",unit:"мм",work:"Заміна передніх гальмівних колодок",part:"Передні гальмівні колодки"},{code:"DISC_FL",name:"Лівий передній диск",position:"Передня ліва",unit:"мм",work:"Заміна передніх гальмівних дисків",part:"Передній гальмівний диск"},{code:"DISC_FR",name:"Правий передній диск",position:"Передня права",unit:"мм",work:"Заміна передніх гальмівних дисків",part:"Передній гальмівний диск"}] },
    { code:"REAR_BRAKES", name:"Задні гальма", items:[{code:"PADS_REAR",name:"Задні колодки",unit:"мм",work:"Заміна задніх гальмівних колодок",part:"Задні гальмівні колодки"},{code:"DISC_REAR",name:"Задні диски / барабани",unit:"мм",work:"Ремонт задньої гальмівної системи"}] },
    { code:"HYDRAULICS", name:"Гідравліка", items:[{code:"HOSES",name:"Гальмівні шланги",part:"Гальмівний шланг"},{code:"FLUID",name:"Стан гальмівної рідини",work:"Заміна гальмівної рідини"}] },
  ]},
  { code:"COMPUTER_DIAGNOSTICS", name:"Комп’ютерна діагностика", description:"Зчитування помилок, контрольні параметри та електроживлення.", sortOrder:40, sections:[
    { code:"DTC", name:"Коди несправностей", items:[{code:"ENGINE_DTC",name:"ЕБУ двигуна"},{code:"ABS_DTC",name:"ABS / ESP"},{code:"AIRBAG_DTC",name:"SRS / Airbag"},{code:"BODY_DTC",name:"Кузовна електроніка"}] },
    { code:"LIVE", name:"Контрольні параметри", items:[{code:"BATTERY",name:"Напруга бортмережі",unit:"V"},{code:"CHARGE",name:"Напруга генератора",unit:"V"},{code:"LIVE_DATA",name:"Ключові live-data параметри"}] },
  ]},
];
