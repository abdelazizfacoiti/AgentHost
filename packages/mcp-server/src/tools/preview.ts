import {
  toolSuccess,
  type AccessibilityElementDetails,
  type ActionPreviewAlternative,
  type ActionPreviewResult,
  type ActionPreviewTarget,
  type AutomationStrategy,
  type DataSensitivity,
  type DesktopWindowContext,
  type DesktopWindowSummary,
  type RiskLevel,
  type SafetyDecision,
  type ToolConfirmationInfo,
  type ToolResult
} from "@agenthost/core";
import type { ConfirmationManager } from "../confirmation.js";

interface PreviewResultInput {
  tool: string;
  riskLevel: RiskLevel;
  strategy?: AutomationStrategy | undefined;
  safety: SafetyDecision;
  targetSummary: string;
  target?: ActionPreviewTarget | undefined;
  dataSensitivity?: DataSensitivity | undefined;
  ambiguous?: boolean | undefined;
  supported?: boolean | undefined;
  backend?: string | undefined;
  reasons?: string[] | undefined;
  matchedRules?: string[] | undefined;
  saferAlternative?: ActionPreviewAlternative | undefined;
  wouldExecute?: boolean | undefined;
  observations?: string[] | undefined;
  confirmation?: {
    manager: ConfirmationManager;
    sessionId: string;
    input: unknown;
    target?: unknown;
    explanation: string;
    riskLevel: RiskLevel;
    appSensitivity?: ActionPreviewResult["appSensitivity"];
    dataSensitivity?: DataSensitivity | undefined;
  } | undefined;
}

export function buildPreviewResult(input: PreviewResultInput): ToolResult<ActionPreviewResult> {
  const ambiguous = input.ambiguous ?? false;
  const supported = input.supported;
  const wouldExecute =
    input.wouldExecute ??
    (supported !== false && !ambiguous && input.safety.allowed);
  const confirmationAvailable = wouldExecute && input.confirmation !== undefined;
  const confirmationToken = confirmationAvailable
    ? input.confirmation!.manager.createPreviewToken({
        sessionId: input.confirmation!.sessionId,
        tool: input.tool,
        input: input.confirmation!.input,
        ...(input.confirmation!.target === undefined ? {} : { target: input.confirmation!.target }),
        riskLevel: input.confirmation!.riskLevel,
        ...(input.confirmation!.appSensitivity === undefined
          ? {}
          : { appSensitivity: input.confirmation!.appSensitivity }),
        ...(input.confirmation!.dataSensitivity === undefined
          ? {}
          : { dataSensitivity: input.confirmation!.dataSensitivity }),
        targetSummary: input.targetSummary
      })
    : undefined;
  const confirmationInfo: ToolConfirmationInfo | undefined = confirmationToken === undefined
    ? undefined
    : {
        status: "previewGenerated",
        used: false,
        accepted: false,
        executed: false,
        reason: input.confirmation!.explanation,
        tokenId: confirmationToken.tokenId,
        expiresAt: confirmationToken.expiresAt
      };

  return toolSuccess<ActionPreviewResult>({
    tool: input.tool,
    riskLevel: input.safety.riskLevel,
    ...(input.strategy === undefined ? {} : { strategy: input.strategy }),
    preview: true,
    ...(confirmationInfo === undefined ? {} : { confirmation: confirmationInfo }),
    data: {
      preview: true,
      wouldExecute,
      wouldRequireApproval: input.safety.approval.required,
      wouldBeBlocked: input.safety.blocked,
      riskLevel: input.safety.riskLevel,
      appSensitivity: input.safety.appSensitivity,
      ...(input.dataSensitivity === undefined ? {} : { dataSensitivity: input.dataSensitivity }),
      targetSummary: input.targetSummary,
      ...(input.target === undefined ? {} : { target: input.target }),
      ambiguous,
      reasons: input.reasons ?? input.safety.reasons,
      matchedRules: input.matchedRules ?? input.safety.matchedRules,
      ...(input.saferAlternative === undefined ? {} : { saferAlternative: input.saferAlternative }),
      ...(supported === undefined ? {} : { supported }),
      ...(input.backend === undefined ? {} : { backend: input.backend }),
      confirmationAvailable,
      confirmationRequired: input.confirmation !== undefined,
      ...(confirmationToken === undefined ? {} : { confirmationToken: confirmationToken.confirmationToken }),
      ...(confirmationToken === undefined ? {} : { tokenId: confirmationToken.tokenId }),
      ...(confirmationToken === undefined ? {} : { expiresAt: confirmationToken.expiresAt }),
      ...(confirmationToken === undefined ? {} : { inputFingerprint: confirmationToken.inputFingerprint }),
      ...(confirmationToken?.targetFingerprint === undefined
        ? {}
        : { targetFingerprint: confirmationToken.targetFingerprint }),
      ...(input.confirmation === undefined
        ? {}
        : { confirmationExplanation: input.confirmation.explanation })
    },
    approval: input.safety.approval,
    observations:
      input.observations ??
      [
        wouldExecute
          ? "Preview completed without executing the action."
          : "Preview stopped before execution and reported the safety outcome."
      ]
  });
}

export function summarizeAccessibilityElement(element: AccessibilityElementDetails): string {
  const role = element.role.trim() === "" ? "element" : element.role;
  const name = element.name?.trim();
  const appName = element.appName?.trim();

  if (name !== undefined && name !== "") {
    return appName === undefined || appName === ""
      ? `${role} "${name}"`
      : `${role} "${name}" in ${appName}`;
  }

  return appName === undefined || appName === "" ? role : `${role} in ${appName}`;
}

export function toAccessibilityPreviewTarget(element: AccessibilityElementDetails): ActionPreviewTarget {
  return {
    kind: "accessibility_element",
    summary: summarizeAccessibilityElement(element),
    ...(element.appName === undefined ? {} : { appName: element.appName }),
    ...(element.windowId === undefined ? {} : { windowId: element.windowId }),
    ...(element.pid === undefined ? {} : { pid: element.pid }),
    elementId: element.elementId,
    role: element.role,
    ...(element.name === undefined ? {} : { name: element.name }),
    ...(element.availableActions.length === 0 ? {} : { availableActions: element.availableActions })
  };
}

export function acceptedConfirmation(tokenId: string | undefined, executed: boolean, reason: string): ToolConfirmationInfo {
  return {
    status: "tokenAccepted",
    used: true,
    accepted: true,
    executed,
    reason,
    ...(tokenId === undefined ? {} : { tokenId })
  };
}

export function rejectedConfirmation(tokenId: string | undefined, reason: string): ToolConfirmationInfo {
  return {
    status: "tokenRejected",
    used: tokenId !== undefined,
    accepted: false,
    executed: false,
    reason,
    ...(tokenId === undefined ? {} : { tokenId })
  };
}

export function confirmationRequired(reason: string): ToolConfirmationInfo {
  return {
    status: "tokenRejected",
    used: false,
    accepted: false,
    executed: false,
    reason
  };
}

export function usedConfirmation(tokenId: string | undefined, reason: string): ToolConfirmationInfo {
  return {
    status: "tokenUsed",
    used: true,
    accepted: false,
    executed: false,
    reason,
    ...(tokenId === undefined ? {} : { tokenId })
  };
}

export function summarizeWindow(window: DesktopWindowContext | DesktopWindowSummary): string {
  const appName = window.appName?.trim();
  const title = window.title?.trim();

  if (appName !== undefined && appName !== "" && title !== undefined && title !== "") {
    return `${appName} "${title}"`;
  }

  if (appName !== undefined && appName !== "") {
    return appName;
  }

  if (title !== undefined && title !== "") {
    return `Window "${title}"`;
  }

  if (window.windowId !== undefined) {
    return `Window ${window.windowId}`;
  }

  if (window.pid !== undefined) {
    return `PID ${window.pid}`;
  }

  return "Window";
}

export function toWindowPreviewTarget(window: DesktopWindowContext | DesktopWindowSummary): ActionPreviewTarget {
  return {
    kind: "desktop_window",
    summary: summarizeWindow(window),
    ...(window.appName === undefined ? {} : { appName: window.appName }),
    ...(window.windowId === undefined ? {} : { windowId: window.windowId }),
    ...(window.pid === undefined ? {} : { pid: window.pid }),
    ...(window.title === undefined ? {} : { title: window.title })
  };
}

export function toShellPreviewTarget(command: string): ActionPreviewTarget {
  return {
    kind: "shell_command",
    summary: command,
    command
  };
}

export function toFilePreviewTarget(path: string, summary: string): ActionPreviewTarget {
  return {
    kind: "file_path",
    summary,
    path
  };
}

export function toAppPreviewTarget(appName: string, summary?: string): ActionPreviewTarget {
  return {
    kind: "app",
    summary: summary ?? appName,
    appName
  };
}

export function guideAlternative(reason: string): ActionPreviewAlternative {
  return {
    strategy: "guide_only",
    tool: "guide.create_steps",
    reason
  };
}

export function inspectElementAlternative(reason: string): ActionPreviewAlternative {
  return {
    strategy: "accessibility",
    tool: "accessibility.inspect_element",
    reason
  };
}
