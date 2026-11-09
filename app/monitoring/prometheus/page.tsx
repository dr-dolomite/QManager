import { RouteRedirect } from "@/components/route-redirect";

// Prometheus moved to /monitoring/extensions/prometheus; this keeps old bookmarks working.
export default function RedirectPage() {
  return <RouteRedirect to="/monitoring/extensions/prometheus" />;
}
