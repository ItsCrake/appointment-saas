"use client";

import { useEffect, useId, useRef, useState } from "react";
import { AlertCircle, ImagePlus, Trash2, Upload } from "lucide-react";

import { requestMediaUploadAction } from "@/app/dashboard/media-actions";
import {
  acceptsVideo,
  describeUploadProblem,
  uploadAccept,
  type MediaKind,
} from "@/lib/media-upload";
import { cn } from "@/lib/utils";

import { btnSecondary } from "./ui";

/**
 * Uploads one image straight from the browser to Supabase Storage.
 *
 * The server is asked only for a **ticket** — a signed URL good for one path —
 * and never sees the bytes. `lib/media-upload.ts` has the reasoning; the part
 * that matters here is that the request below goes to Supabase, not to us, so
 * a 5MB photo on a phone connection is one upload rather than two.
 *
 * `XMLHttpRequest` rather than `fetch`, for the one thing fetch still cannot
 * do: report upload progress. A spinner that sits still for twenty seconds on
 * cellular data is how people conclude the app is broken and leave.
 */

/** A year. Safe because every upload gets a fresh UUID path — the bytes at a
 *  given URL never change, so there is nothing for a stale cache to get wrong. */
const CACHE_CONTROL = "31536000";

type UploadState =
  | { phase: "idle" }
  | { phase: "uploading"; progress: number }
  | { phase: "error"; message: string };

function put(
  url: string,
  apiKey: string,
  file: File,
  onProgress: (fraction: number) => void,
  register: (xhr: XMLHttpRequest) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    register(xhr);

    xhr.open("PUT", url);
    // The permit is the `token` already in the query string; these two are what
    // the Supabase gateway wants on any storage call, and both are public keys.
    xhr.setRequestHeader("apikey", apiKey);
    xhr.setRequestHeader("authorization", `Bearer ${apiKey}`);
    // A path is only ever issued once, so an overwrite would mean something has
    // gone wrong rather than that the owner meant it.
    xhr.setRequestHeader("x-upsert", "false");

    xhr.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    });

    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`upload failed with ${xhr.status}`));
    });
    xhr.addEventListener("error", () => reject(new Error("network error")));
    xhr.addEventListener("abort", () => reject(new Error("aborted")));

    // Multipart, matching what supabase-js sends for a Blob body. Content-Type
    // is deliberately unset: the browser has to add the multipart boundary.
    const body = new FormData();
    body.append("cacheControl", CACHE_CONTROL);
    body.append("", file);
    xhr.send(body);
  });
}

/**
 * The button on its own, for callers that append to a list rather than
 * replacing a single value.
 */
export function UploadButton({
  kind,
  onUploaded,
  label = "העלאת תמונה",
  disabled,
  className,
}: {
  kind: MediaKind;
  /** `mediaType` matters only to the hero, which stores it alongside the URL. */
  onUploaded: (url: string, mediaType: "image" | "video") => void;
  label?: string;
  disabled?: boolean;
  className?: string;
}) {
  const inputId = useId();
  const [state, setState] = useState<UploadState>({ phase: "idle" });

  // Abort in flight on unmount, so closing an editor mid-upload does not leave
  // a request running against a component that no longer exists.
  const requestRef = useRef<XMLHttpRequest>(null);
  useEffect(
    () => () => {
      requestRef.current?.abort();
      requestRef.current = null;
    },
    [],
  );

  const uploading = state.phase === "uploading";

  async function handleFile(file: File) {
    // Checked here first purely for speed — the action checks the same rule
    // with the same function, and the bucket enforces the outer bound.
    const problem = describeUploadProblem(file, kind);
    if (problem) {
      setState({ phase: "error", message: problem });
      return;
    }

    setState({ phase: "uploading", progress: 0 });

    const ticket = await requestMediaUploadAction({
      kind,
      contentType: file.type,
      size: file.size,
    });

    if (!ticket.ok) {
      setState({ phase: "error", message: ticket.error });
      return;
    }

    try {
      await put(
        ticket.uploadUrl,
        ticket.apiKey,
        file,
        (fraction) =>
          setState({
            phase: "uploading",
            progress: Math.round(fraction * 100),
          }),
        (xhr) => {
          requestRef.current = xhr;
        },
      );
    } catch {
      // An aborted upload belongs to a component that is going away; setting
      // state on it would be pointless and the message would never be read.
      if (requestRef.current === null) return;
      setState({
        phase: "error",
        message: "ההעלאה נכשלה. בדקו את החיבור ונסו שוב.",
      });
      return;
    }

    requestRef.current = null;
    setState({ phase: "idle" });
    onUploaded(ticket.publicUrl, ticket.mediaType);
  }

  return (
    <div className={className}>
      {/* A real <input> behind a <label>, rather than a button that clicks a
          hidden input: this keeps the control reachable by keyboard and by
          assistive tech without any JavaScript standing in for the browser. */}
      <input
        id={inputId}
        type="file"
        // Per kind: the hero's picker offers video, everything else does not.
        // A picker that offers more than the validator accepts produces a
        // rejection *after* the owner has chosen, which reads as a bug.
        accept={uploadAccept(kind)}
        disabled={disabled || uploading}
        className="peer sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          // Cleared so picking the same file twice still fires a change — after
          // a failed upload, retrying with the same photo is the likely next
          // thing an owner does.
          event.target.value = "";
          if (file) void handleFile(file);
        }}
      />

      <label
        htmlFor={inputId}
        aria-disabled={disabled || uploading}
        className={cn(
          btnSecondary,
          "h-10 w-full cursor-pointer px-4 text-xs",
          "peer-focus-visible:ring-2 peer-focus-visible:ring-zinc-950 dark:peer-focus-visible:ring-white",
          (disabled || uploading) && "pointer-events-none opacity-60",
        )}
      >
        <Upload className="size-4" aria-hidden />
        {uploading ? `מעלה… ${state.progress}%` : label}
      </label>

      {uploading ? (
        <div
          role="progressbar"
          aria-valuenow={state.progress}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="התקדמות ההעלאה"
          className="mt-2 h-1 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800"
        >
          <div
            className="h-full bg-zinc-950 transition-[width] duration-150 dark:bg-zinc-50"
            style={{ width: `${state.progress}%` }}
          />
        </div>
      ) : null}

      {state.phase === "error" ? (
        <p
          role="alert"
          className="mt-2 flex items-start gap-1.5 text-xs text-red-600 dark:text-red-400"
        >
          <AlertCircle className="mt-px size-3.5 shrink-0" aria-hidden />
          {state.message}
        </p>
      ) : null}
    </div>
  );
}

/**
 * A single image with its preview, for a field that holds one URL.
 *
 * `onChange` hands back the public URL — or null when the owner removes it. It
 * does **not** save: the caller decides whether that means "write it now" or
 * "hold it until the form is submitted", and both callers exist.
 */
export function ImageUpload({
  kind,
  value,
  valueType = "image",
  onChange,
  shape = "circle",
  hint,
  disabled,
  removeLabel = "הסרה",
}: {
  kind: MediaKind;
  value: string | null;
  /** What `value` points at. Only the hero can ever be `"video"`. */
  valueType?: "image" | "video";
  onChange: (url: string | null, mediaType: "image" | "video") => void;
  /** `circle` for a logo or a portrait, `wide` for a banner. */
  shape?: "circle" | "wide";
  hint?: string;
  disabled?: boolean;
  removeLabel?: string;
}) {
  const takesVideo = acceptsVideo(kind);
  const frame =
    shape === "circle"
      ? "size-20 shrink-0 rounded-full"
      : "aspect-[16/9] w-full rounded-xl";

  return (
    <div
      className={cn(
        "flex gap-4",
        shape === "circle" ? "items-center" : "flex-col",
      )}
    >
      {value && valueType === "video" ? (
        // Muted and looping in the preview too, so what an owner approves here
        // is what a client will see. Not `autoPlay`: a settings page that
        // starts playing on load is startling, and the poster frame is enough
        // to confirm the right file was picked.
        <video
          src={value}
          muted
          loop
          playsInline
          controls
          preload="metadata"
          className={cn(
            frame,
            "border border-zinc-200 bg-zinc-900 object-cover dark:border-zinc-800",
          )}
        />
      ) : value ? (
        // eslint-disable-next-line @next/next/no-img-element -- owner-supplied host, unknown at build time
        <img
          src={value}
          alt=""
          className={cn(
            frame,
            "border border-zinc-200 bg-zinc-100 object-cover dark:border-zinc-800 dark:bg-zinc-800",
          )}
        />
      ) : (
        <div
          aria-hidden
          className={cn(
            frame,
            "flex items-center justify-center border border-dashed border-zinc-300 text-zinc-400 dark:border-zinc-700",
          )}
        >
          <ImagePlus className="size-5" aria-hidden />
        </div>
      )}

      <div className="min-w-0 flex-1">
        <UploadButton
          kind={kind}
          disabled={disabled}
          label={
            takesVideo
              ? value
                ? "החלפת המדיה"
                : "העלאת תמונה או סרטון"
              : value
                ? "החלפת התמונה"
                : "העלאת תמונה"
          }
          onUploaded={onChange}
        />

        {hint ? (
          <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-500">
            {hint}
          </p>
        ) : null}

        {value ? (
          <button
            type="button"
            disabled={disabled}
            // The type travels with the removal so the caller can clear the
            // pair together — 0009's CHECK constraint rejects a stray type.
            onClick={() => onChange(null, "image")}
            className="mt-1.5 inline-flex items-center gap-1 rounded-lg text-[11px] font-medium text-zinc-500 transition-colors hover:text-red-600 disabled:opacity-60"
          >
            <Trash2 className="size-3.5" aria-hidden />
            {removeLabel}
          </button>
        ) : null}
      </div>
    </div>
  );
}
