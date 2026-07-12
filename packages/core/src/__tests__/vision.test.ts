import { describe, expect, it } from "vitest";
import { rankVisionTargets, redactVisionText, visionCenter, type VisionTextItem } from "../index.js";
describe("vision helpers", () => {
  it("redacts OCR private strings and computes centers", () => { const value = redactVisionText("a@b.test +15551234567 https://x.test/?token=abc"); expect(value.text).toContain("[redacted-email]"); expect(value.text).toContain("[redacted-phone]"); expect(value.text).toContain("[redacted-url]"); expect(visionCenter({ x: 10, y: 20, width: 20, height: 10 })).toEqual({ x: 20, y: 25 }); });
  it("marks dangerous visible labels high-risk", () => { const item: VisionTextItem = { id: "text_001", text: "Send", redactedText: "Send", bounds: { x: 1, y: 2, width: 3, height: 4 }, center: { x: 2, y: 4 }, confidence: 1, kind: "text", page: 1, block: 1, paragraph: 1, line: 1, redacted: false }; expect(rankVisionTargets([item], "Send button", 1)[0]).toMatchObject({ kind: "button_candidate", riskHint: "high" }); });
});
