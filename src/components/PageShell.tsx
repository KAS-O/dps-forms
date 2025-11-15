import { ElementType, ReactNode } from "react";

type PageShellProps = {
  children: ReactNode;
  className?: string;
  as?: ElementType;
};

export default function PageShell({ children, className = "", as = "div" }: PageShellProps) {
  const Element = as;
  return <Element className={["page-shell", className].filter(Boolean).join(" ")}>{children}</Element>;
}
