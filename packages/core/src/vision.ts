import { redactSensitiveText } from "./safety/redaction.js";
import type { VisionBounds, VisionPoint, VisionTargetCandidate, VisionTextItem } from "./types.js";

const email = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const phone = /\+?[0-9][0-9 ()-]{7,}[0-9]/g;
const url = /\bhttps?:\/\/[^\s]+/gi;
const dangerous = /\b(send|submit|post|pay|buy|delete|archive|upload|confirm|login|mfa|password)\b/i;
export function visionCenter(bounds: VisionBounds): VisionPoint { return { x: bounds.x + Math.floor(bounds.width / 2), y: bounds.y + Math.floor(bounds.height / 2) }; }
export function redactVisionText(input: string): { text: string; counts: Record<string, number>; redacted: boolean } {
  const counts: Record<string, number> = {}; let text = redactSensitiveText(input);
  text = text.replace(url, () => { counts.url = (counts.url ?? 0) + 1; return "[redacted-url]"; });
  text = text.replace(email, () => { counts.email = (counts.email ?? 0) + 1; return "[redacted-email]"; });
  text = text.replace(phone, () => { counts.phone = (counts.phone ?? 0) + 1; return "[redacted-phone]"; });
  text = text.replace(/\s+/g, " ").trim(); return { text, counts, redacted: Object.keys(counts).length > 0 || text !== input };
}
function words(value: string): string[] { return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).filter(Boolean); }
export function rankVisionTargets(items: VisionTextItem[], query: string, limit: number): VisionTargetCandidate[] {
  const queryWords = words(query).filter((word) => !["button", "input", "field", "box"].includes(word));
  return items.map((item) => {
    const labelWords = words(item.text); const label = item.text.toLowerCase(); const phrase = queryWords.join(" ");
    const overlap = queryWords.filter((word) => labelWords.includes(word)).length; const exact = phrase.length > 0 && label === phrase;
    const confidence = exact ? 1 : phrase.length > 0 && label.includes(phrase) ? .92 : queryWords.length > 0 ? Math.min(.8, overlap / queryWords.length * .8) : 0;
    const kind: VisionTargetCandidate["kind"] = /button/.test(query) ? "button_candidate" : /input|field|box/.test(query) ? "input_candidate" : "text";
    return { candidateId: `candidate_${item.id}`, label: item.text, kind, bounds: item.bounds, center: item.center, coordinateSpace: "image" as const, confidence, reason: exact ? "Exact visible OCR match." : "Visible OCR token match; no action performed.", matchedTextIds: [item.id], riskHint: dangerous.test(item.text) ? "high" as const : kind === "text" ? "normal" as const : "medium" as const };
  }).filter((candidate) => candidate.confidence >= .4).sort((a, b) => b.confidence - a.confidence).slice(0, limit);
}
