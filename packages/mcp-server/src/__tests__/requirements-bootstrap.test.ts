import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LINUX_DESKTOP_REQUIREMENTS, aptPackagesFor } from "@agenthost/core";
import type { RequirementStatus } from "@agenthost/os-linux";
import { bootstrapRequirements, type RequirementsBootstrapDeps } from "../requirements-bootstrap.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function statuses(missing: string[]): RequirementStatus[] {
  return LINUX_DESKTOP_REQUIREMENTS.map((requirement) => ({ name: requirement.name, aptPackage: requirement.aptPackage, required: requirement.required, impact: requirement.impact, installed: !missing.includes(requirement.name) }));
}

function fakeDeps(missing: { current: string[] }, plan = true): RequirementsBootstrapDeps & { launch: ReturnType<typeof vi.fn>; notify: ReturnType<typeof vi.fn> } {
  return {
    check: async () => statuses(missing.current),
    plan: async (packages) => (plan ? { command: ["/usr/bin/pkexec", "/usr/bin/apt-get", "install", "-y", ...packages], elevation: "pkexec" as const } : undefined),
    launch: vi.fn(),
    notify: vi.fn()
  };
}

describe("requirements bootstrap", () => {
  it("offers one password-prompted install per missing set", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "agenthost-reqs-"));
    roots.push(home);
    const missing = { current: ["tesseract", "xclip"] };
    const deps = fakeDeps(missing);
    expect(await bootstrapRequirements(home, true, deps)).toEqual({ missing: ["tesseract-ocr", "xclip"], action: "install_prompted" });
    expect(deps.launch).toHaveBeenCalledWith({ command: ["/usr/bin/pkexec", "/usr/bin/apt-get", "install", "-y", "tesseract-ocr", "xclip"], elevation: "pkexec" });
    expect((await bootstrapRequirements(home, true, deps)).action).toBe("already_offered");
    expect(deps.launch).toHaveBeenCalledTimes(1);
    missing.current = ["tesseract"];
    expect((await bootstrapRequirements(home, true, deps)).action).toBe("install_prompted");
    expect(JSON.parse(await readFile(path.join(home, "run", "requirements.json"), "utf8")).offered).toBe("tesseract-ocr");
  });

  it("does nothing when complete or disabled, and only advises without an elevation helper", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "agenthost-reqs-"));
    roots.push(home);
    expect((await bootstrapRequirements(home, true, fakeDeps({ current: [] }))).action).toBe("none");
    const disabled = fakeDeps({ current: ["xclip"] });
    expect((await bootstrapRequirements(home, false, disabled)).action).toBe("disabled");
    expect(disabled.launch).not.toHaveBeenCalled();
    const advice = fakeDeps({ current: ["xclip"] }, false);
    expect((await bootstrapRequirements(home, true, advice)).action).toBe("advice_only");
    expect(advice.notify).toHaveBeenCalledWith("AgentHost needs desktop packages", "Install with: sudo apt install xclip");
  });

  it("keeps requirements-linux.txt in sync with the requirement list", async () => {
    const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../requirements-linux.txt");
    const listed = (await readFile(file, "utf8")).split("\n").map((line) => line.trim()).filter((line) => line.length > 0 && !line.startsWith("#"));
    expect(listed).toEqual(aptPackagesFor(LINUX_DESKTOP_REQUIREMENTS));
  });
});
