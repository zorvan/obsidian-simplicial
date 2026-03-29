type LogLevel = "debug" | "info" | "warn" | "error";

function formatDetails(details?: Record<string, unknown>): string {
  if (!details) return "";
  try {
    return ` ${JSON.stringify(details)}`;
  } catch {
    return " [unserializable-details]";
  }
}

function write(level: LogLevel, scope: string, message: string, details?: Record<string, unknown>): void {
  const prefix = `[Simplicial:${scope}] ${message}${formatDetails(details)}`;
  if (level === "error") {
    console.error(prefix);
    return;
  }
  if (level === "warn") {
    console.warn(prefix);
    return;
  }
  if (level === "debug") {
    console.debug(prefix);
    return;
  }
  console.log(prefix);
}

export const logger = {
  debug(scope: string, message: string, details?: Record<string, unknown>): void {
    write("debug", scope, message, details);
  },
  info(scope: string, message: string, details?: Record<string, unknown>): void {
    write("info", scope, message, details);
  },
  warn(scope: string, message: string, details?: Record<string, unknown>): void {
    write("warn", scope, message, details);
  },
  error(scope: string, message: string, details?: Record<string, unknown>): void {
    write("error", scope, message, details);
  }
};
