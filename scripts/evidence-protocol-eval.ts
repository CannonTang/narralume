import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { structuredTierPlan } from "@narralume/llm";
import {
  evidenceMatchesSource,
  isRevisionNoop,
  ParagraphLocator,
} from "@narralume/narrative";

interface EvalDataset {
  version: string;
  cases: EvalCase[];
}

type EvalCase =
  | {
      id: string;
      kind: "paragraphs";
      content: string;
      evidenceParagraphs: number[];
      expectedQuotes: string[];
    }
  | {
      id: string;
      kind: "duplicate";
      content: string;
      evidenceParagraphs: number[];
      expectedQuote: string;
    }
  | {
      id: string;
      kind: "version-drift";
      original: string;
      changed: string;
      originalVersionId: string;
      changedVersionId: string;
    }
  | {
      id: string;
      kind: "revision-noop";
      base: string;
      revision: string;
    }
  | {
      id: string;
      kind: "structured-fallback";
      capabilities: Record<string, boolean>;
      expectedTiers: string[];
    };

interface CaseResult {
  id: string;
  kind: EvalCase["kind"];
  passed: boolean;
  details: Record<string, unknown>;
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const datasetPath = resolve(root, "evals", "evidence-protocol-v1.json");
const dataset = JSON.parse(readFileSync(datasetPath, "utf8")) as EvalDataset;
const results = dataset.cases.map(runCase);
const report = {
  dataset: dataset.version,
  generatedAt: new Date().toISOString(),
  passed: results.every((result) => result.passed),
  summary: {
    total: results.length,
    passed: results.filter((result) => result.passed).length,
    failed: results.filter((result) => !result.passed).length,
  },
  results,
};
const reportPath = resolve(root, ".tmp", "evals", `${dataset.version}.json`);
mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(
  JSON.stringify({ ...report.summary, reportPath, passed: report.passed }),
);
if (!report.passed) process.exitCode = 1;

function runCase(testCase: EvalCase): CaseResult {
  switch (testCase.kind) {
    case "paragraphs": {
      const locator = new ParagraphLocator(testCase.content);
      const evidence = locator.locate(testCase.evidenceParagraphs);
      const quotes = evidence.map((item) => item.quote);
      const labelsPresent = locator.render().includes("[P3]");
      return result(
        testCase,
        arraysEqual(quotes, testCase.expectedQuotes) && labelsPresent,
        {
          quotes,
          offsets: evidence.map(({ start, end }) => ({ start, end })),
          labelsPresent,
        },
      );
    }
    case "duplicate": {
      const locator = new ParagraphLocator(testCase.content);
      const [evidence] = locator.locate(testCase.evidenceParagraphs);
      const expectedStart = testCase.content.lastIndexOf(
        testCase.expectedQuote,
      );
      return result(
        testCase,
        evidence?.quote === testCase.expectedQuote &&
          evidence.paragraphOrdinal === 2 &&
          evidence.start === expectedStart,
        { evidence, expectedStart },
      );
    }
    case "version-drift": {
      const original = new ParagraphLocator(testCase.original, {
        documentVersionId: testCase.originalVersionId,
      });
      const changed = new ParagraphLocator(testCase.changed, {
        documentVersionId: testCase.changedVersionId,
      });
      const [evidence] = original.locate([1]);
      const matches = evidence
        ? evidenceMatchesSource(evidence, changed)
        : true;
      return result(testCase, !matches, {
        matches,
        originalHash: original.contentHash,
        changedHash: changed.contentHash,
      });
    }
    case "revision-noop": {
      const noop = isRevisionNoop(testCase.base, testCase.revision);
      return result(testCase, noop, { noop, expectedReason: "empty_output" });
    }
    case "structured-fallback": {
      const tiers = structuredTierPlan(testCase.capabilities);
      return result(testCase, arraysEqual(tiers, testCase.expectedTiers), {
        tiers,
      });
    }
  }
}

function result(
  testCase: EvalCase,
  passed: boolean,
  details: Record<string, unknown>,
): CaseResult {
  return { id: testCase.id, kind: testCase.kind, passed, details };
}

function arraysEqual(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}
