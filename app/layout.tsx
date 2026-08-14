import type { Metadata } from "next";
import "./globals.css";
import "./theme-fixes.css";
import "./new-request-wizard.css";
import "./vehicle-lookup.css";
import "./vehicle-intelligence.css";
import "./quick-lookup-order.css";
import "./leads.css";
import "./leads-kpi.css";
import "./lead-details.css";
import "./communications.css";
import "./settings-suppliers.css";
import "./settings-integrations.css";
import { PhoneInputNormalizer } from "./phone-input-normalizer";
import { LeadDetailsEnhancer } from "./lead-details-enhancer";

export const metadata: Metadata = {
  title: "Turbo LEV CRM",
  description: "Операційна CRM-система СТО Turbo LEV",
};

const themeBootstrap = `(function(){try{var saved=window.localStorage.getItem('turbolev-theme-mode')||window.localStorage.getItem('turbolev-theme')||'auto';if(saved!=='light'&&saved!=='dark'&&saved!=='auto')saved='auto';var resolved=saved==='light'||saved==='dark'?saved:(window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark');var root=document.documentElement;root.dataset.theme=resolved;root.dataset.themeMode=saved;root.style.colorScheme=resolved;}catch(e){}})();`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="uk" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
      </head>
      <body>
        <PhoneInputNormalizer />
        <LeadDetailsEnhancer />
        {children}
      </body>
    </html>
  );
}
