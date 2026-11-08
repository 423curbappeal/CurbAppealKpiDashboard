import { addDays, diffDays, localParts, startOfWeek, toDateString, weekdayOf, type DateString } from "./dates";

/**
 * Natural-language capture: "Remind me to call John tomorrow afternoon"
 * → { title: "Call John", kind: "follow_up", contactName: "John", dueDate, dueTime: "14:00" }
 *
 * Deterministic and explainable. Every inferred field is reported back in
 * `understood` so the user can confirm before anything is saved.
 */

export interface CaptureResult {
  title: string;
  kind: "task" | "follow_up";
  contactName: string | null;
  dueDate: DateString | null;
  dueTime: string | null; // "HH:mm", local
  priority: "high" | "normal";
  scope: "personal" | "business";
  understood: string[];
}

export interface CaptureContext {
  now: Date;
  timeZone: string;
}

const LEADING_FILLER =
  /^(?:(?:hey|ok|okay|please)[, ]+)?(?:remind me (?:to|that i need to|that i have to)?|reminder:?|don'?t forget (?:to)?|make sure (?:to|i)?|i (?:need|have|want) to|need to|have to|todo:?|to-do:?|task:?)(?:\s+|$)/i;

const WEEKDAY_NAMES: Record<string, number> = {
  sunday: 0, sun: 0,
  monday: 1, mon: 1,
  tuesday: 2, tue: 2, tues: 2,
  wednesday: 3, wed: 3,
  thursday: 4, thu: 4, thur: 4, thurs: 4,
  friday: 5, fri: 5,
  saturday: 6, sat: 6,
};

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5,
  jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9,
  oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

const DAYPARTS: Record<string, string> = {
  morning: "09:00",
  "this morning": "09:00",
  afternoon: "14:00",
  "this afternoon": "14:00",
  evening: "18:00",
  "this evening": "18:00",
  tonight: "19:00",
  noon: "12:00",
  lunch: "12:00",
  "end of day": "17:00",
  eod: "17:00",
};

const CONTACT_VERBS = /^(call|text|email|e-mail|message|ping|follow up with|follow-up with|followup with|reach out to|check in with|get back to|reply to|respond to)\s+/i;

const BUSINESS_WORDS =
  /\b(customer|customers|client|clients|estimate|estimates|quote|quotes|invoice|invoices|job|jobs|crew|lead|leads|proposal|bid|payroll|employee|employees|vendor|supplier|business|sales|marketing|revenue|bookkeeping|accountant|insurance|truck|equipment)\b/i;

const PRIORITY_WORDS = /\b(urgent(?:ly)?|asap|a\.s\.a\.p\.?|important|high priority|top priority|critical)\b/gi;

const NUMBER_WORDS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, ten: 10, couple: 2 };

function nextWeekday(today: DateString, target: number, strictlyAfter = true): DateString {
  const wd = weekdayOf(today);
  let delta = (target - wd + 7) % 7;
  if (delta === 0 && strictlyAfter) delta = 7;
  return addDays(today, delta);
}

function to24h(hour: number, minute: number, meridiem: string | undefined): string | null {
  let h = hour;
  if (minute < 0 || minute > 59) return null;
  if (meridiem) {
    const m = meridiem.toLowerCase().replace(/\./g, "");
    if (h < 1 || h > 12) return null;
    if (m.startsWith("p") && h !== 12) h += 12;
    if (m.startsWith("a") && h === 12) h = 0;
  } else if (h <= 23) {
    // Bare hour: assume working hours (1–6 → PM, 7–11 → AM).
    if (h >= 1 && h <= 6) h += 12;
  } else {
    return null;
  }
  return `${String(h).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function formatClock(time: string): string {
  const [h, m] = time.split(":").map(Number) as [number, number];
  const suffix = h >= 12 ? "PM" : "AM";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, "0")} ${suffix}`;
}

function describeDate(d: DateString, today: DateString): string {
  const delta = diffDays(today, d);
  if (delta === 0) return "Today";
  if (delta === 1) return "Tomorrow";
  const [y, m, day] = d.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, day));
  const opts: Intl.DateTimeFormatOptions =
    delta > 1 && delta < 7 ? { weekday: "long", timeZone: "UTC" } : { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" };
  return new Intl.DateTimeFormat("en-US", opts).format(date);
}

export function parseCapture(raw: string, ctx: CaptureContext): CaptureResult | null {
  let text = raw.replace(/\s+/g, " ").trim();
  if (!text) return null;

  const now = localParts(ctx.now, ctx.timeZone);
  const today = toDateString(now.year, now.month, now.day);
  const understood: string[] = [];

  // Strip conversational lead-ins (possibly repeated: "please remind me to …").
  for (let i = 0; i < 2; i++) text = text.replace(LEADING_FILLER, "");

  // Priority
  let priority: CaptureResult["priority"] = "normal";
  if (new RegExp(PRIORITY_WORDS.source, "i").test(text) || /!{2,}\s*$/.test(text)) {
    priority = "high";
    text = text.replace(PRIORITY_WORDS, " ").replace(/!+\s*$/, "");
  }

  let dueDate: DateString | null = null;
  let dueTime: string | null = null;

  const take = (re: RegExp, handler: (m: RegExpExecArray) => boolean) => {
    const m = re.exec(text);
    if (m && handler(m)) text = (text.slice(0, m.index) + " " + text.slice(m.index + m[0].length)).trim();
  };

  // ── Dates ────────────────────────────────────────────────────────────────
  take(/\b(?:the )?day after tomorrow\b/i, () => ((dueDate = addDays(today, 2)), true));
  if (!dueDate) take(/\b(?:tomorrow|tmrw|tmr|tomorow)\b/i, () => ((dueDate = addDays(today, 1)), true));
  if (!dueDate) take(/\btoday\b/i, () => ((dueDate = today), true));
  if (!dueDate)
    take(/\bin (\d+|a|an|one|two|three|four|five|six|seven|ten|a couple(?: of)?) (day|days|week|weeks)\b/i, (m) => {
      const word = (m[1] ?? "").toLowerCase().replace(" of", "").replace("a couple", "couple");
      const n = /^\d+$/.test(word) ? Number(word) : NUMBER_WORDS[word];
      if (!n) return false;
      dueDate = addDays(today, m[2]!.toLowerCase().startsWith("week") ? n * 7 : n);
      return true;
    });
  if (!dueDate) take(/\b(?:this )?weekend\b/i, () => ((dueDate = nextWeekday(today, 6, false)), true));
  if (!dueDate) take(/\bnext week\b/i, () => ((dueDate = addDays(startOfWeek(today), 7)), true));
  if (!dueDate)
    take(/\b(?:(on|this|next|by)\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday|mon|tues|tue|wed|thurs|thur|thu|fri)\b/i, (m) => {
      const target = WEEKDAY_NAMES[m[2]!.toLowerCase()];
      if (target === undefined) return false;
      let d = nextWeekday(today, target, true);
      if (m[1]?.toLowerCase() === "next" && diffDays(startOfWeek(today), startOfWeek(d)) === 0) d = addDays(d, 7);
      dueDate = d;
      return true;
    });
  if (!dueDate)
    take(/\b(?:on |by )?(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.? (\d{1,2})(?:st|nd|rd|th)?\b/i, (m) => {
      const month = MONTHS[m[1]!.toLowerCase()];
      const day = Number(m[2]);
      if (!month || day < 1 || day > 31) return false;
      let d = toDateString(now.year, month, day);
      if (diffDays(today, d) < 0) d = toDateString(now.year + 1, month, day);
      dueDate = d;
      return true;
    });
  if (!dueDate)
    take(/\b(?:on |by )?(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/, (m) => {
      const month = Number(m[1]);
      const day = Number(m[2]);
      if (month < 1 || month > 12 || day < 1 || day > 31) return false;
      let year = m[3] ? Number(m[3].length === 2 ? `20${m[3]}` : m[3]) : now.year;
      let d = toDateString(year, month, day);
      if (!m[3] && diffDays(today, d) < 0) d = toDateString(++year, month, day);
      dueDate = d;
      return true;
    });

  // ── Times ────────────────────────────────────────────────────────────────
  take(/\b(?:at |@ ?|by |around )?(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)(?=\s|$|[,.])/i, (m) => {
    const t = to24h(Number(m[1]), Number(m[2] ?? 0), m[3]);
    if (!t) return false;
    dueTime = t;
    return true;
  });
  if (!dueTime)
    take(/\b(?:at|@|around) (\d{1,2})(?::(\d{2}))?\b/i, (m) => {
      const t = to24h(Number(m[1]), Number(m[2] ?? 0), undefined);
      if (!t) return false;
      dueTime = t;
      return true;
    });
  if (!dueTime)
    take(/\b(?:in the |this |by |at )?(morning|afternoon|evening|tonight|noon|lunch|end of day|eod)\b/i, (m) => {
      const key = m[1]!.toLowerCase();
      dueTime = DAYPARTS[key] ?? null;
      if (key === "tonight" && !dueDate) dueDate = today;
      return dueTime !== null;
    });

  // A time without a date means the next time that clock time occurs.
  if (dueTime && !dueDate) {
    const [h, mm] = (dueTime as string).split(":").map(Number) as [number, number];
    dueDate = h * 60 + mm > now.hour * 60 + now.minute ? today : addDays(today, 1);
  }

  // ── Title, kind, contact ─────────────────────────────────────────────────
  let title = text
    .replace(/\s+([,.;])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .replace(/(?:^|\s)(?:on|at|by|for|this|the)\s*$/i, "")
    .replace(/^[\s,.;:-]+|[\s,.;:-]+$/g, "")
    .trim();
  if (!title) return null;
  title = title.charAt(0).toUpperCase() + title.slice(1);

  let kind: CaptureResult["kind"] = "task";
  let contactName: string | null = null;
  const verb = CONTACT_VERBS.exec(title);
  if (verb) {
    kind = "follow_up";
    const rest = title.slice(verb[0].length);
    const name = /^((?:[A-Z][\w'’-]*)(?:\s+(?:[A-Z][\w'’-]*|&|and))*)/.exec(rest);
    if (name) contactName = name[1]!.replace(/\s+(?:&|and)$/, "").trim();
    else {
      const lower = /^(?:the |my )?([a-z]+(?: [a-z]+)?)/.exec(rest);
      if (lower && /customer|client|lead|accountant|insurance|supplier|vendor/.test(lower[1]!)) contactName = null;
    }
  }

  const scope: CaptureResult["scope"] = BUSINESS_WORDS.test(raw) ? "business" : "personal";

  if (dueDate) understood.push(describeDate(dueDate, today));
  if (dueTime) understood.push(formatClock(dueTime));
  if (kind === "follow_up") understood.push(contactName ? `Follow-up · ${contactName}` : "Follow-up");
  if (scope === "business") understood.push("Business");
  if (priority === "high") understood.push("High priority");

  return { title, kind, contactName, dueDate, dueTime, priority, scope, understood };
}

export { formatClock };
