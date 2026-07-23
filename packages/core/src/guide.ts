import { classifyAppSensitivity } from "./safety/app-sensitivity.js";
import type {
  AppSensitivity,
  AutomationStrategy,
  GuideCreateStepsInput,
  GuideExplainStrategyInput,
  GuideResult,
  GuideStep,
  GuideStrategyExplanationResult,
  GuideSuggestion,
  GuideToolSuggestion,
  GuideWorkflowKind,
  RiskLevel
} from "./types.js";

const SENSITIVE_APP_CATEGORIES = new Set<AppSensitivity>([
  "communication",
  "financial",
  "credential_or_security",
  "system_settings"
]);

function appLabel(input: Pick<GuideCreateStepsInput, "appName" | "appId">): string {
  return input.appName ?? input.appId ?? "the app";
}

function classifyGuideApp(input: Pick<GuideCreateStepsInput, "appName" | "appId" | "knownAppSensitivity">): AppSensitivity {
  if (input.knownAppSensitivity !== undefined) {
    return input.knownAppSensitivity;
  }

  const classifierInput: { appId?: string; appName?: string } = {};

  if (input.appId !== undefined) {
    classifierInput.appId = input.appId;
  }

  if (input.appName !== undefined) {
    classifierInput.appName = input.appName;
  }

  return classifyAppSensitivity(classifierInput);
}

function hasOnlyGuideStrategy(strategies: AutomationStrategy[] | undefined): boolean {
  return strategies !== undefined && strategies.length > 0 && strategies.every((strategy) => strategy === "guide_only");
}

export function inferGuideWorkflowKind(input: GuideCreateStepsInput): GuideWorkflowKind {
  if (input.workflowKind !== undefined) {
    return input.workflowKind;
  }

  if (input.knownRiskLevel === "high" || input.knownRiskLevel === "blocked") {
    return "unsafe_action";
  }

  const sensitivity = classifyGuideApp(input);

  if (SENSITIVE_APP_CATEGORIES.has(sensitivity)) {
    return "sensitive_app";
  }

  if (input.appId?.startsWith("unknown:") || sensitivity === "unknown") {
    return "unknown_app";
  }

  if (hasOnlyGuideStrategy(input.availableStrategies)) {
    return "unsupported_app";
  }

  if (input.taskType === "inspect") {
    return "manual_review";
  }

  return "general";
}

function riskForGuide(kind: GuideWorkflowKind, sensitivity: AppSensitivity, knownRiskLevel?: RiskLevel): RiskLevel {
  if (knownRiskLevel !== undefined) {
    return knownRiskLevel;
  }

  if (kind === "unsafe_action") {
    return "high";
  }

  if (sensitivity === "credential_or_security" || sensitivity === "financial") {
    return "high";
  }

  if (sensitivity === "communication" || sensitivity === "system_settings") {
    return "medium";
  }

  if (kind === "unknown_app" || kind === "unsupported_app") {
    return "medium";
  }

  return "low";
}

function warningForSensitivity(sensitivity: AppSensitivity): string | undefined {
  switch (sensitivity) {
    case "communication":
      return "Review recipients, attachments, and message content yourself. Guide mode will not send messages.";
    case "financial":
      return "Do not approve payments, transfers, or purchases unless you initiated and verified every detail.";
    case "credential_or_security":
      return "Do not enter passwords, recovery codes, private keys, or security prompts into unknown dialogs.";
    case "system_settings":
      return "Avoid changing security, network, update, or account settings unless you understand the effect.";
    case "unknown":
      return "This app or workflow is unknown, so AgentHost cannot verify the safest automation path yet.";
    case "normal":
      return undefined;
  }
}

function warningsFor(kind: GuideWorkflowKind, sensitivity: AppSensitivity): string[] {
  const warnings: string[] = [];
  const sensitivityWarning = warningForSensitivity(sensitivity);

  if (sensitivityWarning !== undefined) {
    warnings.push(sensitivityWarning);
  }

  if (kind === "unsafe_action") {
    warnings.push("Stop and ask for explicit confirmation before deleting data, sending externally, exposing secrets, or changing system state.");
  }

  if (kind === "unsupported_app" || kind === "unknown_app") {
    warnings.push("Use manual steps because no app adapter, official API, CLI, browser automation, accessibility, or GUI fallback is currently available.");
  }

  return [...new Set(warnings)];
}

function summaryFor(input: GuideCreateStepsInput, kind: GuideWorkflowKind, sensitivity: AppSensitivity): string {
  const target = appLabel(input);

  if (kind === "unsafe_action") {
    return `Use guide-only steps for "${input.workflowGoal}" because the workflow is unsafe to automate.`;
  }

  if (SENSITIVE_APP_CATEGORIES.has(sensitivity)) {
    return `Use guide-only steps for ${target} because this app category is sensitive.`;
  }

  if (kind === "unknown_app") {
    return `Use guide-only steps because ${target} is unknown or unsupported.`;
  }

  if (kind === "unsupported_app") {
    return `Use guide-only steps because ${target} has no supported automation adapter yet.`;
  }

  return `Use structured manual steps for "${input.workflowGoal}" without executing app actions.`;
}

function canAutomateLater(kind: GuideWorkflowKind, sensitivity: AppSensitivity): boolean {
  // Sensitivity raises governance requirements; it does not permanently deny
  // supported effects. Credential/security remains non-automatable.
  return kind !== "unsafe_action" && sensitivity !== "credential_or_security";
}

function strategySuggestion(input: GuideCreateStepsInput): GuideToolSuggestion | undefined {
  if (input.appName === undefined) {
    return undefined;
  }

  const suggestionInput: { appName: string; taskType?: GuideCreateStepsInput["taskType"] } = {
    appName: input.appName
  };

  if (input.taskType !== undefined) {
    suggestionInput.taskType = input.taskType;
  }

  return {
    tool: "app.get_strategy",
    reason: "Re-check available strategies after an adapter, CLI, API, or policy support is added.",
    input: suggestionInput
  };
}

function makeStep(
  id: string,
  title: string,
  instruction: string,
  input: GuideCreateStepsInput,
  riskLevel: RiskLevel,
  options: {
    expectedResult?: string | undefined;
    warning?: string | undefined;
    userActionRequired?: boolean | undefined;
    canAutomateLater?: boolean | undefined;
    relatedToolSuggestion?: GuideToolSuggestion | undefined;
  } = {}
): GuideStep {
  const step: GuideStep = {
    id,
    title,
    instruction,
    riskLevel,
    userActionRequired: options.userActionRequired ?? true,
    canAutomateLater: options.canAutomateLater ?? false
  };

  if (input.appName !== undefined) {
    step.appName = input.appName;
  }

  if (options.expectedResult !== undefined) {
    step.expectedResult = options.expectedResult;
  }

  if (options.warning !== undefined) {
    step.warning = options.warning;
  }

  if (options.relatedToolSuggestion !== undefined) {
    step.relatedToolSuggestion = options.relatedToolSuggestion;
  }

  return step;
}

function createSteps(
  input: GuideCreateStepsInput,
  kind: GuideWorkflowKind,
  sensitivity: AppSensitivity,
  riskLevel: RiskLevel,
  warnings: string[],
  automateLater: boolean
): GuideStep[] {
  const target = appLabel(input);
  const firstWarning = warnings[0];
  const suggestion = strategySuggestion(input);
  const steps: GuideStep[] = [
    makeStep(
      "open-manually",
      "Open The App Manually",
      `Open ${target} yourself and bring it to the workflow needed for: ${input.workflowGoal}.`,
      input,
      riskLevel,
      {
        expectedResult: `${target} is open and ready for manual interaction.`,
        warning: firstWarning
      }
    ),
    makeStep(
      "navigate-workflow",
      "Navigate To The Workflow",
      "Use the app's normal menus, search, or navigation controls to reach the relevant screen.",
      input,
      riskLevel,
      {
        expectedResult: "The relevant screen is visible before any consequential action is taken."
      }
    )
  ];

  if (sensitivity === "communication") {
    steps.push(
      makeStep(
        "review-communication",
        "Review Before Sending",
        "Prepare or review the communication manually, including recipients, message text, links, and attachments.",
        input,
        riskLevel,
        {
          expectedResult: "You have verified the communication content yourself.",
          warning: "AgentHost guide mode does not send, post, or type messages."
        }
      )
    );
  } else if (sensitivity === "credential_or_security") {
    steps.push(
      makeStep(
        "protect-secrets",
        "Protect Secrets",
        "Handle credentials, private keys, recovery codes, and security prompts manually.",
        input,
        riskLevel,
        {
          expectedResult: "No secret material is exposed to automation.",
          warning: "Do not paste secrets into unknown dialogs or prompts."
        }
      )
    );
  } else if (sensitivity === "financial") {
    steps.push(
      makeStep(
        "verify-financial-details",
        "Verify Financial Details",
        "Review payees, amounts, accounts, fees, and confirmation dialogs manually before continuing.",
        input,
        riskLevel,
        {
          expectedResult: "You have independently verified the financial details.",
          warning: "Guide mode will not approve payments, purchases, or transfers."
        }
      )
    );
  } else if (sensitivity === "system_settings") {
    steps.push(
      makeStep(
        "review-system-impact",
        "Review System Impact",
        "Read each setting or permission prompt and decide manually whether the change is acceptable.",
        input,
        riskLevel,
        {
          expectedResult: "You understand the local system impact before making changes.",
          warning: "Guide mode will not change system settings."
        }
      )
    );
  } else {
    steps.push(
      makeStep(
        "complete-task",
        "Complete The Task Manually",
        "Perform the requested app workflow yourself, pausing before any step that deletes data, sends externally, or exposes secrets.",
        input,
        riskLevel,
        {
          expectedResult: "The requested workflow is completed by the user."
        }
      )
    );
  }

  steps.push(
    makeStep(
      "confirm-result",
      "Confirm The Result",
      "Review the final state in the app and confirm that it matches the intended outcome.",
      input,
      riskLevel,
      {
        expectedResult: "The result is verified by the user before any follow-up action.",
        warning: kind === "unsafe_action" ? "Stop if the result would be destructive, externally visible, or security-sensitive." : undefined
      }
    )
  );

  if (automateLater && suggestion !== undefined) {
    steps.push(
      makeStep(
        "record-automation-path",
        "Record Automation Path",
        "Note which app, menu path, command, API, or file format could support safer automation in a future adapter.",
        input,
        "low",
        {
          expectedResult: "Future automation work has enough context to choose a safer strategy.",
          canAutomateLater: true,
          relatedToolSuggestion: suggestion
        }
      )
    );
  }

  return steps;
}

export function createGuideSteps(input: GuideCreateStepsInput): GuideResult {
  const sensitivity = classifyGuideApp(input);
  const kind = inferGuideWorkflowKind(input);
  const riskLevel = riskForGuide(kind, sensitivity, input.knownRiskLevel);
  const warnings = warningsFor(kind, sensitivity);
  const automateLater = canAutomateLater(kind, sensitivity);
  const relatedToolSuggestions = [strategySuggestion(input)].filter(
    (suggestion): suggestion is GuideToolSuggestion => suggestion !== undefined
  );
  const result: GuideResult = {
    strategy: "guide_only",
    workflowGoal: input.workflowGoal,
    workflowKind: kind,
    appSensitivity: sensitivity,
    riskLevel,
    summary: summaryFor(input, kind, sensitivity),
    warnings,
    steps: createSteps(input, kind, sensitivity, riskLevel, warnings, automateLater),
    canAutomateLater: automateLater,
    relatedToolSuggestions
  };

  if (input.appName !== undefined) {
    result.appName = input.appName;
  }

  return result;
}

export function createGuideSuggestion(input: GuideCreateStepsInput): GuideSuggestion {
  const guide = createGuideSteps(input);
  const suggestionInput: GuideCreateStepsInput = {
    workflowGoal: input.workflowGoal,
    workflowKind: guide.workflowKind
  };

  if (input.appName !== undefined) {
    suggestionInput.appName = input.appName;
  }

  if (input.appId !== undefined) {
    suggestionInput.appId = input.appId;
  }

  if (input.taskType !== undefined) {
    suggestionInput.taskType = input.taskType;
  }

  if (input.reason !== undefined) {
    suggestionInput.reason = input.reason;
  }

  if (input.availableStrategies !== undefined) {
    suggestionInput.availableStrategies = input.availableStrategies;
  }

  suggestionInput.knownAppSensitivity = guide.appSensitivity;
  suggestionInput.knownRiskLevel = guide.riskLevel;

  const suggestion: GuideSuggestion = {
    strategy: "guide_only",
    reason: guide.summary,
    suggestedTool: "guide.create_steps",
    input: suggestionInput
  };

  if (guide.warnings[0] !== undefined) {
    suggestion.warning = guide.warnings[0];
  }

  return suggestion;
}

export function explainGuideStrategy(input: GuideExplainStrategyInput): GuideStrategyExplanationResult {
  const createInput: GuideCreateStepsInput = {
    workflowGoal: input.taskType === undefined ? "Choose a safe automation strategy" : `Choose a safe ${input.taskType} strategy`
  };

  if (input.appName !== undefined) {
    createInput.appName = input.appName;
  }

  if (input.taskType !== undefined) {
    createInput.taskType = input.taskType;
  }

  if (input.reason !== undefined) {
    createInput.reason = input.reason;
  }

  if (input.availableStrategies !== undefined) {
    createInput.availableStrategies = input.availableStrategies;
  }

  if (input.knownAppSensitivity !== undefined) {
    createInput.knownAppSensitivity = input.knownAppSensitivity;
  }

  if (input.recommendedStrategy === "guide_only" || hasOnlyGuideStrategy(input.availableStrategies)) {
    createInput.workflowKind = "unsupported_app";
  }

  const sensitivity = classifyGuideApp(createInput);
  const guideSuggestion = createGuideSuggestion(createInput);
  const reasons: string[] = [];

  if (input.reason !== undefined) {
    reasons.push(input.reason);
  }

  if (input.availableStrategies !== undefined) {
    reasons.push(`Available strategies: ${input.availableStrategies.join(", ")}.`);
  }

  if (SENSITIVE_APP_CATEGORIES.has(sensitivity)) {
    reasons.push("Sensitive app categories prefer guide mode before any autonomous action.");
  }

  if (input.recommendedStrategy === "guide_only" || hasOnlyGuideStrategy(input.availableStrategies)) {
    reasons.push("Guide mode is recommended because no safer executable automation path is available yet.");
  }

  if (reasons.length === 0) {
    reasons.push("Guide mode provides manual, structured instructions without executing app actions.");
  }

  const result: GuideStrategyExplanationResult = {
    recommendedStrategy: input.recommendedStrategy ?? "guide_only",
    appSensitivity: sensitivity,
    summary: guideSuggestion.reason,
    reasons,
    warnings: guideSuggestion.warning === undefined ? [] : [guideSuggestion.warning],
    guideSuggestion
  };

  if (input.appName !== undefined) {
    result.appName = input.appName;
  }

  return result;
}
