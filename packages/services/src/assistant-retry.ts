const RETRYABLE_ACTIVITY_ERROR_CODES = new Set([
  "model.assignment.unavailable",
  "project.writing_task.active",
  "autopilot.session.active",
]);

export function isRetryableAssistantActivityError(
  error: Readonly<Record<string, unknown>> | null,
): boolean {
  return (
    typeof error?.code === "string" &&
    RETRYABLE_ACTIVITY_ERROR_CODES.has(error.code)
  );
}
