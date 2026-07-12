import { describe, expect, it } from "vitest";
import { analyzeLinuxImage, parseTesseractTsv } from "../index.js";
const tsv = "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n1\t1\t0\t0\t0\t0\t0\t0\t200\t100\t-1\t\n5\t1\t1\t1\t1\t1\t10\t20\t80\t30\t96\tSend\n";
describe("local vision", () => {
  it("parses TSV boxes, centers, and groups", () => { const parsed = parseTesseractTsv(tsv); expect(parsed.width).toBe(200); expect(parsed.items[0]).toMatchObject({ text: "Send", center: { x: 50, y: 35 } }); expect(parsed.groups).toHaveLength(1); });
  it("returns clean unavailable result when tesseract is absent", async () => { await expect(analyzeLinuxImage({ imagePath: "/x.png", source: "agenthost_screenshot", basename: "x.png", mode: "ocr", maxItems: 2 }, { env: { PATH: "" } })).resolves.toMatchObject({ supported: false, reason: "ocr_backend_unavailable" }); });
});
