export function SidebarFlyoutHoverFix() {
  return <style>{`
    @media (min-width: 761px) {
      .crmDockFlyout7 {
        left: 76px !important;
      }
      .crmDockFlyout7::before {
        content: "";
        position: absolute;
        top: -8px;
        bottom: -8px;
        left: -24px;
        width: 24px;
        pointer-events: auto;
      }
    }
  `}</style>;
}
