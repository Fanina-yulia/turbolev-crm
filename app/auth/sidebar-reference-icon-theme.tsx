"use client";

import { useEffect } from "react";

const GROUP_ICON_KEY: Record<string, string> = {
  "Робочий стіл": "dashboard",
  "Комунікація": "communications",
  "Планувальник": "planner",
  "Клієнти та авто": "clients-auto",
  "Сервіс": "service",
  "Запчастини": "parts",
  "Фінанси": "finance",
  "Управління": "management",
};

export function SidebarReferenceIconTheme() {
  useEffect(() => {
    const applyWideMenuKeys = () => {
      document.querySelectorAll<HTMLElement>(".crmWideGroup7").forEach((section) => {
        const label = section.querySelector<HTMLElement>(".crmWideGroupTitle7 strong")?.textContent?.trim();
        const key = label ? GROUP_ICON_KEY[label] : undefined;
        if (key) section.dataset.referenceIcon = key;
        else delete section.dataset.referenceIcon;
      });
    };

    applyWideMenuKeys();
    const observer = new MutationObserver(applyWideMenuKeys);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  return <style jsx global>{`
    @media(min-width:761px){
      .crmDockSlot7{
        width:60px!important;
        height:58px!important;
        flex:0 0 58px!important;
      }
      .crmDockButton7{
        width:50px!important;
        min-width:50px!important;
        max-width:50px!important;
        height:50px!important;
        min-height:50px!important;
        border-radius:15px!important;
      }
      .crmDockGlyph7{
        width:40px!important;
        height:40px!important;
        transform:scale(clamp(1,var(--dock-scale),1.58))!important;
        filter:none!important;
      }
      .crmDockGlyph7::before{
        inset:0!important;
        border-radius:13px!important;
        background:linear-gradient(145deg,#ffffff 0%,#f8f9fb 34%,#eef1f5 70%,#e3e7ec 100%)!important;
        border:1px solid rgba(184,192,201,.68)!important;
        box-shadow:
          inset 0 1.4px 1px rgba(255,255,255,1),
          inset 0 -2px 3px rgba(111,124,137,.14),
          0 8px 16px rgba(19,28,37,.16),
          0 2px 5px rgba(19,28,37,.11)!important;
      }
      .crmDockGlyph7::after{
        content:"";
        position:absolute;
        inset:4px;
        z-index:2;
        background-position:center;
        background-repeat:no-repeat;
        background-size:contain;
        filter:drop-shadow(0 2.5px 2px rgba(8,15,22,.26));
        pointer-events:none;
      }
      .crmDockGlyph7 svg{opacity:0!important}
      .crmDockButton7:hover .crmDockGlyph7::before,
      .crmDockButton7:focus-visible .crmDockGlyph7::before{
        box-shadow:
          inset 0 1.4px 1px rgba(255,255,255,1),
          inset 0 -2px 3px rgba(111,124,137,.12),
          0 14px 26px rgba(19,28,37,.22),
          0 5px 12px rgba(255,116,23,.12)!important;
      }
      .crmDockActive7 .crmDockGlyph7::before{
        border-color:rgba(255,116,23,.58)!important;
        box-shadow:
          inset 0 1.4px 1px rgba(255,255,255,1),
          inset 0 -2px 3px rgba(111,124,137,.12),
          0 0 0 2px rgba(255,116,23,.10),
          0 10px 22px rgba(255,116,23,.18),
          0 4px 9px rgba(19,28,37,.13)!important;
      }

      .crmDockButton7[aria-label="Робочий стіл"] .crmDockGlyph7::after{background-image:url("/icons/sidebar/reference-dashboard.svg")}
      .crmDockButton7[aria-label="Комунікація"] .crmDockGlyph7::after{background-image:url("/icons/sidebar/reference-communications.svg")}
      .crmDockButton7[aria-label="Планувальник"] .crmDockGlyph7::after{background-image:url("/icons/sidebar/reference-planner.svg")}
      .crmDockButton7[aria-label="Клієнти та авто"] .crmDockGlyph7::after{background-image:url("/icons/sidebar/reference-clients-auto.svg")}
      .crmDockButton7[aria-label="Сервіс"] .crmDockGlyph7::after{background-image:url("/icons/sidebar/reference-service.svg")}
      .crmDockButton7[aria-label="Запчастини"] .crmDockGlyph7::after{background-image:url("/icons/sidebar/reference-parts.svg")}
      .crmDockButton7[aria-label="Фінанси"] .crmDockGlyph7::after{background-image:url("/icons/sidebar/reference-finance.svg")}
      .crmDockButton7[aria-label="Управління"] .crmDockGlyph7::after{background-image:url("/icons/sidebar/reference-management.svg")}

      .crmWideGroupTitle7{height:46px!important;gap:12px!important}
      .crmWideGroupIcon7{
        position:relative;
        width:40px!important;
        height:40px!important;
        flex:0 0 40px;
        border-radius:13px!important;
        background:linear-gradient(145deg,#ffffff 0%,#f8f9fb 34%,#eef1f5 70%,#e3e7ec 100%)!important;
        border:1px solid rgba(184,192,201,.68)!important;
        box-shadow:
          inset 0 1.4px 1px rgba(255,255,255,1),
          inset 0 -2px 3px rgba(111,124,137,.14),
          0 8px 16px rgba(19,28,37,.15),
          0 2px 5px rgba(19,28,37,.10)!important;
      }
      .crmWideGroupIcon7 svg{opacity:0!important}
      .crmWideGroupIcon7::after{
        content:"";
        position:absolute;
        inset:4px;
        background-position:center;
        background-repeat:no-repeat;
        background-size:contain;
        filter:drop-shadow(0 2.5px 2px rgba(8,15,22,.24));
      }
      .crmWideGroup7[data-reference-icon="dashboard"] .crmWideGroupIcon7::after{background-image:url("/icons/sidebar/reference-dashboard.svg")}
      .crmWideGroup7[data-reference-icon="communications"] .crmWideGroupIcon7::after{background-image:url("/icons/sidebar/reference-communications.svg")}
      .crmWideGroup7[data-reference-icon="planner"] .crmWideGroupIcon7::after{background-image:url("/icons/sidebar/reference-planner.svg")}
      .crmWideGroup7[data-reference-icon="clients-auto"] .crmWideGroupIcon7::after{background-image:url("/icons/sidebar/reference-clients-auto.svg")}
      .crmWideGroup7[data-reference-icon="service"] .crmWideGroupIcon7::after{background-image:url("/icons/sidebar/reference-service.svg")}
      .crmWideGroup7[data-reference-icon="parts"] .crmWideGroupIcon7::after{background-image:url("/icons/sidebar/reference-parts.svg")}
      .crmWideGroup7[data-reference-icon="finance"] .crmWideGroupIcon7::after{background-image:url("/icons/sidebar/reference-finance.svg")}
      .crmWideGroup7[data-reference-icon="management"] .crmWideGroupIcon7::after{background-image:url("/icons/sidebar/reference-management.svg")}

      @media(max-height:640px){
        .crmDockSlot7{height:50px!important;flex-basis:50px!important}
        .crmDockGlyph7{width:36px!important;height:36px!important}
      }
    }
  `}</style>;
}
