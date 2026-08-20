export const CONTEXT_KINDS = [
  "system",
  "author-intent",
  "task",
  "canon",
  "outline",
  "recent-text",
  "summary",
  "retrieval",
  "style",
  "session",
] as const;
export type ContextKind = (typeof CONTEXT_KINDS)[number];
export type ContextAuthority =
  "system" | "locked" | "confirmed" | "candidate" | "reference" | "ephemeral";

export interface ContextSource {
  id: string;
  kind: ContextKind;
  label: string;
  content: string;
  summary?: string;
  authority: ContextAuthority;
  priority: number;
  required?: boolean;
  compressible?: boolean;
  sourceType: string;
  sourceId?: string;
  metadata?: Readonly<Record<string, unknown>>;
}

export interface ContextBudget {
  contextWindow: number;
  outputReserve: number;
  fixedInstructionReserve: number;
  toolReserve: number;
  schemaReserve: number;
  safetyReserve?: number;
}

export interface ContextCompileRequest {
  projectId: string;
  purpose: string;
  budget: ContextBudget;
  sources: readonly ContextSource[];
}

export interface CompiledContextSection {
  id: string;
  kind: ContextKind;
  label: string;
  content: string;
  authority: ContextAuthority;
  tokenEstimate: number;
  compressed: boolean;
  sourceType: string;
  sourceId?: string;
}

export interface ContextReceiptEntry {
  sourceId: string;
  kind: ContextKind;
  label: string;
  authority: ContextAuthority;
  status: "included" | "compressed" | "excluded";
  originalTokens: number;
  finalTokens: number;
  reason: string;
  sourceType: string;
  provenanceId?: string;
}

/**
 * A capability the compile path had to degrade, e.g. embedding unavailable so
 * retrieval fell back to FTS/entity ranking. Recorded on the receipt so the
 * degradation is visible alongside the compiled context.
 */
export interface ContextDegradation {
  capability: string;
  reason: string;
}

export interface ContextReceipt {
  id: string;
  projectId: string;
  purpose: string;
  budget: ContextBudget & {
    available: number;
    used: number;
    remaining: number;
  };
  entries: readonly ContextReceiptEntry[];
  degradations?: readonly ContextDegradation[];
  inventoryDigest?: string;
  materializationDigest?: string;
  compiledHash: string;
  createdAt: string;
}

export interface CompiledContext {
  sections: readonly CompiledContextSection[];
  text: string;
  receipt: ContextReceipt;
}
