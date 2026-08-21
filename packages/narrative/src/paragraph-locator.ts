import { sha256Hex } from "@narralume/domain";

export interface SourceParagraph {
  /** One-based ordinal used only in model-facing prompts. */
  ordinal: number;
  /** Exact source slice. */
  quote: string;
  /** UTF-16 offsets into the unmodified source string. */
  start: number;
  end: number;
}

export interface GroundedParagraphEvidence {
  quote: string;
  start: number;
  end: number;
  paragraphOrdinal: number;
  documentVersionId: string | null;
  contentHash: string;
}

export interface ParagraphLocatorOptions {
  documentVersionId?: string | null;
}

/**
 * The single evidence-location protocol used by every narrative workflow.
 * Labels only exist in the rendered prompt copy; source text and offsets are
 * never rewritten.
 */
export class ParagraphLocator {
  readonly contentHash: string;
  readonly documentVersionId: string | null;
  readonly paragraphs: readonly SourceParagraph[];
  readonly #byOrdinal: ReadonlyMap<number, SourceParagraph>;

  constructor(
    readonly content: string,
    options: ParagraphLocatorOptions = {},
  ) {
    this.contentHash = sha256(content);
    this.documentVersionId = options.documentVersionId ?? null;
    this.paragraphs = splitSourceParagraphs(content);
    this.#byOrdinal = new Map(
      this.paragraphs.map((paragraph) => [paragraph.ordinal, paragraph]),
    );
  }

  /** Render a labelled prompt copy without modifying the source. */
  render(ordinals?: readonly number[]): string {
    const selected =
      ordinals === undefined
        ? this.paragraphs
        : ordinals.map((ordinal) => {
            const paragraph = this.#byOrdinal.get(ordinal);
            if (!paragraph) {
              throw new ParagraphLocatorError(
                "evidence.paragraph.out_of_range",
                `段号 P${ordinal} 不存在`,
              );
            }
            return paragraph;
          });
    return selected
      .map((paragraph) => `[P${paragraph.ordinal}] ${paragraph.quote}`)
      .join("\n\n");
  }

  validate(
    ordinals: readonly number[],
    path: string,
    allowedOrdinals?: ReadonlySet<number>,
  ): string[] {
    const issues: string[] = [];
    const seen = new Set<number>();
    for (const ordinal of ordinals) {
      if (!Number.isInteger(ordinal) || ordinal < 1) {
        issues.push(`${path}: 段号必须是从 1 开始的整数`);
        continue;
      }
      if (seen.has(ordinal)) {
        issues.push(`${path}: 段号 P${ordinal} 重复`);
        continue;
      }
      seen.add(ordinal);
      if (!this.#byOrdinal.has(ordinal)) {
        issues.push(`${path}: 段号 P${ordinal} 不存在`);
      } else if (allowedOrdinals && !allowedOrdinals.has(ordinal)) {
        issues.push(`${path}: 段号 P${ordinal} 不属于本次提供的正文范围`);
      }
    }
    return issues;
  }

  locate(ordinals: readonly number[]): GroundedParagraphEvidence[] {
    const issues = this.validate(ordinals, "evidenceParagraphs");
    if (issues.length > 0) {
      throw new ParagraphLocatorError(
        "evidence.paragraph.invalid",
        issues.join("；"),
      );
    }
    return ordinals.map((ordinal) => {
      const paragraph = this.#byOrdinal.get(ordinal)!;
      return {
        quote: paragraph.quote,
        start: paragraph.start,
        end: paragraph.end,
        paragraphOrdinal: paragraph.ordinal,
        documentVersionId: this.documentVersionId,
        contentHash: this.contentHash,
      };
    });
  }
}

export class ParagraphLocatorError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ParagraphLocatorError";
  }
}

/**
 * Rejects evidence copied from another immutable source version even when an
 * identical quote happens to occur in the current text.
 */
export function evidenceMatchesSource(
  evidence: Pick<
    GroundedParagraphEvidence,
    "contentHash" | "documentVersionId"
  >,
  locator: ParagraphLocator,
): boolean {
  return (
    evidence.contentHash === locator.contentHash &&
    evidence.documentVersionId === locator.documentVersionId
  );
}

export function bindEvidenceDocumentVersion(
  evidence: readonly GroundedParagraphEvidence[],
  documentVersionId: string,
): GroundedParagraphEvidence[] {
  return evidence.map((item) => ({ ...item, documentVersionId }));
}

function splitSourceParagraphs(content: string): SourceParagraph[] {
  const ranges: Array<{ start: number; end: number }> = [];
  const separator = /\r?\n[\t ]*\r?\n+/gu;
  let start = 0;
  for (const match of content.matchAll(separator)) {
    const index = match.index;
    pushTrimmedRange(content, start, index, ranges);
    start = index + match[0].length;
  }
  pushTrimmedRange(content, start, content.length, ranges);
  return ranges.map((range, index) => ({
    ordinal: index + 1,
    quote: content.slice(range.start, range.end),
    start: range.start,
    end: range.end,
  }));
}

function pushTrimmedRange(
  content: string,
  rawStart: number,
  rawEnd: number,
  ranges: Array<{ start: number; end: number }>,
): void {
  const raw = content.slice(rawStart, rawEnd);
  const leading = raw.search(/\S/u);
  if (leading < 0) return;
  const trailingWhitespace = /\s*$/u.exec(raw)?.[0].length ?? 0;
  const start = rawStart + leading;
  const end = rawEnd - trailingWhitespace;
  if (end > start) ranges.push({ start, end });
}

function sha256(value: string): string {
  return sha256Hex(value);
}
