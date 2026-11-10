import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export interface ExternalFacts {
  provider: "housecall_pro";
  type: "estimate" | "approved_estimate" | "job";
  number?: string | null;
  amountCents?: number | null;
  customer?: string | null;
  closedReason?: string | null;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Authentication tables (shape required by Better Auth).
 * These are NOT tenant-scoped; Better Auth owns them.
 * ──────────────────────────────────────────────────────────────────────────── */

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [index("session_user_idx").on(t.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("account_user_idx").on(t.userId)],
);

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ────────────────────────────────────────────────────────────────────────────
 * Tenancy
 * ──────────────────────────────────────────────────────────────────────────── */

export const orgKind = pgEnum("org_kind", ["personal", "business"]);
export const memberRole = pgEnum("member_role", ["owner", "admin", "member"]);

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  kind: orgKind("kind").notNull().default("personal"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: memberRole("role").notNull().default("member"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("membership_org_user_uq").on(t.orgId, t.userId), index("membership_user_idx").on(t.userId)],
);

export const preferences = pgTable("preferences", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  timezone: text("timezone").notNull().default("America/New_York"),
  weeklyWorkoutTarget: integer("weekly_workout_target").notNull().default(4),
  workoutTypes: jsonb("workout_types").$type<string[]>().notNull().default(["Push", "Pull", "Legs", "Cardio"]),
  onboardedAt: timestamp("onboarded_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ────────────────────────────────────────────────────────────────────────────
 * Domain tables. Every row carries org_id and is protected by row-level
 * security (see drizzle/0001_rls.sql). Access goes through withTenant().
 * ──────────────────────────────────────────────────────────────────────────── */

export const scope = pgEnum("record_scope", ["personal", "business"]);
export const taskStatus = pgEnum("task_status", ["open", "done", "cancelled"]);
export const taskKind = pgEnum("task_kind", ["task", "follow_up", "prep"]);
export const taskPriority = pgEnum("task_priority", ["high", "normal"]);
export const recordSource = pgEnum("record_source", ["manual", "capture", "review", "integration"]);

export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    notes: text("notes"),
    kind: taskKind("kind").notNull().default("task"),
    scope: scope("scope").notNull().default("personal"),
    priority: taskPriority("priority").notNull().default("normal"),
    status: taskStatus("status").notNull().default("open"),
    /** Calendar day the task is due, in the user's timezone. */
    dueDate: date("due_date"),
    /** Exact instant, only when the user gave (or confirmed) a time. */
    dueAt: timestamp("due_at", { withTimezone: true }),
    snoozedUntil: timestamp("snoozed_until", { withTimezone: true }),
    contactName: text("contact_name"),
    source: recordSource("source").notNull().default("manual"),
    sourceRef: text("source_ref"),
    /** Facts copied from the source record (e.g. estimate amount). Shown, never edited. */
    external: jsonb("external").$type<ExternalFacts>(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("tasks_org_user_status_idx").on(t.orgId, t.userId, t.status),
    // One CEO OS task per external record, ever — dismissed items are never re-created.
    uniqueIndex("tasks_user_source_ref_uq").on(t.userId, t.sourceRef).where(sql`${t.sourceRef} is not null`),
  ],
);

export const routineCadence = pgEnum("routine_cadence", ["daily", "weekdays", "weekends", "custom"]);

export const routines = pgTable(
  "routines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    cadence: routineCadence("cadence").notNull().default("daily"),
    /** 0 = Sunday … 6 = Saturday; used when cadence = custom. */
    daysOfWeek: jsonb("days_of_week").$type<number[]>().notNull().default([]),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("routines_org_user_idx").on(t.orgId, t.userId)],
);

export const routineCompletions = pgTable(
  "routine_completions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    routineId: uuid("routine_id")
      .notNull()
      .references(() => routines.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    onDate: date("on_date").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("routine_completion_day_uq").on(t.routineId, t.onDate)],
);

export const activityType = pgEnum("activity_type", ["workout", "contact"]);

/**
 * Things that actually happened. Quick actions write here.
 * duration_minutes is null unless the user supplied it — never invented.
 */
export const activities = pgTable(
  "activities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    type: activityType("type").notNull(),
    label: text("label").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    localDate: date("local_date").notNull(),
    durationMinutes: integer("duration_minutes"),
    notes: text("notes"),
    relatedTaskId: uuid("related_task_id").references(() => tasks.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("activities_org_user_date_idx").on(t.orgId, t.userId, t.localDate)],
);

export const goalArea = pgEnum("goal_area", ["business", "finance", "fitness", "personal", "career"]);
export const goalMetric = pgEnum("goal_metric", [
  "workouts_per_week",
  "routine_consistency",
  "tasks_completed_per_week",
  "revenue",
  "manual",
]);
export const goalPeriod = pgEnum("goal_period", ["week", "month", "quarter", "year"]);

export const goals = pgTable(
  "goals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    area: goalArea("area").notNull(),
    metric: goalMetric("metric").notNull(),
    period: goalPeriod("period").notNull().default("year"),
    target: numeric("target", { precision: 14, scale: 2 }).notNull(),
    unit: text("unit"),
    /** User-entered current value, only for metric = manual. Always labeled as such. */
    manualCurrent: numeric("manual_current", { precision: 14, scale: 2 }),
    manualUpdatedAt: timestamp("manual_updated_at", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("goals_org_user_idx").on(t.orgId, t.userId)],
);

export const integrationProvider = pgEnum("integration_provider", ["google_calendar", "microsoft_calendar", "housecall_pro"]);
export const integrationStatus = pgEnum("integration_status", ["connected", "error", "disconnected"]);

export const integrations = pgTable(
  "integrations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    provider: integrationProvider("provider").notNull(),
    status: integrationStatus("status").notNull().default("connected"),
    accountLabel: text("account_label"),
    scopes: text("scopes"),
    /** AES-256-GCM ciphertext of the provider token set. Never sent to the browser. */
    encryptedTokens: text("encrypted_tokens"),
    tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("integration_user_provider_uq").on(t.userId, t.provider)],
);

export const calendarEvents = pgTable(
  "calendar_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    integrationId: uuid("integration_id")
      .notNull()
      .references(() => integrations.id, { onDelete: "cascade" }),
    externalId: text("external_id").notNull(),
    title: text("title").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    allDay: boolean("all_day").notNull().default(false),
    location: text("location"),
    htmlLink: text("html_link"),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("calendar_event_external_uq").on(t.integrationId, t.externalId),
    index("calendar_events_user_start_idx").on(t.orgId, t.userId, t.startsAt),
  ],
);

export const weeklyReviews = pgTable(
  "weekly_reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    weekStart: date("week_start").notNull(),
    summary: jsonb("summary").notNull(),
    reflection: text("reflection"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("weekly_review_user_week_uq").on(t.userId, t.weekStart)],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id"),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_org_created_idx").on(t.orgId, t.createdAt)],
);

/**
 * Depop shop: one row per item, from listing to sale. Money is stored in cents.
 * sold_on is null while the item is still listed. fees_cents is null when the
 * user didn't enter fees; the app then shows an estimate, labeled as such.
 */
export const depopItems = pgTable(
  "depop_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    category: text("category"),
    brand: text("brand"),
    size: text("size"),
    costCents: integer("cost_cents").notNull().default(0),
    listPriceCents: integer("list_price_cents"),
    listedOn: date("listed_on").notNull(),
    soldOn: date("sold_on"),
    salePriceCents: integer("sale_price_cents"),
    feesCents: integer("fees_cents"),
    shippingCents: integer("shipping_cents").notNull().default(0),
    notes: text("notes"),
    removedAt: timestamp("removed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("depop_items_org_user_idx").on(t.orgId, t.userId), index("depop_items_user_sold_idx").on(t.userId, t.soldOn)],
);

export type Task = typeof tasks.$inferSelect;
export type Routine = typeof routines.$inferSelect;
export type Activity = typeof activities.$inferSelect;
export type Goal = typeof goals.$inferSelect;
export type Integration = typeof integrations.$inferSelect;
export type CalendarEvent = typeof calendarEvents.$inferSelect;
export type DepopItem = typeof depopItems.$inferSelect;
