import type { IsoDateTime } from "./index.js";

export type ImportFormat =
  "markdown" | "text" | "docx" | "html" | "epub" | "narrative-bundle";
export type ImportCandidateKind =
  | "project"
  | "document"
  | "outline"
  | "intent"
  | "entity"
  | "style"
  | "skill"
  | "relationship"
  | "timeline"
  | "foreshadow"
  | "character-arc"
  | "scene-analysis";

export interface StyleProfile {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  rules: readonly string[];
  examples: readonly string[];
  negativeRules: readonly string[];
  source: string;
  active: boolean;
  status: "active" | "retired";
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  version: number;
}

export type WritingSkillScope =
  "all" | "chapter" | "cocreate" | "edit" | "review";

export interface WritingSkill {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  instructions: string;
  scopes: readonly WritingSkillScope[];
  priority: number;
  enabled: boolean;
  source: string;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  version: number;
}

export interface ImportBatch {
  id: string;
  targetProjectId: string | null;
  filename: string;
  format: ImportFormat;
  sourceHash: string;
  sourceCharacters: number;
  status: "previewed" | "analyzing" | "ready" | "applied" | "discarded";
  metadata: Readonly<Record<string, unknown>>;
  analysisRunId: string | null;
  appliedProjectId: string | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface ImportCandidate {
  id: string;
  batchId: string;
  kind: ImportCandidateKind;
  ordinal: number;
  title: string;
  payload: Readonly<Record<string, unknown>>;
  status: "pending" | "selected" | "discarded" | "applied";
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface ImportBatchDetail {
  batch: ImportBatch;
  candidates: readonly ImportCandidate[];
}

export interface ProjectBackup {
  id: string;
  projectId: string;
  label: string;
  bundleHash: string;
  sizeBytes: number;
  createdAt: IsoDateTime;
  restoredProjectId: string | null;
  /** 备份内容的分类计数（导出/恢复校验清单）；旧备份可能缺失。 */
  counts?: Record<string, number> | null;
}

export interface QualityIssue {
  id: string;
  category: "structure" | "manuscript" | "canon" | "continuity" | "workflow";
  severity: "info" | "warning" | "error";
  message: string;
  targetType: string | null;
  targetId: string | null;
  suggestion: string;
}

export interface DeliveryGate {
  id: string;
  label: string;
  passed: boolean;
  message: string;
  targetType: string | null;
  targetId: string | null;
}

export interface ProjectQualityReport {
  projectId: string;
  score: number;
  readiness: "blocked" | "needs_attention" | "ready";
  gates: readonly DeliveryGate[];
  generatedAt: IsoDateTime;
  metrics: Readonly<Record<string, number>>;
  issues: readonly QualityIssue[];
}
