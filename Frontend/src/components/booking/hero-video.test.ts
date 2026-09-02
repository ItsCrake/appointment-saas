import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The banner video's autoplay contract.
 *
 * ---------------------------------------------------------------------------
 * **Four attributes, and mobile refuses without all four.** `autoplay` alone is
 * ignored; a browser will only start an unprompted clip if it is also `muted`,
 * and iOS Safari additionally refuses anything without `playsinline` — it takes
 * the video fullscreen instead, over the booking page, on the tap that was
 * meant to choose a haircut. `loop` is what makes it a background rather than a
 * clip that plays once and freezes on whatever frame it ended on.
 *
 * None of that fails loudly. Remove `muted` and the page still renders, the
 * video still loads, the first frame still paints — it simply never starts, and
 * only on a real device, which is the one place this is hard to notice.
 *
 * A source assertion because there is no seam: this is static JSX in a server
 * component, and the repository has no DOM to render it into. The house pattern
 * for exactly this is `demo-links.test.ts`.
 * ---------------------------------------------------------------------------
 */
const SOURCE = readFileSync(
  path.resolve(process.cwd(), "src/components/booking/business-header.tsx"),
  "utf8",
);

/** The `<video …>` element's own attributes, not the whole file. */
const VIDEO_TAG = (() => {
  const open = SOURCE.indexOf("<video");
  expect(open, "business-header renders a <video>").toBeGreaterThan(-1);
  return SOURCE.slice(open, SOURCE.indexOf("/>", open));
})();

describe("the banner video autoplays on a phone", () => {
  it.each(["autoPlay", "muted", "loop", "playsInline"])(
    "keeps %s, without which mobile refuses to start it",
    (attribute) => {
      expect(VIDEO_TAG).toContain(attribute);
    },
  );

  it("stays a background rather than a player", () => {
    /**
     * A decorative clip that offers controls invites a tap that pauses the
     * banner with no obvious way back, and picture-in-picture offers to pop a
     * shop's storefront out over the whole phone.
     */
    expect(VIDEO_TAG).toContain("controls={false}");
    expect(VIDEO_TAG).toContain("disablePictureInPicture");
  });

  it("is hidden from assistive tech and from the tab order", () => {
    // It carries nothing the page does not already say in text, and a focus
    // stop on an inert decoration is a keyboard user's wasted keystroke.
    expect(VIDEO_TAG).toContain("aria-hidden");
    expect(VIDEO_TAG).toContain("tabIndex={-1}");
  });

  it("reserves its space before it loads", () => {
    /**
     * The banner's height comes from an aspect ratio on the wrapper, not from
     * the media, so the column below it does not move when the first frame
     * arrives — measured at 0 layout shift. A fixed height here would be fine
     * too; what must not happen is the box being sized by the video.
     */
    expect(SOURCE).toMatch(/aspect-\[4\/3\]/);
    expect(SOURCE).toMatch(/sm:aspect-\[16\/9\]/);
  });
});
