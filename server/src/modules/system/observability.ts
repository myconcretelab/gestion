export type LogContext = {
  organizationId?: string;
  userId?: string;
  requestId?: string;
  jobId?: string;
  [key: string]: unknown;
};

const write = (
  level: "info" | "warn" | "error",
  event: string,
  context: LogContext = {},
) => {
  const output = JSON.stringify({
    level,
    event,
    at: new Date().toISOString(),
    ...context,
  });
  (level === "error"
    ? console.error
    : level === "warn"
      ? console.warn
      : console.info)(output);
};

export const logger = {
  info: (event: string, context?: LogContext) => write("info", event, context),
  warn: (event: string, context?: LogContext) => write("warn", event, context),
  error: (event: string, context?: LogContext) =>
    write("error", event, context),
};
