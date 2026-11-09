"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// =============================================================================
// RouteRedirect: keeps an old URL working after its page moved
// =============================================================================
// QManager is a static export served by lighttpd, so `next.config` redirects
// never run on the modem; the move has to happen in the browser. `replace`,
// never `push`, so the old URL does not trap the Back button. The query string
// and hash ride along, so a deep link (`?id=`, `#section`) still lands.
// =============================================================================

export function RouteRedirect({ to }: { to: string }) {
  const router = useRouter();

  useEffect(() => {
    router.replace(to + window.location.search + window.location.hash);
  }, [router, to]);

  return null;
}
