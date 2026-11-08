import { beforeAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";

beforeAll(() => {
  process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");
});

describe("token encryption", () => {
  it("round-trips and detects tampering", async () => {
    const { decryptJson, encryptJson } = await import("@/server/crypto");
    const env = encryptJson({ access_token: "secret", n: 1 });
    expect(env).not.toContain("secret");
    expect(decryptJson(env)).toEqual({ access_token: "secret", n: 1 });
    const parts = env.split(".");
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(() => decryptJson(parts.join("."))).toThrow();
  });
  it("signs and verifies OAuth state", async () => {
    const { signState, verifyState } = await import("@/server/crypto");
    const s = signState({ u: "user", n: "nonce" });
    expect(verifyState(s)).toEqual({ u: "user", n: "nonce" });
    expect(verifyState(s.slice(0, -2) + "xx")).toBeNull();
    expect(verifyState("garbage")).toBeNull();
  });
});

describe("Google event mapping", () => {
  it("maps timed and all-day events and drops cancelled ones", async () => {
    const { mapGoogleEvent } = await import("@/server/integrations/google-calendar");
    const { startOfLocalDay } = await import("@/lib/dates");
    const toInstant = (d: string) => startOfLocalDay(d, "America/New_York");
    const timed = mapGoogleEvent({ id: "a", summary: " Estimate ", start: { dateTime: "2026-11-09T14:00:00-05:00" }, end: { dateTime: "2026-11-09T15:00:00-05:00" }, location: "Hixson" }, toInstant);
    expect(timed).toMatchObject({ externalId: "a", title: "Estimate", allDay: false, location: "Hixson" });
    expect(timed!.startsAt.toISOString()).toBe("2026-11-09T19:00:00.000Z");
    const allDay = mapGoogleEvent({ id: "b", start: { date: "2026-11-10" }, end: { date: "2026-11-11" } }, toInstant);
    expect(allDay).toMatchObject({ allDay: true, title: "Busy" });
    expect(allDay!.startsAt.toISOString()).toBe("2026-11-10T05:00:00.000Z");
    expect(mapGoogleEvent({ id: "c", status: "cancelled", start: { date: "2026-11-10" }, end: { date: "2026-11-11" } }, toInstant)).toBeNull();
    expect(mapGoogleEvent({ id: "d", htmlLink: "https://evil.example/x", start: { dateTime: "2026-11-09T14:00:00Z" }, end: { dateTime: "2026-11-09T15:00:00Z" } }, toInstant)!.htmlLink).toBeNull();
  });
});
