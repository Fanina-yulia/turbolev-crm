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

      /* Previous visual logo was 36x36. 108x108 is exactly 3x. */
      .crmDockBrand7{
        width:112px!important;
        height:112px!important;
        min-height:112px!important;
        flex:0 0 112px!important;
        margin:0 0 10px!important;
        transform:translateX(18px);
        overflow:visible!important;
      }
      .crmDockBrand7 span{
        width:108px!important;
        height:108px!important;
      }

      /* Keep only the icon stack visually present; no background strip around it. */
      .crmDockItems7{
        background:transparent!important;
      }

      @media(max-height:700px){
        .crmDockBrand7{
          width:100px!important;
          height:100px!important;
          min-height:100px!important;
          flex-basis:100px!important;
          transform:translateX(16px);
        }
        .crmDockBrand7 span{
          width:96px!important;
          height:96px!important;
        }
      }
    }
  `}</style>;
}
