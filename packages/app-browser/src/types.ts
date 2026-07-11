import type { BrowserFamily, BrowserPageContext, BrowserTabSummary, BrowserTextResult } from "@agenthost/core";

export type BrowserCommand = "detect" | "list_tabs" | "get_active_tab" | "current_url" | "open_url" | "get_page_context" | "extract_text";
export interface BridgeBrowserInfo { family: BrowserFamily; version?: string; }
export interface BridgeTab extends BrowserTabSummary { rawUrl?: string; }
export interface BrowserBridgeAdapter {
  detect(): Promise<{ enabled: boolean; connected: boolean; paired: boolean; browser?: BridgeBrowserInfo; reason: string }>;
  listTabs(limit: number): Promise<BridgeTab[]>;
  activeTab(): Promise<BridgeTab>;
  currentUrl(tabId?: string): Promise<BridgeTab>;
  openUrl(input: { url: string; disposition: "new_tab" | "current_tab"; tabId?: string }): Promise<BridgeTab>;
  pageContext(input: { tabId?: string; maxElements: number }): Promise<BrowserPageContext>;
  extractText(input: { tabId?: string; maxChars: number }): Promise<BrowserTextResult>;
}
