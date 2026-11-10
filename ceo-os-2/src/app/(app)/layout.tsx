import { PullToRefresh, ServiceWorker } from "@/components/app-shell";
import { CaptureButton, CaptureProvider } from "@/components/capture";
import { ToastProvider } from "@/components/feedback";
import { TabBar, TimezoneAdopter } from "@/components/quick";
import { requireContext } from "@/server/context";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireContext();
  return (
    <ToastProvider>
      <CaptureProvider>
        <PullToRefresh />
        {children}
        <CaptureButton />
        <TabBar />
        <TimezoneAdopter needed={!ctx.onboarded} />
        <ServiceWorker />
      </CaptureProvider>
    </ToastProvider>
  );
}
