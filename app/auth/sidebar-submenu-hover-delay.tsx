"use client";

const OPEN_DELAY_MS = 250;

export function SidebarSubmenuHoverDelay() {
  return <style jsx global>{`
    @media (min-width:761px) and (hover:hover) {
      .crmDockFlyout7 {
        transition-delay: 0ms !important;
      }
      .crmDockFlyoutShow7 {
        transition-delay: ${OPEN_DELAY_MS}ms !important;
      }
      .crmSettingsFixedFlyout7 {
        animation-delay: ${OPEN_DELAY_MS}ms !important;
        animation-fill-mode: both !important;
      }
    }
  `}</style>;
}
