"use client";

import { useState } from "react";
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  Check,
  Image as ImageIcon,
  Loader2,
  Plus,
  Star,
  Trash2,
} from "lucide-react";

import { saveAppearanceAction } from "@/app/dashboard/settings/appearance-actions";
import {
  isSafeMediaUrl,
  MAX_GALLERY_IMAGES,
  MAX_REVIEWS,
  THEME_COLORS,
  THEME_LABELS,
  type HeroMediaType,
  type Review,
  type ThemeColor,
} from "@/lib/branding";
import { cn } from "@/lib/utils";

type Props = {
  initial: {
    themeColor: ThemeColor;
    heroMediaUrl: string;
    heroMediaType: HeroMediaType | "";
    galleryUrls: string[];
    reviews: Review[];
  };
};

const inputClass =
  "h-11 w-full rounded-xl border border-neutral-200 bg-white px-3 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-transparent focus:ring-2 focus:ring-teal-700 focus:outline-none dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100 ";

export function AppearanceForm({ initial }: Props) {
  const [themeColor, setThemeColor] = useState<ThemeColor>(initial.themeColor);
  const [heroMediaUrl, setHeroMediaUrl] = useState(initial.heroMediaUrl);
  const [heroMediaType, setHeroMediaType] = useState<HeroMediaType | "">(
    initial.heroMediaType,
  );
  const [gallery, setGallery] = useState<string[]>(initial.galleryUrls);
  const [reviews, setReviews] = useState<Review[]>(initial.reviews);

  const [galleryDraft, setGalleryDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);

  function addGalleryImage() {
    const url = galleryDraft.trim();
    if (!url) return;
    if (!isSafeMediaUrl(url)) {
      setError("כתובת התמונה חייבת להתחיל ב-http או https");
      return;
    }
    if (gallery.length >= MAX_GALLERY_IMAGES) {
      setError(`אפשר להוסיף עד ${MAX_GALLERY_IMAGES} תמונות`);
      return;
    }
    setGallery((current) => [...current, url]);
    setGalleryDraft("");
    setError(undefined);
  }

  /** Array position is the display order, so reordering is a swap. */
  function moveImage(index: number, delta: number) {
    setGallery((current) => {
      const target = index + delta;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function addReview() {
    if (reviews.length >= MAX_REVIEWS) {
      setError(`אפשר להוסיף עד ${MAX_REVIEWS} חוות דעת`);
      return;
    }
    setReviews((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        clientName: "",
        rating: 5,
        comment: "",
        date: new Date().toISOString().slice(0, 10),
      },
    ]);
  }

  function patchReview(id: string, patch: Partial<Review>) {
    setReviews((current) =>
      current.map((r) => (r.id === id ? { ...r, ...patch } : r)),
    );
  }

  async function save() {
    setSaving(true);
    setError(undefined);
    setSaved(false);

    const result = await saveAppearanceAction({
      themeColor,
      heroMediaUrl: heroMediaUrl.trim(),
      heroMediaType,
      galleryUrls: gallery,
      reviews,
    });

    setSaving(false);
    if (result.ok) {
      setSaved(true);
    } else {
      setError(result.error);
    }
  }

  return (
    // The preview below inherits these custom properties, so the swatch choice
    // is visible before it is ever saved.
    <div data-accent={themeColor} className="space-y-6">
      <Section title="צבע העסק" description="הצבע המודגש בעמוד ההזמנות שלכם">
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
          {THEME_COLORS.map((colour) => (
            <button
              key={colour}
              type="button"
              onClick={() => setThemeColor(colour)}
              aria-pressed={themeColor === colour}
              data-accent={colour}
              className={cn(
                "flex flex-col items-center gap-1.5 rounded-xl border p-2.5 transition-all active:scale-95",
                "focus-visible:ring-2 focus-visible:ring-teal-700 focus-visible:outline-none",
                themeColor === colour
                  ? "border-(--accent) ring-1 ring-(--accent)"
                  : "border-neutral-200 hover:border-neutral-400 dark:border-neutral-800",
              )}
            >
              <span className="relative flex size-7 items-center justify-center rounded-full bg-(--accent)">
                {themeColor === colour ? (
                  <Check
                    className="size-4 text-(--accent-contrast)"
                    strokeWidth={3}
                    aria-hidden
                  />
                ) : null}
              </span>
              <span className="text-[11px] font-medium text-neutral-600 dark:text-neutral-400">
                {THEME_LABELS[colour]}
              </span>
            </button>
          ))}
        </div>

        <div className="mt-4 rounded-xl border border-neutral-200 p-3 dark:border-neutral-800">
          <p className="mb-2 text-xs text-neutral-500">תצוגה מקדימה</p>
          <div className="flex items-center gap-2">
            <span className="flex h-9 items-center rounded-lg bg-(--accent) px-3 text-xs font-semibold text-(--accent-contrast)">
              אישור וקביעת התור
            </span>
            <span className="flex h-9 items-center rounded-lg border border-(--accent-soft-border) bg-(--accent-soft) px-3 text-xs font-semibold text-(--accent-on-soft)">
              09:00
            </span>
          </div>
        </div>
      </Section>

      <Section
        title="באנר עליון"
        description="תמונה או וידאו שיוצגו ברקע בראש עמוד ההזמנות"
      >
        <label htmlFor="heroUrl" className="sr-only">
          כתובת מדיה
        </label>
        <input
          id="heroUrl"
          type="url"
          dir="ltr"
          inputMode="url"
          placeholder="https://example.com/banner.jpg"
          value={heroMediaUrl}
          onChange={(e) => setHeroMediaUrl(e.target.value)}
          className={cn(inputClass, "text-start")}
        />

        <div className="mt-2 flex gap-2">
          {(["image", "video"] as const).map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => setHeroMediaType(type)}
              aria-pressed={heroMediaType === type}
              className={cn(
                "h-9 flex-1 rounded-lg border text-xs font-semibold transition-colors",
                heroMediaType === type
                  ? "border-(--accent) bg-(--accent) text-(--accent-contrast)"
                  : "border-neutral-200 text-neutral-600 hover:border-neutral-400 dark:border-neutral-800 dark:text-neutral-400",
              )}
            >
              {type === "image" ? "תמונה" : "וידאו"}
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              setHeroMediaUrl("");
              setHeroMediaType("");
            }}
            className="h-9 rounded-lg border border-neutral-200 px-3 text-xs font-semibold text-neutral-500 transition-colors hover:border-neutral-400 dark:border-neutral-800"
          >
            ניקוי
          </button>
        </div>

        <p className="mt-2 text-xs text-neutral-500">
          וידאו מתנגן מושתק ובלולאה. מומלץ קובץ קצר וקל.
        </p>
      </Section>

      <Section
        title="גלריה"
        description={`עד ${MAX_GALLERY_IMAGES} תמונות. הסדר כאן הוא הסדר בעמוד.`}
      >
        <div className="flex gap-2">
          <label htmlFor="galleryUrl" className="sr-only">
            כתובת תמונה
          </label>
          <input
            id="galleryUrl"
            type="url"
            dir="ltr"
            placeholder="https://example.com/photo.jpg"
            value={galleryDraft}
            onChange={(e) => setGalleryDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addGalleryImage();
              }
            }}
            className={cn(inputClass, "text-start")}
          />
          <button
            type="button"
            onClick={addGalleryImage}
            className="flex h-11 shrink-0 items-center gap-1 rounded-xl bg-teal-700 px-3 text-sm font-semibold text-white transition-colors hover:bg-teal-800"
          >
            <Plus className="size-4" aria-hidden />
            הוספה
          </button>
        </div>

        {gallery.length === 0 ? (
          <p className="mt-3 flex items-center gap-2 rounded-xl border border-dashed border-neutral-300 px-4 py-6 text-xs text-neutral-500 dark:border-neutral-700">
            <ImageIcon className="size-4 shrink-0" aria-hidden />
            עדיין לא הוספתם תמונות
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {gallery.map((url, index) => (
              <li
                key={`${url}-${index}`}
                className="flex items-center gap-2 rounded-xl border border-neutral-200 p-2 dark:border-neutral-800"
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- owner-supplied remote host */}
                <img
                  src={url}
                  alt=""
                  className="size-12 shrink-0 rounded-lg bg-neutral-100 object-cover dark:bg-neutral-800"
                />
                <span
                  dir="ltr"
                  className="min-w-0 flex-1 truncate text-start text-xs text-neutral-500"
                >
                  {url}
                </span>
                <IconButton
                  label="הזזה למעלה"
                  disabled={index === 0}
                  onClick={() => moveImage(index, -1)}
                >
                  <ArrowUp className="size-4" aria-hidden />
                </IconButton>
                <IconButton
                  label="הזזה למטה"
                  disabled={index === gallery.length - 1}
                  onClick={() => moveImage(index, 1)}
                >
                  <ArrowDown className="size-4" aria-hidden />
                </IconButton>
                <IconButton
                  label="מחיקה"
                  destructive
                  onClick={() =>
                    setGallery((c) => c.filter((_, i) => i !== index))
                  }
                >
                  <Trash2 className="size-4" aria-hidden />
                </IconButton>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section
        title="חוות דעת"
        description="עדויות לקוחות שיוצגו בתחתית עמוד ההזמנות"
      >
        {reviews.length === 0 ? (
          <p className="rounded-xl border border-dashed border-neutral-300 px-4 py-6 text-center text-xs text-neutral-500 dark:border-neutral-700">
            אין עדיין חוות דעת
          </p>
        ) : (
          <ul className="space-y-3">
            {reviews.map((review) => (
              <li
                key={review.id}
                className="space-y-2 rounded-xl border border-neutral-200 p-3 dark:border-neutral-800"
              >
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="שם הלקוח"
                    aria-label="שם הלקוח"
                    value={review.clientName}
                    onChange={(e) =>
                      patchReview(review.id, { clientName: e.target.value })
                    }
                    className={inputClass}
                  />
                  <input
                    type="date"
                    aria-label="תאריך"
                    value={review.date}
                    onChange={(e) =>
                      patchReview(review.id, { date: e.target.value })
                    }
                    className={cn(inputClass, "w-40 shrink-0")}
                  />
                  <IconButton
                    label="מחיקה"
                    destructive
                    onClick={() =>
                      setReviews((c) => c.filter((r) => r.id !== review.id))
                    }
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </IconButton>
                </div>

                <div
                  role="radiogroup"
                  aria-label="דירוג"
                  className="flex items-center gap-1"
                >
                  {[1, 2, 3, 4, 5].map((value) => (
                    <button
                      key={value}
                      type="button"
                      role="radio"
                      aria-checked={review.rating === value}
                      aria-label={`${value} כוכבים`}
                      onClick={() => patchReview(review.id, { rating: value })}
                      className="rounded p-0.5 focus-visible:ring-2 focus-visible:ring-teal-700 focus-visible:outline-none"
                    >
                      <Star
                        className={cn(
                          "size-5 transition-colors",
                          value <= review.rating
                            ? "fill-amber-400 text-amber-400"
                            : "fill-neutral-200 text-neutral-200 dark:fill-neutral-700 dark:text-neutral-700",
                        )}
                        aria-hidden
                      />
                    </button>
                  ))}
                </div>

                <textarea
                  rows={2}
                  placeholder="מה הלקוח כתב?"
                  aria-label="חוות הדעת"
                  value={review.comment}
                  onChange={(e) =>
                    patchReview(review.id, { comment: e.target.value })
                  }
                  className={cn(inputClass, "h-auto resize-none py-2")}
                />
              </li>
            ))}
          </ul>
        )}

        <button
          type="button"
          onClick={addReview}
          className="mt-3 flex h-10 w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-neutral-300 text-sm font-semibold text-neutral-600 transition-colors hover:border-neutral-500 hover:text-neutral-900 dark:border-neutral-700 dark:text-neutral-400"
        >
          <Plus className="size-4" aria-hidden />
          הוספת חוות דעת
        </button>
      </Section>

      {error ? (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
          {error}
        </p>
      ) : null}

      {saved ? (
        <p
          role="status"
          className="flex items-center gap-2 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200"
        >
          <Check className="size-4 shrink-0" aria-hidden />
          העיצוב נשמר
        </p>
      ) : null}

      <button
        type="button"
        onClick={save}
        disabled={saving}
        className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-teal-700 text-sm font-semibold text-white transition-colors hover:bg-teal-800 disabled:opacity-60"
      >
        {saving ? (
          <>
            <Loader2 className="size-4 animate-spin" aria-hidden />
            שומר…
          </>
        ) : (
          "שמירת העיצוב"
        )}
      </button>
    </div>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
        {title}
      </h2>
      <p className="mt-0.5 mb-3 text-xs text-neutral-500">{description}</p>
      {children}
    </section>
  );
}

function IconButton({
  label,
  onClick,
  disabled,
  destructive,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  destructive?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={cn(
        "flex size-9 shrink-0 items-center justify-center rounded-lg border border-neutral-200 transition-colors disabled:opacity-30 dark:border-neutral-800",
        destructive
          ? "text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40"
          : "text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800",
      )}
    >
      {children}
    </button>
  );
}
