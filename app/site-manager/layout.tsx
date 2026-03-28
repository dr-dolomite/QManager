import { AppLayout } from "@/components/app-layout";

export default function SiteManagerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AppLayout>{children}</AppLayout>;
}
