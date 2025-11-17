import { ReactNode } from "react";

interface DashboardLayoutProps {
  left: ReactNode;
  center: ReactNode;
  right: ReactNode;
}

export function DashboardLayout({ left, center, right }: DashboardLayoutProps) {
  return (
    <div className="layout-shell layout-shell--wide">
      <div className="page-layout">
        <aside className="units-panel">{left}</aside>
        <main className="documents-panel">{center}</main>
        <aside className="account-panel">{right}</aside>
      </div>
    </div>
  );
}
