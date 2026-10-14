import type { Metadata } from "next";
import "./globals.css";
import ServiceWorkerRegistration from "./service-worker-registration";

export const metadata: Metadata = {
  title: "藥品地圖 | Drug Location Map",
  description: "快速查詢藥品調劑位置與庫存位置",
};

export const viewport = { themeColor: "#0f172a", width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-Hant"><body>{children}<ServiceWorkerRegistration /></body></html>;
}
