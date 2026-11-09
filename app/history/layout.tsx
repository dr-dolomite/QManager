import { AppLayout } from "@/components/app-layout";

export default function HistoryLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AppLayout>{children}</AppLayout>;
}
