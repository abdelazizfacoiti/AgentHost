import type { OverlayWidgetComponent } from "@agenthost/core";

/** Fixed renderer vocabulary. No HTML, CSS, script, URL, or dynamic component loading. */
export const TRUSTED_VISUAL_COMPONENTS = [
  "heading", "text", "divider", "icon", "status_badge", "progress", "spinner", "checklist", "key_value",
  "button", "choice", "comparison", "warning", "image_reference"
] as const;

export function isTrustedVisualComponent(value: unknown): value is OverlayWidgetComponent {
  return typeof value === "object" && value !== null && "type" in value && TRUSTED_VISUAL_COMPONENTS.includes((value as { type?: string }).type as never);
}

export function normalizeTrustedVisualComponents(components: OverlayWidgetComponent[]): OverlayWidgetComponent[] {
  return components.filter(isTrustedVisualComponent).slice(0, 30).map((component) => ({ ...component }));
}
