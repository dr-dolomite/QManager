import { RouteRedirect } from "@/components/route-redirect";

// /monitoring has no page of its own; old links to it still open Network Events.
export default function RedirectPage() {
  return <RouteRedirect to="/monitoring/history/events" />;
}
