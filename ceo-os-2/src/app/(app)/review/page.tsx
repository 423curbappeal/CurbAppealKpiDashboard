import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { Screen } from "@/components/ui";
import { requireContext } from "@/server/context";
import { loadReview } from "@/server/data";
import { ReviewFlow } from "./flow";

export const metadata = { title: "Weekly review" };

export default async function ReviewPage() {
  const ctx = await requireContext();
  const review = await loadReview(ctx);
  return (
    <Screen>
      <Link href="/growth" className="-ml-2 inline-flex h-11 items-center gap-1 pr-3 pt-safe text-[15px] text-accent">
        <ChevronLeft size={20} /> Growth
      </Link>
      <ReviewFlow summary={review.summary} approvedAt={review.approvedAt?.toISOString() ?? null} reflection={review.reflection} />
    </Screen>
  );
}
