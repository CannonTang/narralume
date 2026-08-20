import { z } from "zod";

export const HarnessTemplateSchema = z.object({
  id: z.string(),
  kind: z.enum(["prompt", "recipe"]),
  key: z.string(),
  name: z.string(),
  description: z.string(),
  systemInvariants: z.string(),
  defaultContent: z.string(),
  overrideContent: z.string().nullable(),
  effectiveContent: z.string(),
  clonedFromKey: z.string().nullable(),
  version: z.number().int().nonnegative(),
  updatedAt: z.string(),
});
export type HarnessTemplateDto = z.infer<typeof HarnessTemplateSchema>;

export const UpdateHarnessTemplateRequestSchema = z.object({
  content: z.string().min(1).max(200_000),
  expectedVersion: z.number().int().nonnegative(),
});
export const RestoreHarnessTemplateRequestSchema = z.object({
  expectedVersion: z.number().int().nonnegative(),
});
export const CloneHarnessTemplateRequestSchema = z.object({
  key: z
    .string()
    .trim()
    .regex(/^[a-z0-9][a-z0-9._-]{2,99}$/u),
  name: z.string().trim().min(1).max(200),
});
