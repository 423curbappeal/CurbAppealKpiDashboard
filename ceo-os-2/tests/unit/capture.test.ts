import { describe, expect, it } from "vitest";
import { parseCapture } from "@/lib/capture";
import { zonedTimeToUtc } from "@/lib/dates";

const tz = "America/New_York";
// Monday, Nov 9 2026, 10:00 AM Eastern
const now = zonedTimeToUtc("2026-11-09", "10:00", tz);
const parse = (s: string) => parseCapture(s, { now, timeZone: tz });

describe("parseCapture", () => {
  it("handles the canonical example", () => {
    const r = parse("Remind me to call John tomorrow afternoon")!;
    expect(r.title).toBe("Call John");
    expect(r.kind).toBe("follow_up");
    expect(r.contactName).toBe("John");
    expect(r.dueDate).toBe("2026-11-10");
    expect(r.dueTime).toBe("14:00");
    expect(r.understood).toEqual(["Tomorrow", "2:00 PM", "Follow-up · John"]);
  });

  it("parses explicit clock times with am/pm", () => {
    const r = parse("Send Sarah the estimate at 3:30pm")!;
    expect(r.dueTime).toBe("15:30");
    expect(r.dueDate).toBe("2026-11-09");
    expect(r.title).toBe("Send Sarah the estimate");
    expect(r.scope).toBe("business");
  });

  it("rolls a past time to tomorrow when no date is given", () => {
    const r = parse("stretch at 8am")!;
    expect(r.dueDate).toBe("2026-11-10");
    expect(r.dueTime).toBe("08:00");
  });

  it("treats bare afternoon hours as PM", () => {
    expect(parse("call the bank at 2")!.dueTime).toBe("14:00");
    expect(parse("call the bank at 9")!.dueTime).toBe("09:00");
  });

  it("understands weekdays and 'next'", () => {
    expect(parse("pay invoices friday")!.dueDate).toBe("2026-11-13");
    expect(parse("dentist on monday")!.dueDate).toBe("2026-11-16");
    expect(parse("plan Q1 next wednesday")!.dueDate).toBe("2026-11-18");
  });

  it("understands relative offsets and month dates", () => {
    expect(parse("renew insurance in 3 days")!.dueDate).toBe("2026-11-12");
    expect(parse("review budget in two weeks")!.dueDate).toBe("2026-11-23");
    expect(parse("file taxes by Jan 15")!.dueDate).toBe("2027-01-15");
    expect(parse("Mom's birthday 12/3")!.dueDate).toBe("2026-12-03");
    expect(parse("plan next week")!.dueDate).toBe("2026-11-16");
  });

  it("detects priority and strips the word", () => {
    const r = parse("urgent: fix the pressure washer")!;
    expect(r.priority).toBe("high");
    expect(r.title).toBe("Fix the pressure washer");
  });

  it("does not invent a date when none is given", () => {
    const r = parse("Read Atomic Habits")!;
    expect(r.dueDate).toBeNull();
    expect(r.dueTime).toBeNull();
    expect(r.kind).toBe("task");
    expect(r.understood).toEqual([]);
  });

  it("tonight sets today 7 PM", () => {
    const r = parse("text Mike tonight")!;
    expect(r).toMatchObject({ dueDate: "2026-11-09", dueTime: "19:00", contactName: "Mike", kind: "follow_up" });
  });

  it("does not treat common words as weekdays", () => {
    const r = parse("buy a sun shade")!;
    expect(r.dueDate).toBeNull();
  });

  it("returns null for empty input", () => {
    expect(parse("   ")).toBeNull();
    expect(parse("remind me to")).toBeNull();
  });
});
