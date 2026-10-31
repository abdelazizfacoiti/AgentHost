import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const runtimeDir = fileURLToPath(new URL("../../runtime/", import.meta.url));
const script = `
import json, sys
sys.path.insert(0, sys.argv[1])
import overlay_geometry as geometry
area = (66, 32, 1854, 1048)
print(json.dumps({
    "ring_clamped": geometry.ring_placement([(0, 0, 1920, 1080, 1)], (-24, -24, 48, 48)),
    "ring_second_monitor": geometry.ring_placement([(0, 0, 1920, 1080, 1), (1920, 0, 1920, 1080, 1)], (1910, 100, 20, 20)),
    "card_avoids_point": geometry.card_position(area, 380, 120, "top_center", point={"x": 900, "y": 56}),
    "card_clamps_to_work_area": geometry.card_position(area, 380, 120, "top_right", user_position=(99999, -99999))
}))
`;

describe("overlay geometry", () => {
  it("clamps cards and rings to the work area and avoids targets", () => {
    const output = execFileSync("python3", ["-c", script, runtimeDir], { encoding: "utf8" });
    expect(JSON.parse(output)).toEqual({
      ring_clamped: [0, 0, 104, 104],
      ring_second_monitor: [1920, 72, 76, 76],
      card_avoids_point: [90, 56],
      card_clamps_to_work_area: [1516, 56]
    });
  });
});
