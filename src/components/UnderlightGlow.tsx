import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/router";

const ACTIVE_PATHS = new Set(["/", "/dashboard", "/dossiers", "/archive", "/vehicle-archive"]);

export function UnderlightGlow() {
  const [mounted, setMounted] = useState(false);
  const router = useRouter();

  const isActive = useMemo(() => {
    const pathname = router?.pathname || "";
    if (!pathname) return false;
    return ACTIVE_PATHS.has(pathname);
  }, [router.pathname]);

  useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);

  if (!isActive) {
    return null;
  }

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
