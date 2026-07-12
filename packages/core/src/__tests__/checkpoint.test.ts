import { describe, expect, it } from "vitest";
import { checkpointStrategy } from "../index.js";
describe("checkpoint helpers", () => { it("maps generic checkpoint evidence strategy", () => { expect(checkpointStrategy("browser_element_exists")).toBe("browser"); expect(checkpointStrategy("file_exists")).toBe("file"); expect(checkpointStrategy("manual_check")).toBe("manual"); }); });
