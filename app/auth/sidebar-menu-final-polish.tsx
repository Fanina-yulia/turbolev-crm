"use client";

export function SidebarMenuFinalPolish() {
  return <style jsx global>{`
    @media(min-width:761px){
      /* One brand mark at a time: when the expanded menu is open, the rail logo fades out. */
      .crmDockBrandOpen7{
        opacity:0!important;
        pointer-events:none!important;
        transition:opacity 120ms ease!important;
      }

      /* Compact content-height overlay instead of a full-height white strip. */
      .crmWideMenu7{
        left:68px!important;
        top:10px!important;
        bottom:auto!important;
        width:min(280px,calc(100vw - 80px))!important;
        height:auto!important;
        max-height:calc(100vh - 20px)!important;
        border-radius:22px!important;
        overflow:hidden!important;
        box-shadow:0 18px 52px rgba(15,23,32,.20)!important;
      }
      :root[data-theme="dark"] .crmWideMenu7{
        box-shadow:0 22px 60px rgba(0,0,0,.40)!important;
      }

      .crmWideHeader7{
        height:66px!important;
        flex:0 0 66px!important;
        padding:10px 11px 9px 14px!important;
        gap:10px!important;
      }
      .crmWideBrand7{
        width:170px!important;
        height:42px!important;
        min-width:0!important;
      }
      .crmWideBrand7 img{
        width:100%!important;
        height:100%!important;
        object-fit:contain!important;
        object-position:left center!important;
      }
      .crmWideClose7{
        width:30px!important;
        height:30px!important;
        min-height:30px!important;
        flex:0 0 30px!important;
      }

      /* Drawer ends after its content. Scroll only when a short viewport requires it. */
      .crmWideGroups7{
        flex:0 1 auto!important;
        min-height:0!important;
        overflow-y:auto!important;
        overflow-x:hidden!important;
        padding:6px 8px 10px!important;
        gap:1px!important;
        align-content:start!important;
      }

      .crmWideGroup7{
        padding:3px 4px 4px!important;
        border-radius:11px!important;
        border:0!important;
        background:transparent!important;
        box-shadow:none!important;
      }
      .crmWideGroup7:hover{
        background:color-mix(in srgb,var(--panel-2) 46%,transparent)!important;
      }

      /* Group state is intentionally quiet; the selected leaf carries the strong accent. */
      .crmWideGroupActive7{
        background:color-mix(in srgb,var(--orange) 3.5%,transparent)!important;
        box-shadow:none!important;
      }
      .crmWideGroupActive7 .crmWideGroupTitle7{
        position:relative!important;
      }
      .crmWideGroupActive7 .crmWideGroupTitle7::before{
        content:""!important;
        position:absolute!important;
        left:-2px!important;
        top:8px!important;
        width:3px!important;
        height:18px!important;
        border-radius:999px!important;
        background:color-mix(in srgb,var(--orange) 68%,transparent)!important;
      }

      .crmWideGroupTitle7{
        height:36px!important;
        gap:9px!important;
        padding:1px 5px 2px 7px!important;
      }
      .crmWideGroupIcon7{
        width:35px!important;
        height:35px!important;
        flex:0 0 35px!important;
        border-radius:10px!important;
      }
      .crmWideGroupIcon7 svg{
        width:27px!important;
        height:27px!important;
      }
      .crmWideGroupTitle7 strong{
        font-size:11px!important;
        line-height:1.2!important;
        font-weight:760!important;
      }

      .crmWideGroupItems7{
        gap:0!important;
      }
      .crmWideGroupItems7 button{
        min-height:27px!important;
        padding:4px 9px 4px 51px!important;
        border-radius:8px!important;
        font-size:11px!important;
        line-height:1.2!important;
      }
      .crmWideGroupItems7 .crmWideItemActive7{
        background:color-mix(in srgb,var(--orange) 12%,transparent)!important;
        color:var(--orange)!important;
        box-shadow:inset 2px 0 0 var(--orange)!important;
        font-weight:780!important;
      }
    }

    @media(prefers-reduced-motion:reduce) and (min-width:761px){
      .crmDockBrandOpen7{transition:none!important}
    }
  `}</style>;
}
