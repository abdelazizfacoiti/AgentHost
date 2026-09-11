import type { BrowserCheckpointResult, BrowserElementSummary, BrowserFamily, BrowserFormStateResult, BrowserPageContext, BrowserTabSummary, BrowserTextResult } from "@agenthost/core";

export type BrowserCommand = "detect" | "list_tabs" | "get_active_tab" | "current_url" | "open_url" | "get_page_context" | "extract_text" | "find_element" | "describe_element" | "click_element" | "fill_text" | "focus_element" | "wait_for_state" | "get_form_state" | "get_selected_text";
export interface BrowserElementQuery { text?: string; role?: string; label?: string; placeholder?: string; ariaLabel?: string; testId?: string; css?: string; exact?: boolean; }
export interface BrowserCheckpoint { expectedUrlContains?: string; expectedText?: string; expectedElement?: BrowserElementQuery; expectedFocusedElementId?: string; timeoutMs?: number; }
export interface BridgeBrowserInfo { family: BrowserFamily; version?: string; }
export interface BridgeTab extends BrowserTabSummary { rawUrl?: string; }
export interface BrowserSessionHolder {
  family: BridgeBrowserInfo["family"];
  deviceIdSuffix: string;
  connectedAt: string;
  lastSeenAt: string;
}
export interface BrowserBridgeAdapter {
  detect(): Promise<{ enabled: boolean; connected: boolean; paired: boolean; browser?: BridgeBrowserInfo; session?: BrowserSessionHolder; reason: string }>;
  /** Drops the active session so another paired device (e.g. the background worker) can connect next. */
  releaseSession(): Promise<{ released: boolean; previousDeviceSuffix?: string }>;
  listTabs(limit: number): Promise<BridgeTab[]>;
  activeTab(): Promise<BridgeTab>;
  currentUrl(tabId?: string): Promise<BridgeTab>;
  openUrl(input: { url: string; disposition: "new_tab" | "current_tab"; tabId?: string }): Promise<BridgeTab>;
  pageContext(input: { tabId?: string; maxElements: number }): Promise<BrowserPageContext>;
  extractText(input: { tabId?: string; maxChars: number }): Promise<BrowserTextResult>;
  findElement(input: { tabId?: string; query: BrowserElementQuery; limit: number }): Promise<{ tab: BrowserTabSummary; elements: BrowserElementSummary[]; ambiguous: boolean }>;
  describeElement(elementId: string): Promise<BrowserElementSummary>;
  clickElement(input: { elementId: string; checkpoint?: BrowserCheckpoint }): Promise<{ element: BrowserElementSummary; checkpoint?: BrowserCheckpointResult }>;
  fillText(input: { elementId: string; text: string; checkpoint?: BrowserCheckpoint }): Promise<{ element: BrowserElementSummary; textLength: number; checkpoint?: BrowserCheckpointResult }>;
  focusElement(input: { elementId: string; checkpoint?: BrowserCheckpoint }): Promise<{ element: BrowserElementSummary; checkpoint?: BrowserCheckpointResult }>;
  waitForState(input: { tabId?: string; condition: unknown; timeoutMs: number }): Promise<{ passed: boolean; durationMs: number; summary: string }>;
  formState(input: { tabId?: string; formElementId?: string; maxFields: number }): Promise<BrowserFormStateResult>;
  selectedText(input: { tabId?: string; maxChars: number }): Promise<BrowserTextResult>;
}
