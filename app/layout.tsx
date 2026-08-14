import type { Metadata } from "next";
import "./globals.css";
import "./new-request-wizard.css";

export const metadata: Metadata = {
  title: "Turbo LEV CRM",
  description: "Операційна CRM-система СТО Turbo LEV",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="uk">
      <body>{children}</body>
    </html>
  );
}
