import type { Metadata } from "next";
import { Anton, Poppins } from "next/font/google";
import { ToastProvider } from "@/components/ui/Toast";
import "./globals.css";

const anton = Anton({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-anton",
});

const poppins = Poppins({
  weight: ["400", "500", "600"],
  subsets: ["latin"],
  variable: "--font-poppins",
});

export const metadata: Metadata = {
  title: {
    default: "Circuit Takeoff — Perry Electrical",
    template: "%s · Circuit Takeoff",
  },
  description:
    "Upload electrical plans, stamp devices, route circuits, and export takeoff footages.",
  applicationName: "Circuit Takeoff",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${anton.variable} ${poppins.variable} antialiased`}>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
