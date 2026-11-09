import { CaptureButton, CaptureProvider } from "@/components/capture";
import { ToastProvider } from "@/components/feedback";
import { TabBar, TimezoneAdopter } from "@/components/quick";
import { HealthKitAutoSync } from "@/components/native-health";
import { requireContext } from "@/server/context";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireContext();
  return (
    <ToastProvider>
      <CaptureProvider>
        {children}
        <CaptureButton />
        <TabBar />
        <TimezoneAdopter needed={!ctx.onboarded} />
        <HealthKitAutoSync />
      </CaptureProvider>
    </ToastProvider>
  );
}
