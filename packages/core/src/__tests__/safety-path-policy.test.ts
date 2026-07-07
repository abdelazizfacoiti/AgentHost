import path from "node:path";
import { describe, expect, it } from "vitest";
import { classifyPath, getPolicyProfile, resolveAllowedWriteRoots } from "../index.js";

const homeDir = "/home/tester";
const cwd = "/workspace";

describe("path policy", () => {
  it("expands configured write roots from policy and config context", () => {
    const roots = resolveAllowedWriteRoots(getPolicyProfile("dev"), {
      homeDir,
      cwd,
      agentHostDir: "/tmp/agenthost"
    });

    expect(roots).toContain(path.join(homeDir, ".agenthost"));
    expect(roots).toContain(path.join(homeDir, "Desktop", "agenthost-output"));
    expect(roots).toContain("/tmp/agenthost");
  });

  it("allows writes inside configured write roots", () => {
    const result = classifyPath("~/Desktop/agenthost-output/result.txt", getPolicyProfile("dev"), {
      homeDir,
      cwd,
      access: "write"
    });

    expect(result.riskLevel).toBe("medium");
    expect(result.isAllowedWriteRoot).toBe(true);
    expect(result.matchedRules).toContain("path.write.allowed_root");
  });

  it("detects protected home and credential paths", () => {
    const homeResult = classifyPath("~/notes.txt", getPolicyProfile("dev"), { homeDir, cwd, access: "read" });
    const sshResult = classifyPath("~/.ssh/id_rsa", getPolicyProfile("dev"), { homeDir, cwd, access: "read" });

    expect(homeResult.isProtectedPath).toBe(true);
    expect(homeResult.protectionKind).toBe("home");
    expect(sshResult.riskLevel).toBe("blocked");
    expect(sshResult.protectionKind).toBe("credential");
  });

  it("blocks protected browser profile and system paths", () => {
    const browserResult = classifyPath("~/.config/google-chrome/Default/Cookies", getPolicyProfile("dev"), {
      homeDir,
      cwd,
      access: "read"
    });
    const systemResult = classifyPath("/etc/passwd", getPolicyProfile("dev"), { homeDir, cwd, access: "write" });

    expect(browserResult.riskLevel).toBe("blocked");
    expect(browserResult.protectionKind).toBe("browser_profile");
    expect(systemResult.riskLevel).toBe("blocked");
    expect(systemResult.protectionKind).toBe("system");
  });

  it("marks writes outside allowed roots as high-risk", () => {
    const result = classifyPath("/tmp/outside.txt", getPolicyProfile("strict"), { homeDir, cwd, access: "write" });

    expect(result.riskLevel).toBe("high");
    expect(result.isAllowedWriteRoot).toBe(false);
    expect(result.matchedRules).toContain("path.write.outside_allowed_roots");
  });
});
