import { RouteRedirect } from "@/components/route-redirect";

// Tailscale moved to /monitoring/extensions/tailscale; this keeps old bookmarks working.
export default function RedirectPage() {
  return <RouteRedirect to="/monitoring/extensions/tailscale" />;
}
