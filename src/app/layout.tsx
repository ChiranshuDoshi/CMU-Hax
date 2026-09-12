import type { ReactNode } from "react";
import "@/components/showcase/styles.css";

export const metadata = {
  title: "PolicyScout",
  description: "PolicyScout — AI insurance quote-shopping and negotiation",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
