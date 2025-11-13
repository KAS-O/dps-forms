import { useEffect, useMemo, useState } from "react";
import type { InternalUnit } from "@/lib/hr";

type UnitLogoProps = {
  unit: InternalUnit;
  label?: string | null;
  size?: number;
  className?: string;
  roundedClassName?: string;
};

const FALLBACK_SRC = "/unit-logos/default.svg";

export default function UnitLogo({
  unit,
  label,
  size = 40,
  className = "",
  roundedClassName = "rounded-xl",
}: UnitLogoProps) {
  const sources = useMemo(
    () => [`/unit-logos/${unit}.webp`, `/unit-logos/${unit}.png`, FALLBACK_SRC],
    [unit]
  );
  const [, setSourceIndex] = useState(0);
  const [src, setSrc] = useState(sources[0]);

  useEffect(() => {
    setSourceIndex(0);
    setSrc(sources[0]);
  }, [sources]);

  const handleError = () => {
    setSourceIndex((prev) => {
      const next = prev + 1;
      if (next < sources.length) {
        setSrc(sources[next]);
        return next;
      }
      return prev;
    });
  };

  const altText = label ? `Logo jednostki ${label}` : `Logo jednostki ${unit.toUpperCase()}`;

  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center overflow-hidden bg-white/10 ${roundedClassName} ${className}`.trim()}
      style={{ width: size, height: size }}
    >
      <img src={src} alt={altText} className="h-full w-full object-cover" onError={handleError} />
    </span>
  );
}
