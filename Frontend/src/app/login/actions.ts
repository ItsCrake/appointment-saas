"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { reportError } from "@/lib/observability";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const credentialsSchema = z.object({
  email: z.email("כתובת אימייל לא תקינה"),
  password: z.string().min(8, "הסיסמה חייבת להכיל לפחות 8 תווים"),
});

/**
 * Supabase errors are not guaranteed to carry a usable `message` — a transport
 * failure or an unusual status can leave it empty, which previously reached the
 * form as a blank alert with nothing to act on. Always produce something the
 * reader can search for.
 */
function describeAuthError(error: { message?: string; status?: number }) {
  const message = error.message?.trim();
  if (message) return message;
  return error.status
    ? `שגיאת אימות (HTTP ${error.status}). בדקו את יומן Supabase Auth.`
    : "שגיאת אימות ללא פירוט. בדקו את יומן Supabase Auth.";
}

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

  const result = await supabase.auth
    .signInWithPassword(parsed.data)
    .catch((thrown: unknown) => {
      // A transport failure rejects rather than returning an error object.
      reportError("auth.signIn", thrown);
      return null;
    });

  if (!result) {
    return { ok: false, error: "לא הצלחנו להגיע לשרת ההזדהות. נסו שוב." };
  }

  if (result.error) {
    // The reader gets a deliberately vague message — distinguishing the two
    // leaks which emails exist — but the log keeps the real cause.
    reportError("auth.signIn", result.error, {
      status: result.error.status ?? null,
      code: result.error.code ?? null,
    });
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

  const result = await supabase.auth
    .signUp(parsed.data)
    .catch((thrown: unknown) => {
      reportError("auth.signUp", thrown);
      return null;
    });

  if (!result) {
    return { ok: false, error: "לא הצלחנו להגיע לשרת ההזדהות. נסו שוב." };
  }

  if (result.error) {
    reportError("auth.signUp", result.error, {
      status: result.error.status ?? null,
      code: result.error.code ?? null,
    });
    return { ok: false, error: describeAuthError(result.error) };
  }

  const { data } = result;

  // Supabase's user-enumeration defence: signing up with an address that is
  // already registered returns success with an *empty* identities array and no
  // error. Without this branch it falls through to "check your inbox" — an
  // email that never arrives, for an account that already exists.
  if (data.user && (data.user.identities?.length ?? 0) === 0) {
    return {
      ok: false,
      error: "כתובת האימייל כבר רשומה. התחברו או אפסו סיסמה.",
    };
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
