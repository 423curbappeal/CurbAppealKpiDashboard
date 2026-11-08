import { redirect } from "next/navigation";
import { authProviders } from "@/server/auth";
import { optionalSession } from "@/server/context";
import { AuthForm } from "../auth-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sign in" };

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ deleted?: string }> }) {
  if (await optionalSession()) redirect("/");
  const { deleted } = await searchParams;
  return <AuthForm mode="sign-in" google={authProviders.google} notice={deleted ? "Your account and data were permanently deleted." : undefined} />;
}
