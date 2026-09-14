"use client";

export function SidebarFloatingIconsOverride() {
  return <style jsx global>{`
    @media(min-width:761px){
      /* Floating rail: no vertical capsule, only the brand and seven menu icons. */
      .crmDock7{
        background:transparent!important;
        border:0!important;
        border-radius:0!important;
        box-shadow:none!important;
        backdrop-filter:none!important;
        -webkit-backdrop-filter:none!important;
      }

      .crmDockGroupStart7::before,
      .crmDockStatus7{
        display:none!important;
      }

      /*
       * Brand mark V9.
       * The previous 108px compact badge contained its own dark square and felt
       * detached from the rail. Use the transparent light/dark rail marks instead,
       * reduce the visual size by ~30%, and keep the mark anchored near the left edge.
       */
      .crmDockBrand7{
        width:82px!important;
        height:82px!important;
        min-height:82px!important;
        flex:0 0 82px!important;
        align-self:flex-start!important;
        margin:2px 0 8px -4px!important;
        padding:0!important;
        transform:none!important;
        overflow:visible!important;
        place-items:center!important;
        border:0!important;
        background:transparent!important;
        box-shadow:none!important;
      }
      .crmDockBrand7 span{
        display:block!important;
        width:76px!important;
        height:76px!important;
        background-image:url("/brand/turbo-lev-rail-light.png")!important;
        background-repeat:no-repeat!important;
        background-position:left center!important;
        background-size:contain!important;
        image-rendering:auto!important;
        transform-origin:left center!important;
        filter:drop-shadow(0 3px 8px rgba(17,21,26,.13))!important;
        transition:transform 160ms cubic-bezier(.16,1,.3,1),filter 160ms ease!important;
      }
      :root[data-theme="dark"] .crmDockBrand7 span{
        background-image:url("/brand/turbo-lev-rail-dark.png")!important;
        filter:drop-shadow(0 4px 10px rgba(0,0,0,.30))!important;
      }
      .crmDockBrand7:hover span,
      .crmDockBrandOpen7 span{
        transform:scale(1.025)!important;
        filter:drop-shadow(0 6px 12px rgba(255,116,23,.15))!important;
      }

      .crmDockItems7{
        background:transparent!important;
      }

      /*
       * Do not flash captions/submenu as soon as the pointer merely crosses an icon.
       * The flyout becomes visible only after a deliberate 480ms dwell. Removing the
       * show state uses the base transition without delay, so it disappears quickly.
       */
      .crmDockFlyout7{
        left:58px!important;
        width:224px!important;
        padding:7px!important;
        border-radius:13px!important;
        transition:
          opacity 110ms ease 0ms,
          transform 140ms cubic-bezier(.16,1,.3,1) 0ms,
          visibility 0s linear 110ms!important;
      }
      .crmDockFlyout7::before{
        content:"";
        position:absolute;
        left:-22px;
        top:0;
        bottom:0;
        width:22px;
      }
      .crmDockFlyoutShow7{
        visibility:visible!important;
        transition-delay:480ms,480ms,0ms!important;
      }
      .crmDockFlyout7 header{
        padding:5px 8px 8px!important;
        margin-bottom:4px!important;
        font-size:11px!important;
      }
      .crmDockFlyout7 button{
        min-height:32px!important;
        padding:6px 9px!important;
        font-size:11px!important;
      }

      /*
       * Full menu V9 — compact DriveCRM-inspired overlay.
       * Keep the rail visible as the launcher, but make the expanded surface narrow,
       * dense and visually continuous instead of a stack of large cards.
       */
      .crmWideBackdrop7{
        background:rgba(7,10,14,.20)!important;
        backdrop-filter:blur(3px)!important;
        -webkit-backdrop-filter:blur(3px)!important;
      }
      .crmWideMenu7{
        left:70px!important;
        top:8px!important;
        bottom:8px!important;
        width:min(252px,calc(100vw - 82px))!important;
        border-radius:20px!important;
        border:1px solid color-mix(in srgb,var(--line) 60%,transparent)!important;
        background:color-mix(in srgb,var(--panel) 96%,transparent)!important;
        box-shadow:0 18px 52px rgba(15,23,32,.22)!important;
        backdrop-filter:blur(22px) saturate(1.06)!important;
        -webkit-backdrop-filter:blur(22px) saturate(1.06)!important;
      }
      :root[data-theme="dark"] .crmWideMenu7{
        background:color-mix(in srgb,var(--panel) 94%,#111820 6%)!important;
        box-shadow:0 22px 64px rgba(0,0,0,.42)!important;
      }

      .crmWideHeader7{
        height:62px!important;
        flex:0 0 62px!important;
        padding:9px 10px 8px 12px!important;
        border-bottom:1px solid color-mix(in srgb,var(--line) 48%,transparent)!important;
      }
      .crmWideBrand7{
        width:148px!important;
        height:38px!important;
      }
      .crmWideBrand7 img{
        object-fit:contain!important;
        object-position:left center!important;
      }
      .crmWideClose7{
        width:30px!important;
        height:30px!important;
        min-height:30px!important;
        border-radius:9px!important;
        font-size:19px!important;
        background:color-mix(in srgb,var(--panel-2) 86%,transparent)!important;
      }

      .crmWideGroups7{
        padding:7px 7px 12px!important;
        gap:2px!important;
        align-content:start!important;
      }
      .crmWideGroup7{
        padding:4px 5px 5px!important;
        border:0!important;
        border-radius:12px!important;
        background:transparent!important;
        transition:background 130ms ease!important;
      }
      .crmWideGroup7:hover{
        background:color-mix(in srgb,var(--panel-2) 54%,transparent)!important;
      }
      .crmWideGroupActive7{
        border:0!important;
        background:color-mix(in srgb,var(--orange) 8%,var(--panel))!important;
        box-shadow:inset 2px 0 0 color-mix(in srgb,var(--orange) 78%,transparent)!important;
      }

      .crmWideGroupTitle7{
        height:34px!important;
        gap:8px!important;
        padding:1px 5px 3px!important;
      }
      .crmWideGroupIcon7{
        width:30px!important;
        height:30px!important;
        flex:0 0 30px!important;
        border-radius:9px!important;
        background:linear-gradient(145deg,#fff 0%,#f3f5f7 58%,#e9edf1 100%)!important;
        border:1px solid rgba(176,185,194,.38)!important;
        box-shadow:inset 0 1px 1px rgba(255,255,255,.95),0 3px 7px rgba(29,39,49,.10)!important;
      }
      :root[data-theme="dark"] .crmWideGroupIcon7{
        background:linear-gradient(145deg,#f8fafc 0%,#eef1f4 100%)!important;
      }
      .crmWideGroupIcon7 svg{
        width:23px!important;
        height:23px!important;
      }
      .crmWideGroupTitle7 strong{
        font-size:11px!important;
        letter-spacing:0!important;
        font-weight:750!important;
      }

      .crmWideGroupItems7{
        gap:0!important;
      }
      .crmWideGroupItems7 button{
        min-height:29px!important;
        padding:5px 8px 5px 43px!important;
        border-radius:8px!important;
        font-size:11px!important;
        font-weight:560!important;
        line-height:1.25!important;
      }
      .crmWideGroupItems7 button:hover,
      .crmWideGroupItems7 button:focus-visible{
        background:color-mix(in srgb,var(--panel-2) 78%,transparent)!important;
      }
      .crmWideGroupItems7 .crmWideItemActive7{
        background:color-mix(in srgb,var(--orange) 11%,transparent)!important;
        color:var(--orange)!important;
        font-weight:780!important;
        box-shadow:inset 2px 0 0 var(--orange)!important;
      }
    }

    @media(prefers-reduced-motion:reduce) and (min-width:761px){
      .crmDockBrand7 span{transition:none!important}
      .crmDockFlyoutShow7{transition-delay:300ms,300ms,0ms!important}
    }
  `}</style>;
}
