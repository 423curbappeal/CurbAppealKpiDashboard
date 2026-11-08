import { redirect } from "next/navigation";
import { authProviders } from "@/server/auth";
import { optionalSession } from "@/server/context";
import { AuthForm } from "../auth-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Create account" };

export default async function SignUpPage() {
  if (await optionalSession()) redirect("/");
  return <AuthForm mode="sign-up" google={authProviders.google} />;
}
