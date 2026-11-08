import { CheckCheck } from "lucide-react";
import { RoutineToggles } from "@/components/quick";
import { TaskRow, type TaskView } from "@/components/tasks";
import { Card, EmptyState, Screen, ScreenHeader, SectionTitle } from "@/components/ui";
import { formatDay } from "@/lib/dates";
import { requireContext } from "@/server/context";
import { loadExecute, type ExecuteItem } from "@/server/data";
import { InlineCapture } from "../capture-hint";

export const metadata = { title: "Execute" };

export default async function ExecutePage() {
  const ctx = await requireContext();
  const data = await loadExecute(ctx);
  const view = (t: ExecuteItem, extra: Partial<TaskView> = {}): TaskView => ({
    ...t,
    dueLabel: t.dueDate ? formatDay(t.dueDate, data.today) : null,
    overdue: t.dueDate !== null && t.dueDate < data.today,
    ...extra,
  });
  const { groups } = data;
  const total = groups.overdue.length + groups.today.length + groups.upcoming.length + groups.anytime.length;

  return (
    <Screen>
      <ScreenHeader eyebrow={`${total} open`} title="Execute" />
      <InlineCapture />

      {data.routines.length > 0 && (
        <>
          <SectionTitle>Today's routines</SectionTitle>
          <RoutineToggles routines={data.routines} />
        </>
      )}

      {total === 0 && (
        <Card className="mt-6">
          <EmptyState icon={<CheckCheck size={20} />} title="Nothing open" body="Everything is handled. Capture new commitments as they come up." />
        </Card>
      )}

      <Group title="Overdue" tone="bad" items={groups.overdue.map((t) => view(t))} />
      <Group title="Today" items={groups.today.map((t) => view(t, { dueLabel: null }))} />
      <Group title="Upcoming" items={groups.upcoming.map((t) => view(t))} />
      <Group title="Anytime" items={groups.anytime.map((t) => view(t))} />

      {groups.snoozed.length > 0 && (
        <details className="group mt-8">
          <summary className="flex h-11 cursor-pointer list-none items-center px-1 text-[15px] font-semibold text-muted">
            Snoozed · {groups.snoozed.length}
          </summary>
          <Card className="mt-2 divide-y divide-line overflow-hidden">
            {groups.snoozed.map((t) => (
              <TaskRow key={t.id} task={view(t, { snoozed: true })} />
            ))}
          </Card>
        </details>
      )}

      {data.doneToday.length > 0 && (
        <details className="mt-4">
          <summary className="flex h-11 cursor-pointer list-none items-center px-1 text-[15px] font-semibold text-muted">
            Done today · {data.doneToday.length}
          </summary>
          <Card className="mt-2 divide-y divide-line overflow-hidden">
            {data.doneToday.map((t) => (
              <TaskRow key={t.id} task={view(t)} />
            ))}
          </Card>
        </details>
      )}
    </Screen>
  );
}

function Group({ title, items, tone }: { title: string; items: TaskView[]; tone?: "bad" }) {
  if (items.length === 0) return null;
  return (
    <>
      <SectionTitle action={<span className={tone === "bad" ? "text-[13px] font-medium text-bad" : "text-[13px] text-faint"}>{items.length}</span>}>{title}</SectionTitle>
      <Card className="divide-y divide-line overflow-hidden">
        {items.map((t) => (
          <TaskRow key={t.id} task={t} />
        ))}
      </Card>
    </>
  );
}
