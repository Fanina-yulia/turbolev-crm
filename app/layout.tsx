import type { Metadata } from "next";
import "./globals.css";
import "./new-request-wizard.css";
import "./vehicle-lookup.css";
import "./vehicle-intelligence.css";
import "./quick-lookup-order.css";
import { PhoneInputNormalizer } from "./phone-input-normalizer";

export const metadata: Metadata = {
  title: "Turbo LEV CRM",
  description: "Операційна CRM-система СТО Turbo LEV",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="uk">
      <body>
        <PhoneInputNormalizer />
        {children}
      </body>
    </html>
  );
}
