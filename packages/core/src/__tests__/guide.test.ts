import { describe, expect, it } from "vitest";
import { createGuideSteps, createGuideSuggestion, explainGuideStrategy } from "../index.js";

describe("guide mode", () => {
  it("creates guide-only steps for unknown apps", () => {
    const result = createGuideSteps({
      workflowGoal: "Export a report",
      appName: "Mystery App",
      appId: "unknown:mystery-app",
      workflowKind: "unknown_app",
      availableStrategies: ["guide_only"],
      knownAppSensitivity: "unknown"
    });

    expect(result.strategy).toBe("guide_only");
    expect(result.workflowKind).toBe("unknown_app");
    expect(result.riskLevel).toBe("medium");
    expect(result.steps[0]).toMatchObject({
      id: "open-manually",
      userActionRequired: true
    });
    expect(result.warnings.join(" ")).toContain("unknown");
  });

  it("warns for sensitive communication workflows", () => {
    const result = createGuideSteps({
      workflowGoal: "Review a message before sending",
      appName: "Gmail",
      taskType: "automate"
    });

    expect(result.workflowKind).toBe("sensitive_app");
    expect(result.appSensitivity).toBe("communication");
    expect(result.strategy).toBe("guide_only");
    expect(result.canAutomateLater).toBe(true);
    expect(result.warnings.join(" ")).toContain("will not send messages");
    expect(result.steps.map((step) => step.id)).toContain("review-communication");
  });

  it("creates normal app guidance that can be automated later", () => {
    const result = createGuideSteps({
      workflowGoal: "Export an image",
      appName: "GIMP",
      availableStrategies: ["cli_or_script", "guide_only"],
      knownAppSensitivity: "normal"
    });

    expect(result.workflowKind).toBe("general");
    expect(result.appSensitivity).toBe("normal");
    expect(result.riskLevel).toBe("low");
    expect(result.canAutomateLater).toBe(true);
    expect(result.relatedToolSuggestions[0]).toMatchObject({
      tool: "app.get_strategy"
    });
  });

  it("creates reusable guide suggestions for app strategy results", () => {
    const suggestion = createGuideSuggestion({
      workflowGoal: "Use Unknown safely",
      appName: "Unknown",
      appId: "unknown:unknown",
      workflowKind: "unknown_app"
    });

    expect(suggestion).toMatchObject({
      strategy: "guide_only",
      suggestedTool: "guide.create_steps"
    });
    expect(suggestion.input).toMatchObject({
      workflowKind: "unknown_app",
      knownRiskLevel: "medium"
    });
  });

  it("explains why guide mode is recommended", () => {
    const explanation = explainGuideStrategy({
      appName: "Slack",
      taskType: "automate",
      availableStrategies: ["guide_only"],
      recommendedStrategy: "guide_only",
      reason: "Communication workflows should stay manual."
    });

    expect(explanation.recommendedStrategy).toBe("guide_only");
    expect(explanation.appSensitivity).toBe("communication");
    expect(explanation.reasons.join(" ")).toContain("Sensitive app categories");
    expect(explanation.guideSuggestion.suggestedTool).toBe("guide.create_steps");
  });
});
