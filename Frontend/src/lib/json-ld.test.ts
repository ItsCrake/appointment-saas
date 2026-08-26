import { describe, expect, it } from "vitest";

import { serialiseJsonLd } from "@/lib/json-ld";

/**
 * The regression this exists for shipped, on the most-visited and least
 * authenticated page in the product.
 */
describe("serialiseJsonLd", () => {
  it("neutralises a script-closing business name", () => {
    /**
     * The live payload on `/[slug]` is built from `business.name`,
     * `description`, `address` and every service name. All are free text in a
     * settings form, and the name field allows 80 characters — comfortably more
     * than this needs.
     */
    const attack = "</script><script>alert(1)</script>";
    const out = serialiseJsonLd({ name: attack });

    expect(out).not.toContain("</script>");
    expect(out).not.toContain("<");
    expect(out).toContain(String.raw`\u003c`);
  });

  it("escapes a break-out nested anywhere, not just at the top level", () => {
    // The escaping runs on the finished string rather than per value, which is
    // what makes a key, an array element and a deep field all covered without
    // any of them being remembered individually.
    const out = serialiseJsonLd({
      makesOffer: [{ itemOffered: { name: "<img src=x onerror=alert(1)>" } }],
      "<key>": "value",
    });

    expect(out).not.toContain("<");
    expect(out).not.toContain(">");
  });

  it("keeps the document a JSON parser reads identically", () => {
    /**
     * The escaping has to be lossless or it would corrupt the structured data
     * Google indexes. `\u003c` *is* `<` to a JSON parser, so round-tripping
     * returns the original values including the hostile one.
     */
    const data = {
      name: "מספרת בלאק <& דוד>",
      description: "5 > 3 & 2 < 4",
      nested: { list: ["a<b", "c&d"] },
    };

    expect(JSON.parse(serialiseJsonLd(data))).toEqual(data);
  });

  it("leaves ordinary Hebrew content untouched", () => {
    const out = serialiseJsonLd({ name: "מספרת בלאק", city: "תל אביב" });
    expect(JSON.parse(out)).toEqual({ name: "מספרת בלאק", city: "תל אביב" });
  });
});
