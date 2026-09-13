"use client";

export function SidebarFloatingIconsOverride() {
  return <style jsx global>{`
    @media(min-width:761px){
      /* Floating rail: no vertical capsule, only logo + seven menu icons. */
      .crmDock7{
        background:transparent!important;
        border:0!important;
        border-radius:0!important;
        box-shadow:none!important;
        backdrop-filter:none!important;
        -webkit-backdrop-filter:none!important;
      }

      /* Remove the visual separators so the rail reads as seven floating icons. */
      .crmDockGroupStart7::before{
        display:none!important;
      }

      /* Status chrome belonged to the old vertical panel and is no longer shown. */
      .crmDockStatus7{
        display:none!important;
      }

      /*
       * Large brand mark: keep the requested 3x visual size, but use the native
       * 128x128 compact asset instead of stretching the old 64x64 rail PNG.
       * Anchor the button to the left edge so the logo no longer drifts into
       * workspace content or gets clipped by the viewport.
       */
      .crmDockBrand7{
        width:112px!important;
        height:112px!important;
        min-height:112px!important;
        flex:0 0 112px!important;
        align-self:flex-start!important;
        margin:0 0 10px -5px!important;
        transform:none!important;
        overflow:visible!important;
        place-items:center!important;
      }
      .crmDockBrand7 span{
        display:block!important;
        width:108px!important;
        height:108px!important;
        background-image:url("/brand/turbo-lev-compact.webp")!important;
        background-repeat:no-repeat!important;
        background-position:left center!important;
        background-size:108px 108px!important;
        image-rendering:auto!important;
        transform-origin:left center!important;
        filter:drop-shadow(0 3px 7px rgba(17,21,26,.13))!important;
      }
      .crmDockBrand7:hover span,
      .crmDockBrandOpen7 span{
        transform:scale(1.035)!important;
        filter:drop-shadow(0 6px 12px rgba(255,116,23,.16))!important;
      }
      :root[data-theme="dark"] .crmDockBrand7 span{
        background-image:url("/brand/turbo-lev-compact.webp")!important;
      }

      /* Keep only the icon stack visually present; no background strip around it. */
      .crmDockItems7{
        background:transparent!important;
      }
    }
  `}</style>;
}
