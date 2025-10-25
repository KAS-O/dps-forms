import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

export function UnderlightGlow() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);

  if (typeof document === "undefined") {
    return null;
  }

  const glow = (
    <div className="underlight-ambient" aria-hidden="true">
      <span className="underlight-ambient__blue" />
      <span className="underlight-ambient__red" />
    </div>
  );

  return mounted ? createPortal(glow, document.body) : null;
}

export default UnderlightGlow;
