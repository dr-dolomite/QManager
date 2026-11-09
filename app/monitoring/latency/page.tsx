"use client";

import { Suspense, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";

import { MaterialSymbol } from "@/components/ui/material-symbol";

// =============================================================================
// /monitoring/latency — retired route, now a redirect
// =============================================================================
// The Latency Monitor merged into History > Connection History: its Right Now
// and History cards became the page's reachability and latency charts, and its
// Sites card moved across. This route survives only so an old bookmark or a
// stale browser history entry still lands somewhere useful.
//
// WHY A CLIENT-SIDE REDIRECT AND NOT A REAL ONE. QManager is a Next.js STATIC
// EXPORT (`output: "export"`) served by lighttpd off the modem. There is no Node
// process at runtime, so `next.config`'s `redirects()` never executes (it is a
// dev-server-only feature here) and there is no server to emit a 308. The
// navigation has to happen in the browser after the exported HTML loads.
//
// `router.replace`, never `push`: a redirect that leaves itself in the history
// stack traps the Back button in a loop between the two pages.
//
// The frame before navigation renders a real centred notice rather than a blank
// page. On the modem's own CPU that frame is not always instantaneous, and a
// white flash reads as a broken link.
// =============================================================================

const TARGET = "/history/connection";

function LatencyRedirect() {
  const router = useRouter();
  const { t } = useTranslation("history");

  useEffect(() => {
    router.replace(TARGET);
  }, [router]);

  return (
    <div
      className="flex min-h-[50vh] flex-col items-center justify-center gap-3 p-2"
      role="status"
      aria-live="polite"
    >
      <MaterialSymbol
        name="progress_activity"
        size={24}
        className="text-on-surface-variant motion-safe:animate-spin"
      />
      <p className="text-on-surface-variant text-sm">
        {t("connection.redirect.label")}
      </p>
    </div>
  );
}

// Suspense mirrors the sibling redirect: a client page that may grow a
// `useSearchParams()` read must not fail the static export with a CSR bailout.
const LatencyPage = () => (
  <Suspense>
    <LatencyRedirect />
  </Suspense>
);

export default LatencyPage;
