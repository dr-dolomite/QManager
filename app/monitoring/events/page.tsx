import { RouteRedirect } from "@/components/route-redirect";

// Network Events moved to /monitoring/history/events; this keeps old bookmarks working.
export default function RedirectPage() {
  return <RouteRedirect to="/monitoring/history/events" />;
}
