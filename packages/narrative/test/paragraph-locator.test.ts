import { describe, expect, it } from "vitest";

import {
  evidenceMatchesSource,
  ParagraphLocator,
  ParagraphLocatorError,
} from "../src/paragraph-locator.js";

describe("ParagraphLocator", () => {
  it("keeps exact source offsets while labels exist only in the prompt copy", () => {
    const content = "  第一段。  \r\n\r\n第二段。\n\n第三段。";
    const locator = new ParagraphLocator(content, {
      documentVersionId: "version-1",
    });

    expect(locator.render()).toBe(
      "[P1] 第一段。\n\n[P2] 第二段。\n\n[P3] 第三段。",
    );
    expect(locator.locate([1, 3])).toMatchObject([
      {
        quote: "第一段。",
        start: content.indexOf("第一段。"),
        end: content.indexOf("第一段。") + "第一段。".length,
        paragraphOrdinal: 1,
        documentVersionId: "version-1",
      },
      {
        quote: "第三段。",
        start: content.indexOf("第三段。"),
        paragraphOrdinal: 3,
        documentVersionId: "version-1",
      },
    ]);
    expect(locator.content).toBe(content);
  });

  it("rejects duplicate, missing, and chunk-external ordinals", () => {
    const locator = new ParagraphLocator("甲。\n\n乙。\n\n丙。");
    expect(
      locator.validate([1, 1, 4], "evidence", new Set([1, 2])),
    ).toHaveLength(2);
    expect(locator.validate([3], "evidence", new Set([1, 2]))).toHaveLength(1);
    expect(() => locator.locate([4])).toThrow(ParagraphLocatorError);
  });

  it("does not reuse evidence across content or document versions", () => {
    const original = new ParagraphLocator("相同正文。", {
      documentVersionId: "v1",
    });
    const evidence = original.locate([1])[0]!;
    expect(
      evidenceMatchesSource(
        evidence,
        new ParagraphLocator("相同正文。", { documentVersionId: "v2" }),
      ),
    ).toBe(false);
    expect(
      evidenceMatchesSource(
        evidence,
        new ParagraphLocator("不同正文。", { documentVersionId: "v1" }),
      ),
    ).toBe(false);
  });
});
