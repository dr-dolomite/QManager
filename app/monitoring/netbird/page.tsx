import { RouteRedirect } from "@/components/route-redirect";

// NetBird moved to /monitoring/extensions/netbird; this keeps old bookmarks working.
export default function RedirectPage() {
  return <RouteRedirect to="/monitoring/extensions/netbird" />;
}
