"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { createSupabaseServerClient } from "@/lib/supabase/server";

const credentialsSchema = z.object({
  email: z.email("כתובת אימייל לא תקינה"),
  password: z.string().min(8, "הסיסמה חייבת להכיל לפחות 8 תווים"),
});

export type AuthResult =
  { ok: false; error: string } | { ok: true; message?: string };

export async function signInAction(
  email: string,
  password: string,
  next?: string,
): Promise<AuthResult> {
  const parsed = credentialsSchema.safeParse({ email, password });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message };
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return { ok: false, error: "התחברות אינה מוגדרת. חסרים מפתחות Supabase." };
  }

  const { error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error) {
    // Deliberately vague: distinguishing the two leaks which emails exist.
    return { ok: false, error: "אימייל או סיסמה שגויים" };
  }

  redirect(next && next.startsWith("/dashboard") ? next : "/dashboard");
}

export async function signUpAction(
  email: string,
  password: string,
): Promise<AuthResult> {
  const parsed = credentialsSchema.safeParse({ email, password });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message };
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return { ok: false, error: "הרשמה אינה מוגדרת. חסרים מפתחות Supabase." };
  }

  const { data, error } = await supabase.auth.signUp(parsed.data);

  if (error) {
    return { ok: false, error: error.message };
  }

  // With email confirmation on, Supabase returns a user but no session.
  if (data.user && !data.session) {
    return {
      ok: true,
      message: "נשלח אליכם אימייל לאישור החשבון. אשרו אותו ואז התחברו.",
    };
  }

  redirect("/dashboard");
}

export async function signOutAction() {
  const supabase = await createSupabaseServerClient();
  await supabase?.auth.signOut();
  redirect("/login");
}
