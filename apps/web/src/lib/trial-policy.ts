export const DEMO_RELAY_PROVIDER_ID = "relay-demo";
export const TRIAL_RELAY_AUTOPILOT_CHAPTER_LIMIT = 3;

export function exceedsTrialRelayAutopilotLimit(
  providerId: string | null | undefined,
  targetChapters: unknown,
): boolean {
  return (
    providerId === DEMO_RELAY_PROVIDER_ID &&
    typeof targetChapters === "number" &&
    targetChapters > TRIAL_RELAY_AUTOPILOT_CHAPTER_LIMIT
  );
}
