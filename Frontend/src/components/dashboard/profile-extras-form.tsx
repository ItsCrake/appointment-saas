"use client";

import { useCallback } from "react";
import { Info } from "lucide-react";

import {
  saveDepositSettingsAction,
  saveLogoAction,
  saveSocialLinksAction,
  type ProfileActionResult,
} from "@/app/dashboard/settings/profile-actions";
import { cn } from "@/lib/utils";

import { ImageUpload } from "./image-upload";
import { useSectionForm, type SaveResult } from "./settings-dirty";
import { cardClass, inputClass } from "./ui";

/**
 * The logo.
 *
 * It briefly saved itself on upload, because a Save button under a single image
 * is a step whose only outcome is being forgotten. The save bar makes that
 * unnecessary and the special case actively confusing: with one control on the
 * page, an image that had already committed while everything else waited would
 * be the only thing an owner could not undo by pressing "ביטול".
 *
 * The preview still updates the moment the upload finishes — that is local
 * state, not a write.
 */
export function LogoForm({ initial }: { initial: string | null }) {
  const onSave = useCallback(
    async (value: string | null): Promise<SaveResult> => {
      const result: ProfileActionResult = await saveLogoAction(value);
      return result.ok ? { ok: true } : { ok: false, error: result.error };
    },
    [],
  );

  const { values, setValues } = useSectionForm<string | null>({
    id: "logo",
    label: "לוגו העסק",
    initial,
    onSave,
  });

  return (
    <div className={cn(cardClass, "p-5")}>
      <ImageUpload
        kind="logo"
        value={values}
        onChange={setValues}
        hint="מוצג בראש עמוד ההזמנות. תמונה מרובעת תיראה הכי טוב."
        removeLabel="הסרת הלוגו"
      />
    </div>
  );
}

export type SocialValues = {
  instagram: string;
  facebook: string;
  tiktok: string;
  whatsapp: string;
  website: string;
};

export type DepositValues = {
  enabled: boolean;
  mode: "manual" | "gateway";
  /** Shekels, not agorot — the form speaks the owner's units. */
  amount: number;
  bitPhone: string;
  paymentUrl: string;
  instructions: string;
};

const SOCIAL_FIELDS = [
  {
    key: "instagram" as const,
    label: "אינסטגרם",
    placeholder: "שם משתמש או קישור",
  },
  {
    key: "facebook" as const,
    label: "פייסבוק",
    placeholder: "שם עמוד או קישור",
  },
  { key: "tiktok" as const, label: "טיקטוק", placeholder: "שם משתמש או קישור" },
  { key: "whatsapp" as const, label: "וואטסאפ", placeholder: "050-0000000" },
  {
    key: "website" as const,
    label: "אתר אינטרנט",
    placeholder: "example.co.il",
  },
];

export function SocialLinksForm({ initial }: { initial: SocialValues }) {
  const onSave = useCallback(
    async (next: SocialValues): Promise<SaveResult> => {
      const result: ProfileActionResult = await saveSocialLinksAction(next);
      return result.ok ? { ok: true } : { ok: false, error: result.error };
    },
    [],
  );

  const { values, setValues } = useSectionForm<SocialValues>({
    id: "social",
    label: "רשתות חברתיות",
    initial,
    onSave,
  });

  return (
    <div className={cn(cardClass, "p-5")}>
      <p className="mb-4 text-xs leading-relaxed text-zinc-500">
        מה שתמלאו כאן יופיע כאייקונים בעמוד ההזמנות שלכם. אפשר להזין שם משתמש
        בלבד — נשלים את הכתובת המלאה.
      </p>

      <div className="space-y-3">
        {SOCIAL_FIELDS.map((field) => (
          <label key={field.key} className="block">
            <span className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
              {field.label}
            </span>
            <input
              value={values[field.key]}
              onChange={(e) =>
                setValues({ ...values, [field.key]: e.target.value })
              }
              placeholder={field.placeholder}
              // LTR because every one of these is a handle, a URL or a phone
              // number — none of them read right-to-left.
              dir="ltr"
              className={cn(inputClass, "text-start")}
            />
          </label>
        ))}
      </div>
    </div>
  );
}

/**
 * Deposit settings, shown with the feature plainly marked as not yet live.
 *
 * The alternative — hiding the section until the booking flow supports it —
 * would mean an owner turning it on later with no idea what it does. Showing it
 * labelled is honest; showing it *unlabelled* would be the bad option, because
 * a switch that appears to change something and does not is how trust in every
 * other switch goes.
 */
export function DepositSettingsForm({ initial }: { initial: DepositValues }) {
  const onSave = useCallback(
    async (next: DepositValues): Promise<SaveResult> => {
      const result: ProfileActionResult = await saveDepositSettingsAction(next);
      return result.ok ? { ok: true } : { ok: false, error: result.error };
    },
    [],
  );

  const { values, setValues } = useSectionForm<DepositValues>({
    id: "deposit",
    label: "מקדמה",
    initial,
    onSave,
  });

  return (
    <div className={cn(cardClass, "p-5")}>
      <p className="mb-4 flex items-start gap-2 rounded-xl bg-amber-50 px-4 py-3 text-xs leading-relaxed text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
        <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>
          התכונה הזו עדיין לא פעילה בעמוד ההזמנות. אפשר להגדיר אותה עכשיו — היא
          תיכנס לתוקף כשנפעיל אותה, ועד אז לקוחות לא יתבקשו לשלם מקדמה.
        </span>
      </p>

      <label className="flex items-center justify-between gap-3 py-2">
        <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
          גביית מקדמה בעת קביעת תור
        </span>
        <input
          type="checkbox"
          checked={values.enabled}
          onChange={(e) => setValues({ ...values, enabled: e.target.checked })}
          className="size-4 accent-zinc-900 dark:accent-zinc-100"
        />
      </label>

      <div className="mt-3 space-y-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
            אופן הגבייה
          </span>
          <select
            value={values.mode}
            onChange={(e) =>
              setValues({
                ...values,
                mode: e.target.value === "gateway" ? "gateway" : "manual",
              })
            }
            className={inputClass}
          >
            <option value="manual">העברה ידנית (ביט / פייבוקס)</option>
            <option value="gateway">סליקה אונליין (בקרוב)</option>
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
            סכום המקדמה (₪)
          </span>
          {/* A flat sum, never a percentage: the manual flow asks a person to
              transfer a specific number through Bit, and "30% of ₪180" is not
              a number people type correctly. */}
          <input
            type="number"
            dir="ltr"
            min={0}
            inputMode="numeric"
            value={values.amount}
            onChange={(e) =>
              setValues({ ...values, amount: Number(e.target.value) || 0 })
            }
            className={cn(inputClass, "text-start")}
          />
        </label>

        {values.mode === "manual" ? (
          <>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                מספר לביט
              </span>
              <input
                value={values.bitPhone}
                onChange={(e) =>
                  setValues({ ...values, bitPhone: e.target.value })
                }
                dir="ltr"
                inputMode="tel"
                placeholder="050-0000000"
                className={cn(inputClass, "text-start")}
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                קישור לתשלום (פייבוקס וכד׳)
              </span>
              <input
                value={values.paymentUrl}
                onChange={(e) =>
                  setValues({ ...values, paymentUrl: e.target.value })
                }
                dir="ltr"
                placeholder="https://payboxapp.page.link/..."
                className={cn(inputClass, "text-start")}
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                הוראות ללקוח (לא חובה)
              </span>
              <textarea
                value={values.instructions}
                onChange={(e) =>
                  setValues({ ...values, instructions: e.target.value })
                }
                rows={3}
                placeholder="נא לציין את שם הלקוח בהעברה"
                className={cn(inputClass, "h-auto py-2 leading-relaxed")}
              />
            </label>
          </>
        ) : (
          <p className="rounded-xl bg-zinc-50 px-4 py-3 text-xs leading-relaxed text-zinc-600 dark:bg-zinc-800/60 dark:text-zinc-400">
            סליקה אונליין תחייב חיבור לספק תשלומים. נעדכן כשזה יהיה זמין.
          </p>
        )}
      </div>
    </div>
  );
}
