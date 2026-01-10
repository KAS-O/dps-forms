import { ReactNode } from "react";

interface DashboardLayoutProps {
  left: ReactNode;
  center: ReactNode;
  right: ReactNode;
  className?: string;
}

export function DashboardLayout({ left, center, right, className }: DashboardLayoutProps) {
  return (
    <div className={["layout-shell layout-shell--wide", className].filter(Boolean).join(" ")}>
      <div className="page-layout">
        <aside className="units-panel">{left}</aside>
        <main className="documents-panel">{center}</main>
        <aside className="account-panel">{right}</aside>
      </div>
    </div>
  );
}
