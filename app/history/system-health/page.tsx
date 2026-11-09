import { RouteRedirect } from "@/components/route-redirect";

// System Health moved to /monitoring/history/system-health; this keeps old bookmarks working.
export default function RedirectPage() {
  return <RouteRedirect to="/monitoring/history/system-health" />;
}
