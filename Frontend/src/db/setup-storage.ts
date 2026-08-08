import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

import {
  ACCEPTED_IMAGE_TYPES,
  MAX_UPLOAD_BYTES,
  MEDIA_BUCKET,
} from "@/lib/media-upload";

dotenv.config({ path: ".env.local", quiet: true });

/**
 * `npm run storage:setup` — creates the public media bucket, idempotently.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS NOT A MIGRATION
 *
 * It looks like schema, and Supabase Storage *is* Postgres tables underneath —
 * so the obvious move is a `0019_storage.sql` that inserts into
 * `storage.buckets`. That would break the entire test suite: the suite runs the
 * real migration files against PGlite, which is a bare Postgres with no
 * `storage` schema in it at all. Every migration in this project has to be
 * runnable somewhere that has never heard of Supabase.
 *
 * So it lives here, beside the other operational scripts, and talks to the
 * Storage API rather than to the tables behind it.
 *
 * WHAT IT SETS, AND WHY THOSE ARE THE REAL LIMITS
 *
 * `file_size_limit` and `allowed_mime_types` are enforced by the storage server
 * on every request, signed or not. The checks in the browser and in
 * `requestMediaUploadAction` exist to produce a good error message quickly;
 * these two are what a crafted request cannot get past.
 *
 * The bucket is public-read. It holds logos, banners, gallery photos and staff
 * portraits — every one of which is already displayed on an unauthenticated
 * booking page, so a signed read URL would protect nothing and would expire
 * inside a page that is meant to be shareable.
 *
 * There are deliberately **no RLS policies for writing**. Nothing authenticates
 * to this bucket as a user: uploads arrive on a signed URL minted server-side
 * after `requireWritable()`, which needs no `objects` permission at all.
 * ---------------------------------------------------------------------------
 */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

if (!url || !serviceRoleKey) {
  console.error(
    `${RED}✗ Missing configuration${RESET}\n\n` +
      "  NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be set.\n" +
      `  ${DIM}Supabase → Project Settings → API → service_role.${RESET}\n` +
      `  ${DIM}The service_role key is an admin key: keep it out of the client and out of git.${RESET}\n`,
  );
  process.exit(1);
}

const supabase = createClient(url, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const options = {
  public: true,
  fileSizeLimit: MAX_UPLOAD_BYTES,
  allowedMimeTypes: [...ACCEPTED_IMAGE_TYPES],
};

async function main() {
  console.log(`\nStorage setup ${DIM}(${url})${RESET}\n`);

  const existing = await supabase.storage.getBucket(MEDIA_BUCKET);

  if (existing.data) {
    // Updated rather than left alone: the limits are defined in code, and a
    // bucket created by hand in the dashboard almost certainly has neither.
    const { error } = await supabase.storage.updateBucket(
      MEDIA_BUCKET,
      options,
    );
    if (error) {
      console.error(`${RED}✗ Could not update "${MEDIA_BUCKET}"${RESET}`);
      console.error(`  ${error.message}\n`);
      process.exitCode = 1;
      return;
    }
    console.log(`  ${GREEN}✓${RESET} bucket "${MEDIA_BUCKET}" updated`);
  } else {
    const { error } = await supabase.storage.createBucket(
      MEDIA_BUCKET,
      options,
    );
    if (error) {
      console.error(`${RED}✗ Could not create "${MEDIA_BUCKET}"${RESET}`);
      console.error(`  ${error.message}\n`);
      process.exitCode = 1;
      return;
    }
    console.log(`  ${GREEN}✓${RESET} bucket "${MEDIA_BUCKET}" created`);
  }

  console.log(
    `  ${DIM}public read · max ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB · ${ACCEPTED_IMAGE_TYPES.join(", ")}${RESET}\n`,
  );
  console.log(
    `${GREEN}✓ Ready${RESET} — owners can upload images from the dashboard.\n`,
  );
}

main();
