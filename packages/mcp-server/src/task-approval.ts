import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export type TaskApprovalRiskCap = "low" | "medium";

export interface TaskApproval {
  approvalId: string;
  taskId: string;
  maxRisk: TaskApprovalRiskCap;
  origin: "cli" | "control-room";
  createdAt: string;
  expiresAt: string;
}

const APPROVAL_TTL_MS = 30 * 60_000;

function file(agentHostDir: string): string {
  return path.join(agentHostDir, "tasks", "approvals", "active.json");
}

/**
 * Operator-only task pre-approval. Created exclusively through operator paths
 * (CLI `agenthost task approve`, Control Room). There is deliberately NO MCP
 * tool for this: a model self-approving its own task would be meaningless.
 * At most one approval is active at a time; handlers still run their exact
 * dry-run + confirmation binding, chained server-side by the central runner.
 */
export async function approveTaskScope(
  agentHostDir: string,
  taskId: string,
  maxRisk: TaskApprovalRiskCap = "medium",
  origin: TaskApproval["origin"] = "cli"
): Promise<TaskApproval> {
  const safeTaskId = taskId.replace(/[^A-Za-z0-9_.:-]/g, "").slice(0, 200);
  if (safeTaskId.length === 0) throw new Error("task_approval_invalid_id");
  const now = Date.now();
  const approval: TaskApproval = {
    approvalId: `task_approval_${randomUUID()}`,
    taskId: safeTaskId,
    maxRisk,
    origin,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + APPROVAL_TTL_MS).toISOString()
  };
  await mkdir(path.dirname(file(agentHostDir)), { recursive: true, mode: 0o700 });
  const temp = `${file(agentHostDir)}.${randomUUID()}.tmp`;
  await writeFile(temp, `${JSON.stringify(approval, null, 2)}\n`, { mode: 0o600 });
  await chmod(temp, 0o600);
  await rename(temp, file(agentHostDir));
  return approval;
}

export async function clearTaskApproval(agentHostDir: string): Promise<void> {
  await rm(file(agentHostDir), { force: true });
}

export async function activeTaskApproval(agentHostDir: string): Promise<TaskApproval | undefined> {
  try {
    const approval = JSON.parse(await readFile(file(agentHostDir), "utf8")) as TaskApproval;
    if (approval.approvalId === undefined || approval.taskId === undefined) return undefined;
    if ((approval.maxRisk !== "low" && approval.maxRisk !== "medium") || Date.parse(approval.expiresAt) <= Date.now()) {
      await clearTaskApproval(agentHostDir).catch(() => undefined);
      return undefined;
    }
    return approval;
  } catch {
    return undefined;
  }
}

const RISK_RANK: Record<string, number> = { observe: 0, low: 1, medium: 2, high: 3, blocked: 4 };

export function approvalCoversRisk(approval: TaskApproval, riskLevel: string): boolean {
  return (RISK_RANK[riskLevel] ?? 4) <= (RISK_RANK[approval.maxRisk] ?? 0);
}
