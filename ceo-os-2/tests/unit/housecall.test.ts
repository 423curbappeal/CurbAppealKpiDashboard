import { describe, expect, it } from "vitest";
import { classifyEstimate, estimateTask, formatCents, isUnscheduledJob, jobClosedReason, jobEvent, jobTask } from "@/lib/housecall";
import { estimate, job, option } from "../fixtures/housecall";

describe("classifyEstimate (statuses observed on a live account)", () => {
  it("treats a sent option with no decision as awaiting a reply", () => {
    const s = classifyEstimate(estimate("e1", { options: [option({ total_amount: 30000 }), option({ total_amount: 52500 })] }));
    expect(s).toMatchObject({ kind: "awaiting", valueCents: 52500, optionCount: 2 });
  });
  it("closes converted, canceled, declined and expired estimates", () => {
    expect(classifyEstimate(estimate("e", { work_status: "created job from estimate" }))).toMatchObject({ kind: "closed", outcome: "converted" });
    expect(classifyEstimate(estimate("e", { work_status: "pro canceled" }))).toMatchObject({ kind: "closed", outcome: "canceled" });
    expect(classifyEstimate(estimate("e", { options: [option({ approval_status: "pro declined" })] }))).toMatchObject({ kind: "closed", outcome: "declined" });
    expect(classifyEstimate(estimate("e", { options: [option({ approval_status: "expired" })] }))).toMatchObject({ kind: "closed", outcome: "expired" });
    expect(classifyEstimate(estimate("e", { options: [option({ status: "deleted" })] }))).toMatchObject({ kind: "closed", outcome: "canceled" });
  });
  it("flags approved estimates that have no job yet", () => {
    expect(classifyEstimate(estimate("e", { options: [option({ approval_status: "approved" }), option({ approval_status: "declined" })] }))).toMatchObject({ kind: "approved_unscheduled" });
  });
  it("ignores deleted options when another is still pending", () => {
    expect(classifyEstimate(estimate("e", { options: [option({ status: "deleted", total_amount: 99999 }), option({ total_amount: 10000 })] }))).toMatchObject({ kind: "awaiting", valueCents: 10000 });
  });
  it("does not treat an unsent draft as a follow-up", () => {
    expect(classifyEstimate(estimate("e", { options: [option({ status: "needs scheduling" })] }))).toMatchObject({ kind: "closed" });
  });
});

describe("task and event mapping", () => {
  it("builds a clear follow-up with real amounts only", () => {
    const e = estimate("e123", { options: [option({ total_amount: 30000 }), option({ total_amount: 52550 })] });
    const t = estimateTask(e, classifyEstimate(e) as never);
    expect(t).toMatchObject({ sourceRef: "hcp:estimate:e123", title: "Follow up with Pat Lee on estimate #123", contactName: "Pat Lee", kind: "follow_up" });
    expect(t.notes).toBe("up to $525.50 · 2 options · Awaiting customer approval");
    expect(t.external.amountCents).toBe(52550);
    expect(t.createdAt.toISOString()).toBe("2026-11-02T15:00:00.000Z");
  });
  it("formats cents", () => {
    expect(formatCents(47500)).toBe("$475");
    expect(formatCents(286875)).toBe("$2,868.75");
  });
  it("maps unscheduled and scheduled jobs", () => {
    const j = job("j200");
    expect(isUnscheduledJob(j)).toBe(true);
    expect(jobTask(j)).toMatchObject({ sourceRef: "hcp:job:j200", title: "Schedule house wash for Sam Diaz", notes: "Job #200 · $414 · Needs scheduling" });
    const sched = job("j201", { work_status: "scheduled", schedule: { scheduled_start: "2026-11-12T14:00:00Z", scheduled_end: "2026-11-12T16:00:00Z" } });
    expect(jobClosedReason(sched)).toBe("Scheduled in Housecall Pro");
    expect(jobEvent(sched)).toMatchObject({ externalId: "job:j201", title: "House Wash · Sam Diaz", location: "1 Main St, Hixson" });
    expect(jobEvent(job("j3", { work_status: "pro canceled", schedule: { scheduled_start: "2026-11-12T14:00:00Z", scheduled_end: "2026-11-12T16:00:00Z" } }))).toBeNull();
    expect(jobClosedReason(job("j4", { deleted_at: "2026-11-05T00:00:00Z" }))).toBe("Deleted in Housecall Pro");
  });
});
