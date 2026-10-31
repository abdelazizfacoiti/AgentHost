import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CLAUDE_ATTENTION_HOOKS, claudeHooksAdd, claudeHooksRemove, claudeHooksStatus, claudeSettingsPath } from "../hooks.js";

const roots: string[] = [];

async function tempHome(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "agenthost-hooks-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Claude Code attention hooks", () => {
  it("previews without writing, then applies idempotently", async () => {
    const home = await tempHome();
    const preview = await claudeHooksAdd(home, false);
    expect(preview).toMatchObject({ changed: true, applied: false });
    expect(existsSync(claudeSettingsPath(home))).toBe(false);

    expect(await claudeHooksAdd(home, true)).toMatchObject({ applied: true, configured: true });
    expect((await claudeHooksStatus(home)).configured).toBe(true);
    expect(await claudeHooksAdd(home, true)).toMatchObject({ changed: false, applied: false });
    const settings = JSON.parse(await readFile(claudeSettingsPath(home), "utf8")) as { hooks: Record<string, unknown[]> };
    expect(settings.hooks.PostToolUse).toHaveLength(1);
  });

  it("keeps the user's own hooks and settings on add and remove", async () => {
    const home = await tempHome();
    const userHook = { matcher: "Bash", hooks: [{ type: "command", command: "echo mine" }] };
    await mkdir(path.dirname(claudeSettingsPath(home)), { recursive: true });
    await writeFile(claudeSettingsPath(home), JSON.stringify({ model: "opus", hooks: { PostToolUse: [userHook] } }));

    await claudeHooksAdd(home, true);
    const added = JSON.parse(await readFile(claudeSettingsPath(home), "utf8")) as { model: string; hooks: Record<string, unknown[]> };
    expect(added.model).toBe("opus");
    expect(added.hooks.PostToolUse).toEqual([userHook, ...CLAUDE_ATTENTION_HOOKS.PostToolUse!]);
    expect(existsSync(`${claudeSettingsPath(home)}.agenthost.bak`)).toBe(true);

    expect(await claudeHooksRemove(home, true)).toMatchObject({ applied: true, configured: false });
    const removed = JSON.parse(await readFile(claudeSettingsPath(home), "utf8")) as { model: string; hooks: Record<string, unknown[]> };
    expect(removed).toEqual({ model: "opus", hooks: { PostToolUse: [userHook] } });
  });

  it("refuses to rewrite settings that are not valid JSON", async () => {
    const home = await tempHome();
    await mkdir(path.dirname(claudeSettingsPath(home)), { recursive: true });
    await writeFile(claudeSettingsPath(home), "{ not json");
    expect((await claudeHooksAdd(home, true)).error).toBe("settings_invalid_json");
    expect(await readFile(claudeSettingsPath(home), "utf8")).toBe("{ not json");
  });
});
