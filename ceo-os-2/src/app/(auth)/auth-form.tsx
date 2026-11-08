"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { buttonClass, cx } from "@/components/ui";

export function AuthForm({ mode, google, notice }: { mode: "sign-in" | "sign-up"; google: boolean; notice?: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res =
      mode === "sign-up"
        ? await authClient.signUp.email({ name: name.trim(), email: email.trim(), password })
        : await authClient.signIn.email({ email: email.trim(), password });
    setBusy(false);
    if (res.error) {
      setError(
        res.error.status === 429
          ? "Too many attempts. Wait a minute and try again."
          : mode === "sign-in"
            ? "That email and password don't match."
            : (res.error.message ?? "Couldn't create your account."),
      );
      return;
    }
    router.replace("/");
    router.refresh();
  };

  const field = "h-14 w-full rounded-2xl border border-line bg-surface px-4 text-ink outline-none placeholder:text-faint focus:border-accent/60";

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[420px] flex-col justify-center px-6 pt-safe pb-safe">
      <div className="animate-rise">
        <div className="mb-10">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon.svg" alt="" width={52} height={52} className="mb-6 rounded-[14px]" />
          <h1 className="font-display text-[32px] leading-tight font-semibold tracking-[-0.02em]">{mode === "sign-in" ? "Welcome back" : "Create your CEO OS"}</h1>
          <p className="mt-2 text-[16px] text-muted">Run your day. Grow your business. Build your life.</p>
        </div>

        {notice && <p className="mb-4 rounded-2xl bg-white/[0.05] px-4 py-3 text-[14px] text-muted">{notice}</p>}

        {google && (
          <>
            <button type="button" onClick={() => authClient.signIn.social({ provider: "google", callbackURL: "/" })} className={cx(buttonClass("secondary", "lg"), "w-full")}>
              Continue with Google
            </button>
            <div className="my-5 flex items-center gap-3 text-[13px] text-faint">
              <span className="h-px flex-1 bg-line" /> or <span className="h-px flex-1 bg-line" />
            </div>
          </>
        )}

        <form onSubmit={submit} className="space-y-3">
          {mode === "sign-up" && <input className={field} placeholder="Your name" autoComplete="name" required value={name} onChange={(e) => setName(e.target.value)} aria-label="Name" />}
          <input className={field} type="email" placeholder="Email" autoComplete="email" autoCapitalize="none" required value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Email" />
          <input
            className={field}
            type="password"
            placeholder={mode === "sign-up" ? "Password (10+ characters)" : "Password"}
            autoComplete={mode === "sign-up" ? "new-password" : "current-password"}
            minLength={mode === "sign-up" ? 10 : undefined}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-label="Password"
          />
          {error && (
            <p role="alert" className="px-1 text-[14px] text-bad">
              {error}
            </p>
          )}
          <button disabled={busy} className={cx(buttonClass("primary", "lg"), "w-full")}>
            {busy ? "One moment…" : mode === "sign-in" ? "Sign in" : "Create account"}
          </button>
        </form>

        <p className="mt-8 text-center text-[15px] text-muted">
          {mode === "sign-in" ? (
            <>
              New here?{" "}
              <Link href="/sign-up" className="font-medium text-accent">
                Create an account
              </Link>
            </>
          ) : (
            <>
              Already have an account?{" "}
              <Link href="/sign-in" className="font-medium text-accent">
                Sign in
              </Link>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
