export type ErrorSeverity = "error" | "warning";

export type ErrorContext = Record<string, string | number | boolean | null>;

export type ReportedError = {
  severity: ErrorSeverity;
  /** Dot-scoped origin, e.g. "booking.create". Greppable in production logs. */
  scope: string;
  message: string;
  stack?: string;
  context?: ErrorContext;
  timestamp: string;
};

function describe(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) {
    return { message: error.message, stack: error.stack };
  }
  return { message: String(error) };
}

/**
 * Redacts the values most likely to end up in an error context by accident.
 * Client names and phone numbers belong in the database, not in a log line
 * that may be shipped to a third-party service.
 */
const SENSITIVE_KEY = /phone|email|token|secret|password|key|name/i;

function redact(context: ErrorContext): ErrorContext {
  return Object.fromEntries(
    Object.entries(context).map(([key, value]) =>
      SENSITIVE_KEY.test(key) && typeof value === "string"
        ? [key, "[redacted]"]
        : [key, value],
    ),
  );
}

/**
 * The single place server-side failures are reported.
 *
 * Emits one structured JSON line, which is what makes a production log
 * searchable by `scope` instead of by prose. Sentry is not installed — when it
 * is, this is the only function that needs to call it, and every existing call
 * site inherits it. See docs/DEPLOYMENT.md.
 */
export function reportError(
  scope: string,
  error: unknown,
  context?: ErrorContext,
  severity: ErrorSeverity = "error",
): ReportedError {
  const { message, stack } = describe(error);

  const report: ReportedError = {
    severity,
    scope,
    message,
    ...(stack ? { stack } : {}),
    ...(context ? { context: redact(context) } : {}),
    timestamp: new Date().toISOString(),
  };

  // JSON on one line: Vercel's log drain and most aggregators parse this
  // directly, where a multi-line console.error becomes several records.
  const line = JSON.stringify(report);
  if (severity === "error") console.error(line);
  else console.warn(line);

  return report;
}

/** Notable-but-expected events: a tripped honeypot, a rate limit, a skip. */
export function reportWarning(
  scope: string,
  message: string,
  context?: ErrorContext,
) {
  return reportError(scope, new Error(message), context, "warning");
}
