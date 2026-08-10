/**
 * Three claims, immediately under the hero.
 *
 * ---------------------------------------------------------------------------
 * Each one answers an objection rather than describing a feature, which is the
 * difference between copy that converts and copy that lists:
 *
 * - "no downloads for clients" answers *will my customers actually use this* —
 *   the single biggest reason a shop owner says no to booking software;
 * - "a full calendar" answers *what is this for*, in the language of the
 *   outcome rather than the mechanism;
 * - "ready in two minutes" answers *how much of my day will this cost me*.
 *
 * Numbers first and large, because a scanning eye lands on a digit before a
 * word. On the mesh rather than on paper: this is the one strip that has to
 * stop a thumb, and it sits exactly where the hero's colour ends.
 * ---------------------------------------------------------------------------
 */

const CLAIMS = [
  {
    value: "0",
    label: "הורדות ללקוח",
    detail: "קובעים תור מהקישור, בלי אפליקציה ובלי הרשמה",
  },
  {
    value: "100%",
    label: "מהיומן במקום אחד",
    detail: "תורים, חסימות וצוות — בלוח שבועי אחד",
  },
  {
    value: "2 דק׳",
    label: "וזה באוויר",
    detail: "שירותים, שעות, קישור לשיתוף. בלי הקמה",
  },
] as const;

export function ProofStrip() {
  return (
    // `brand-mesh`, not `accent-mesh`: this is our page in our colours. The
    // accent mesh belongs to a tenant and reads from their `data-accent`.
    <section className="brand-mesh relative overflow-hidden">
      <div
        aria-hidden
        className="dot-matrix pointer-events-none absolute inset-0 [mask-image:linear-gradient(to_bottom,#000_0%,transparent_80%)]"
      />

      <div className="relative mx-auto grid w-full max-w-[1400px] gap-6 px-5 py-10 sm:grid-cols-3 sm:px-8 sm:py-12">
        {CLAIMS.map((claim) => (
          <div key={claim.label} className="text-center sm:text-start">
            <p className="text-4xl font-black tracking-tighter text-white tabular-nums sm:text-5xl">
              {claim.value}
            </p>
            <p className="mt-1 text-sm font-bold text-white">{claim.label}</p>
            <p className="mt-1 text-xs leading-relaxed text-white/70">
              {claim.detail}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
