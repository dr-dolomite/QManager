import { RouteRedirect } from "@/components/route-redirect";

// Logs moved to /monitoring/history/logs; this keeps old bookmarks working.
export default function RedirectPage() {
  return <RouteRedirect to="/monitoring/history/logs" />;
}
