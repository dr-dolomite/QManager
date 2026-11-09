import { RouteRedirect } from "@/components/route-redirect";

// Connection History moved to /monitoring/history/connection; this keeps old bookmarks working.
export default function RedirectPage() {
  return <RouteRedirect to="/monitoring/history/connection" />;
}
