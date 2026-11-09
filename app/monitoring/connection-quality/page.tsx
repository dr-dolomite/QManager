import { RouteRedirect } from "@/components/route-redirect";

// Connection Quality settings moved to /monitoring/settings; this keeps old bookmarks working.
export default function RedirectPage() {
  return <RouteRedirect to="/monitoring/settings" />;
}
