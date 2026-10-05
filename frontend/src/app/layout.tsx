import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Nav } from "@/app/components/Nav";
import { AuthGate } from "@/app/components/AuthGate";
import { AuthProvider } from "@/app/lib/auth-context";
import { THEME_BOOT_SCRIPT } from "@/app/lib/theme";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "DataMigrationTool ETL",
  description: "Lightweight multi-tenant ETL & reporting platform",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body className="min-h-full flex">
        <AuthProvider>
          <Nav />
          <main className="min-w-0 flex-1 px-6 py-8">
            <div className="mx-auto w-full max-w-7xl">
              <AuthGate>{children}</AuthGate>
            </div>
          </main>
        </AuthProvider>
      </body>
    </html>
  );
}
