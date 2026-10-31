import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { analyzeLinuxImage, clearVisionOcrCache, parseTesseractTsv } from "../index.js";
const tsv = "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n1\t1\t0\t0\t0\t0\t0\t0\t200\t100\t-1\t\n5\t1\t1\t1\t1\t1\t10\t20\t80\t30\t96\tSend\n";
function tsvFor(text: string): string {
  return `level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n1\t1\t0\t0\t0\t0\t0\t0\t200\t100\t-1\t\n5\t1\t1\t1\t1\t1\t10\t20\t80\t30\t96\t${text}\n`;
}
describe("local vision", () => {
  it("parses TSV boxes, centers, and groups", () => { const parsed = parseTesseractTsv(tsv); expect(parsed.width).toBe(200); expect(parsed.items[0]).toMatchObject({ text: "Send", center: { x: 50, y: 35 } }); expect(parsed.groups).toHaveLength(1); });
  it("returns clean unavailable result when tesseract is absent", async () => { await expect(analyzeLinuxImage({ imagePath: "/x.png", source: "agenthost_screenshot", basename: "x.png", mode: "ocr", maxItems: 2 }, { env: { PATH: "" } })).resolves.toMatchObject({ supported: false, reason: "ocr_backend_unavailable" }); });
  it("reuses OCR only for the same file revision and query shape", async () => {
    clearVisionOcrCache();
    const dir = await mkdtemp(join(tmpdir(), "agenthost-vision-"));
    const imagePath = join(dir, "capture.png");
    let calls = 0;
    const run = async () => ({ exitCode: 0, stdout: tsvFor(`Text${++calls}`), timedOut: false, truncated: false });
    const input = { imagePath, source: "agenthost_screenshot" as const, basename: "capture.png", mode: "ocr" as const, maxItems: 2 };
    await writeFile(imagePath, "first revision");
    expect((await analyzeLinuxImage(input, { tesseractPath: "/usr/bin/tesseract", run })).textItems[0]?.text).toBe("Text1");
    expect((await analyzeLinuxImage(input, { tesseractPath: "/usr/bin/tesseract", run })).textItems[0]?.text).toBe("Text1");
    expect(calls).toBe(1);
    await writeFile(imagePath, "second revision with a different size");
    expect((await analyzeLinuxImage(input, { tesseractPath: "/usr/bin/tesseract", run })).textItems[0]?.text).toBe("Text2");
    expect(calls).toBe(2);
    expect((await analyzeLinuxImage({ ...input, maxItems: 3 }, { tesseractPath: "/usr/bin/tesseract", run })).textItems[0]?.text).toBe("Text3");
    expect(calls).toBe(3);
  });
});
