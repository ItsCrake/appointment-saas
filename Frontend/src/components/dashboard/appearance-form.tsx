"use client";

import type { CSSProperties } from "react";

import { useCallback, useState } from "react";
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  Check,
  Image as ImageIcon,
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
import {
  CARD_STYLES,
  CARD_STYLE_HINTS,
  CARD_STYLE_LABELS,
  CORNER_STYLES,
  CORNER_STYLE_LABELS,
  HERO_OVERLAY_MAX,
  HERO_OVERLAY_MIN,
  SERVICE_LAYOUTS,
  SERVICE_LAYOUT_HINTS,
  SERVICE_LAYOUT_LABELS,
  type CardStyle,
  type CornerStyle,
  type ServiceLayout,
} from "@/lib/appearance";
import { cn } from "@/lib/utils";

/**
 * Each corner option wears its own radius on its own button, so the control
 * shows the answer instead of naming it. Mirrors the [data-corner] blocks in
 * globals.css; a test asserts the two lists agree.
 */
const CORNER_PREVIEW_RADIUS: Record<CornerStyle, string> = {
  soft: "0.5rem",
  rounded: "0.875rem",
  round: "1.5rem",
};

import { ImageUpload, UploadButton } from "./image-upload";
import { useSectionForm, type SaveResult } from "./settings-dirty";
import { btnPrimary } from "./ui";

type Props = {
  initial: {
    themeColor: ThemeColor;
    heroMediaUrl: string;
    heroMediaType: HeroMediaType | "";
    galleryUrls: string[];
    reviews: Review[];
    cardStyle: CardStyle;
    cornerStyle: CornerStyle;
    serviceLayout: ServiceLayout;
    heroOverlay: number;
  };
  /** The shop's own name, so the banner preview is theirs rather than a stub. */
  businessName: string;
};

const inputClass =
  "h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-transparent focus:ring-2 focus:ring-zinc-950 dark:focus:ring-white focus:outline-none dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100 ";

type Values = Props["initial"];

export function AppearanceForm({ initial, businessName }: Props) {
  const [galleryDraft, setGalleryDraft] = useState("");
  const [error, setError] = useState<string>();

  const onSave = useCallback(async (values: Values): Promise<SaveResult> => {
    setError(undefined);

    const result = await saveAppearanceAction({
      ...values,
      heroMediaUrl: values.heroMediaUrl.trim(),
    });

    if (result.ok) return { ok: true };
    setError(result.error);
    return { ok: false, error: result.error };
  }, []);

  const { values, setValues } = useSectionForm<Values>({
    id: "appearance",
    label: "עיצוב עמוד ההזמנות",
    initial,
    onSave,
  });

  const {
    themeColor,
    heroMediaUrl,
    heroMediaType,
    galleryUrls: gallery,
    reviews,
    cardStyle,
    cornerStyle,
    serviceLayout,
    heroOverlay,
  } = values;

  const previewName = businessName;

  /** Field setters, so the body below reads as it did before the refactor. */
  const setThemeColor = (next: ThemeColor) =>
    setValues((v) => ({ ...v, themeColor: next }));
  const setHeroMediaUrl = (next: string) =>
    setValues((v) => ({ ...v, heroMediaUrl: next }));
  const setHeroMediaType = (next: HeroMediaType | "") =>
    setValues((v) => ({ ...v, heroMediaType: next }));
  const setGallery = (next: string[] | ((current: string[]) => string[])) =>
    setValues((v) => ({
      ...v,
      galleryUrls: typeof next === "function" ? next(v.galleryUrls) : next,
    }));
  const setCardStyle = (next: CardStyle) =>
    setValues((v) => ({ ...v, cardStyle: next }));
  const setCornerStyle = (next: CornerStyle) =>
    setValues((v) => ({ ...v, cornerStyle: next }));
  const setServiceLayout = (next: ServiceLayout) =>
    setValues((v) => ({ ...v, serviceLayout: next }));
  const setHeroOverlay = (next: number) =>
    setValues((v) => ({ ...v, heroOverlay: next }));
  const setReviews = (next: Review[] | ((current: Review[]) => Review[])) =>
    setValues((v) => ({
      ...v,
      reviews: typeof next === "function" ? next(v.reviews) : next,
    }));

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
                "focus-visible:ring-2 focus-visible:ring-zinc-950 focus-visible:outline-none dark:focus-visible:ring-white",
                themeColor === colour
                  ? "border-(--accent) ring-1 ring-(--accent)"
                  : "border-zinc-200 hover:border-zinc-400 dark:border-zinc-800",
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
              <span className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400">
                {THEME_LABELS[colour]}
              </span>
            </button>
          ))}
        </div>

        <div className="mt-4 rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
          <p className="mb-2 text-xs text-zinc-500">תצוגה מקדימה</p>
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

      {/**
       * The dressing (0027).
       *
       * Placed directly under the colour picker because these four decide the
       * same thing it does — what the page *feels* like — and an owner who has
       * just chosen a swatch is already in that frame of mind. The banner and
       * gallery sections below are about supplying content, which is a
       * different job.
       *
       * The whole block is wrapped in the live `data-card` / `data-corner`
       * attributes, so the sample card underneath is rendered by the exact
       * tokens the booking page will use. It is not an illustration of the
       * setting; it is the setting.
       */}
      <Section
        title="סגנון הכרטיסים"
        description="איך נראים הכרטיסים והפינות בעמוד ההזמנות"
      >
        <div
          data-card={cardStyle}
          data-corner={cornerStyle}
          className="booking-wash -m-1 rounded-2xl p-1"
        >
          <fieldset>
            <legend className="mb-2 text-xs font-medium text-zinc-600 dark:text-zinc-400">
              משטח
            </legend>
            <div className="grid grid-cols-3 gap-2">
              {CARD_STYLES.map((style) => (
                <button
                  key={style}
                  type="button"
                  onClick={() => setCardStyle(style)}
                  aria-pressed={cardStyle === style}
                  className={cn(
                    "rounded-xl border p-2.5 text-start transition-all active:scale-95",
                    "focus-visible:ring-2 focus-visible:ring-zinc-950 focus-visible:outline-none dark:focus-visible:ring-white",
                    cardStyle === style
                      ? "border-(--accent) ring-1 ring-(--accent)"
                      : "border-zinc-200 hover:border-zinc-400 dark:border-zinc-800",
                  )}
                >
                  <span className="block text-xs font-semibold text-zinc-800 dark:text-zinc-200">
                    {CARD_STYLE_LABELS[style]}
                  </span>
                  <span className="mt-0.5 block text-[11px] leading-snug text-zinc-500">
                    {CARD_STYLE_HINTS[style]}
                  </span>
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset className="mt-4">
            <legend className="mb-2 text-xs font-medium text-zinc-600 dark:text-zinc-400">
              עיגול פינות
            </legend>
            <div className="grid grid-cols-3 gap-2">
              {CORNER_STYLES.map((corner) => (
                <button
                  key={corner}
                  type="button"
                  onClick={() => setCornerStyle(corner)}
                  aria-pressed={cornerStyle === corner}
                  className={cn(
                    "flex items-center justify-center gap-2 border p-2.5 text-xs font-semibold transition-all active:scale-95",
                    "focus-visible:ring-2 focus-visible:ring-zinc-950 focus-visible:outline-none dark:focus-visible:ring-white",
                    cornerStyle === corner
                      ? "border-(--accent) text-(--accent-on-soft) ring-1 ring-(--accent)"
                      : "border-zinc-200 text-zinc-600 hover:border-zinc-400 dark:border-zinc-800 dark:text-zinc-400",
                  )}
                  // Each option wears its own radius, so the control shows the
                  // answer rather than naming it.
                  style={{
                    borderRadius: CORNER_PREVIEW_RADIUS[corner],
                  }}
                >
                  {CORNER_STYLE_LABELS[corner]}
                </button>
              ))}
            </div>
          </fieldset>

          {/* Rendered by the live tokens, so this is the real card. */}
          <div className="mt-4 rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
            <p className="mb-2 text-xs text-zinc-500">תצוגה מקדימה</p>
            <div className="booking-card flex items-center gap-3 p-3">
              <span
                className="size-11 shrink-0 bg-(--accent-soft)"
                style={{ borderRadius: "var(--radius-inner)" }}
              />
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-semibold text-zinc-900 dark:text-zinc-100">
                  תספורת גבר
                </span>
                <span className="mt-1.5 flex items-center gap-2">
                  <span className="rounded-full bg-(--accent-soft) px-2 py-0.5 text-[10px] font-medium text-(--accent-on-soft)">
                    30 דק׳
                  </span>
                  <span className="text-[13px] font-bold text-zinc-900 tabular-nums dark:text-zinc-100">
                    ₪70
                  </span>
                </span>
              </span>
            </div>
          </div>
        </div>
      </Section>

      <Section
        title="תצוגת השירותים"
        description="רשימה מהירה, או כרטיסי תמונה לעסק שמוכר מראה"
      >
        <div className="grid grid-cols-2 gap-2">
          {SERVICE_LAYOUTS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setServiceLayout(option)}
              aria-pressed={serviceLayout === option}
              className={cn(
                "rounded-xl border p-3 text-start transition-all active:scale-95",
                "focus-visible:ring-2 focus-visible:ring-zinc-950 focus-visible:outline-none dark:focus-visible:ring-white",
                serviceLayout === option
                  ? "border-(--accent) ring-1 ring-(--accent)"
                  : "border-zinc-200 hover:border-zinc-400 dark:border-zinc-800",
              )}
            >
              <span className="block text-xs font-semibold text-zinc-800 dark:text-zinc-200">
                {SERVICE_LAYOUT_LABELS[option]}
              </span>
              <span className="mt-0.5 block text-[11px] leading-snug text-zinc-500">
                {SERVICE_LAYOUT_HINTS[option]}
              </span>
            </button>
          ))}
        </div>

        {/* Said out loud rather than left to be discovered. The page degrades
            to the list on its own when no service has a picture, and an owner
            who picked "תמונות" and saw a list would otherwise reasonably
            conclude the setting is broken. */}
        {serviceLayout === "showcase" ? (
          <p className="mt-3 text-xs leading-relaxed text-zinc-500">
            כל עוד לא הוספתם תמונות לשירותים, העמוד יציג רשימה. ההגדרה נשמרת —
            ברגע שתעלו תמונה, התצוגה תתחלף לבד.
          </p>
        ) : null}
      </Section>

      {/* Only meaningful when there is media under it, so it does not render
          without one — a slider that changes nothing visible is the shape of a
          control that appears to work and does not. */}
      {heroMediaUrl.trim() ? (
        <Section
          title="כהות הבאנר"
          description="כמה להכהות את התמונה מתחת לשם ולסמל"
        >
          <div className="flex items-center gap-3">
            <input
              id="heroOverlay"
              type="range"
              min={HERO_OVERLAY_MIN}
              max={HERO_OVERLAY_MAX}
              step={5}
              value={heroOverlay}
              onChange={(e) => setHeroOverlay(Number(e.target.value))}
              className="h-2 flex-1 cursor-pointer appearance-none rounded-full bg-zinc-200 accent-(--accent) dark:bg-zinc-800"
              aria-describedby="heroOverlayValue"
            />
            <output
              id="heroOverlayValue"
              htmlFor="heroOverlay"
              className="w-12 shrink-0 text-end text-xs font-semibold text-zinc-600 tabular-nums dark:text-zinc-400"
            >
              {heroOverlay}%
            </output>
          </div>

          {/* The owner's own banner under the owner's own value. Nothing here
              is a stand-in, so what they approve is what ships. */}
          <div
            className="relative mt-3 aspect-[16/9] w-full overflow-hidden"
            style={
              {
                borderRadius: "var(--radius-card)",
                "--hero-overlay": heroOverlay / 100,
              } as CSSProperties
            }
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- per-tenant remote host */}
            <img
              src={heroMediaUrl.trim()}
              alt=""
              className="size-full object-cover"
            />
            <span aria-hidden className="hero-scrim absolute inset-0" />
            <span className="absolute inset-x-0 bottom-0 p-3 text-center text-sm font-bold text-white">
              {previewName}
            </span>
          </div>
        </Section>
      ) : null}

      <Section
        title="באנר עליון"
        description="תמונה או וידאו שיוצגו ברקע בראש עמוד ההזמנות"
      >
        <ImageUpload
          kind="hero"
          shape="wide"
          value={heroMediaUrl || null}
          // The preview renders a `<video>` or an `<img>` from this, so a clip
          // is no longer a broken image icon in the settings page.
          valueType={heroMediaType === "video" ? "video" : "image"}
          onChange={(url, mediaType) => {
            setHeroMediaUrl(url ?? "");
            // The pair moves together — the CHECK constraint in 0009 requires
            // it, and a type left behind by a removal would fail on save. The
            // type comes from the server's own reading of the content type
            // rather than from anything the browser guessed.
            setHeroMediaType(url ? mediaType : "");
          }}
          hint="תמונה ברוחב 1600 פיקסלים, או סרטון קצר עד 25MB. סרטון מתנגן מושתק ובלולאה."
          removeLabel="הסרת הבאנר"
        />

        <p className="mt-4 mb-1 text-xs font-medium text-zinc-600 dark:text-zinc-400">
          או הדבקת כתובת של מדיה שמאוחסנת במקום אחר
        </p>

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
                  : "border-zinc-200 text-zinc-600 hover:border-zinc-400 dark:border-zinc-800 dark:text-zinc-400",
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
            className="h-9 rounded-lg border border-zinc-200 px-3 text-xs font-semibold text-zinc-500 transition-colors hover:border-zinc-400 dark:border-zinc-800"
          >
            ניקוי
          </button>
        </div>

        <p className="mt-2 text-xs text-zinc-500">
          וידאו מתנגן מושתק ובלולאה. מומלץ קובץ קצר וקל.
        </p>
      </Section>

      <Section
        title="גלריה"
        description={`עד ${MAX_GALLERY_IMAGES} תמונות. הסדר כאן הוא הסדר בעמוד.`}
      >
        <UploadButton
          kind="gallery"
          label="העלאת תמונה לגלריה"
          disabled={gallery.length >= MAX_GALLERY_IMAGES}
          className="mb-3"
          onUploaded={(url) => {
            // Re-checked at the moment of arrival, not only when the button was
            // rendered: two uploads can be in flight at once, and the second
            // one lands after the first has already taken the last slot.
            if (gallery.length >= MAX_GALLERY_IMAGES) {
              setError(`אפשר להוסיף עד ${MAX_GALLERY_IMAGES} תמונות`);
              return;
            }
            setGallery((current) => [...current, url]);
            setError(undefined);
          }}
        />

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
            className={cn(btnPrimary, "shrink-0 px-4")}
          >
            <Plus className="size-4" aria-hidden />
            הוספה
          </button>
        </div>

        {gallery.length === 0 ? (
          <p className="mt-3 flex items-center gap-2 rounded-xl border border-dashed border-zinc-300 px-4 py-6 text-xs text-zinc-500 dark:border-zinc-700">
            <ImageIcon className="size-4 shrink-0" aria-hidden />
            עדיין לא הוספתם תמונות
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {gallery.map((url, index) => (
              <li
                key={`${url}-${index}`}
                className="flex items-center gap-2 rounded-xl border border-zinc-200 p-2 dark:border-zinc-800"
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- owner-supplied remote host */}
                <img
                  src={url}
                  alt=""
                  className="size-12 shrink-0 rounded-lg bg-zinc-100 object-cover dark:bg-zinc-800"
                />
                <span
                  dir="ltr"
                  className="min-w-0 flex-1 truncate text-start text-xs text-zinc-500"
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
          <p className="rounded-xl border border-dashed border-zinc-300 px-4 py-6 text-center text-xs text-zinc-500 dark:border-zinc-700">
            אין עדיין חוות דעת
          </p>
        ) : (
          <ul className="space-y-3">
            {reviews.map((review) => (
              <li
                key={review.id}
                className="space-y-2 rounded-xl border border-zinc-200 p-3 dark:border-zinc-800"
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
                      className="rounded p-0.5 focus-visible:ring-2 focus-visible:ring-zinc-950 focus-visible:outline-none dark:focus-visible:ring-white"
                    >
                      <Star
                        className={cn(
                          "size-5 transition-colors",
                          value <= review.rating
                            ? "fill-amber-400 text-amber-400"
                            : "fill-zinc-200 text-zinc-200 dark:fill-zinc-700 dark:text-zinc-700",
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
          className="mt-3 flex h-10 w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-zinc-300 text-sm font-semibold text-zinc-600 transition-colors hover:border-zinc-500 hover:text-zinc-900 dark:border-zinc-700 dark:text-zinc-400"
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
    <section className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
        {title}
      </h2>
      <p className="mt-0.5 mb-3 text-xs text-zinc-500">{description}</p>
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
        "flex size-9 shrink-0 items-center justify-center rounded-lg border border-zinc-200 transition-colors disabled:opacity-30 dark:border-zinc-800",
        destructive
          ? "text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40"
          : "text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800",
      )}
    >
      {children}
    </button>
  );
}
