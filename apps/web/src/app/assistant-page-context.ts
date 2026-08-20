import type { AssistantContext } from "../lib/api";

const ASSISTANT_CONTEXT_EVENT = "narrative:assistant-context";

export type AssistantContextPatch = Partial<
  Pick<
    AssistantContext,
    "documentId" | "outlineNodeId" | "canonSpread" | "selection"
  >
>;

export function publishAssistantContext(patch: AssistantContextPatch): void {
  window.dispatchEvent(
    new CustomEvent<AssistantContextPatch>(ASSISTANT_CONTEXT_EVENT, {
      detail: patch,
    }),
  );
}

export function subscribeAssistantContext(
  listener: (patch: AssistantContextPatch) => void,
): () => void {
  const receive = (event: Event) => {
    listener((event as CustomEvent<AssistantContextPatch>).detail);
  };
  window.addEventListener(ASSISTANT_CONTEXT_EVENT, receive);
  return () => window.removeEventListener(ASSISTANT_CONTEXT_EVENT, receive);
}
