"use client";

import { useEffect, useState } from "react";
import OverviewCard from "@/components/public/overview-card";

function isLoggedInCookie(): boolean {
  if (typeof document === "undefined") return false;
  return document.cookie.includes("qm_logged_in=1");
}

export default function Home() {
  // Logged-in visitors land directly on the dashboard. We can't read the
  // HttpOnly session cookie, but the indicator cookie qm_logged_in=1 is set
  // by the login flow and is sufficient for this gate (see AuthGate).
  //
  // Synchronous initial check (lazy useState initializer) avoids the public
  // card painting for one frame before the redirect — logged-in users get
  // a blank background and an immediate redirect, no flash.
  const [shouldRender] = useState(() => !isLoggedInCookie());

  useEffect(() => {
    if (!shouldRender) {
      window.location.href = "/dashboard/";
    }
  }, [shouldRender]);

  return (
    <div className="bg-background flex min-h-svh items-center justify-center p-4 font-sans">
      {shouldRender && (
        <main className="w-full max-w-md">
          <OverviewCard />
        </main>
      )}
    </div>
  );
}
