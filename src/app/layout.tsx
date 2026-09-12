import type { ReactNode } from "react";
import "@/components/showcase/styles.css";

export const metadata = {
  title: "Atrium",
  description: "Atrium — a private New York arrival. The suite is already held.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
