import { RouteRedirect } from "@/components/route-redirect";

// Cellular History moved to /monitoring/history/cellular; this keeps old bookmarks working.
export default function RedirectPage() {
  return <RouteRedirect to="/monitoring/history/cellular" />;
}
