import type { ReactNode } from "react";
import Nav from "@/components/Nav";
import PanelSidebar from "@/components/PanelSidebar";

type PanelLayoutProps = {
  children: ReactNode;
  contentClassName?: string;
};

export default function PanelLayout({ children, contentClassName }: PanelLayoutProps) {
  return (
    <>
      <Nav />
      <div className="min-h-screen px-4 py-8">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 lg:flex-row">
          <PanelSidebar />
          <main className={`flex-1 ${contentClassName ?? ""}`}>{children}</main>
        </div>
      </div>
    </>
  );
}
