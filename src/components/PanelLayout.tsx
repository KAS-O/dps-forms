import type { ReactNode } from "react";
import Nav from "@/components/Nav";
import CommandSidebar from "@/components/CommandSidebar";

type PanelLayoutProps = {
  children: ReactNode;
  rightAside?: ReactNode;
  mainClassName?: string;
};

export default function PanelLayout({ children, rightAside, mainClassName }: PanelLayoutProps) {
  const containerWidth = rightAside ? "max-w-7xl" : "max-w-6xl";

  return (
    <>
      <Nav />
      <div className="px-4 py-8">
        <div className={`mx-auto w-full ${containerWidth}`}>
          <div className="flex flex-col gap-6 lg:flex-row">
            <CommandSidebar />
            <main className={`flex-1 min-w-0 ${mainClassName || ""}`}>{children}</main>
            {rightAside ? (
              <div className="w-full lg:w-80 flex-shrink-0 lg:sticky lg:top-28">{rightAside}</div>
            ) : null}
          </div>
        </div>
      </div>
    </>
  );
}
