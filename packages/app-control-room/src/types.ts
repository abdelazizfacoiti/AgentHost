import type { ControlRoomDashboardProjection, ControlRoomHealthProjection, ControlRoomScreenshotProjection, ControlRoomTaskProjection, ControlRoomTimelineEvent, RuntimeActivityProjection } from "@agenthost/core";

export interface ControlRoomTaskQuery { limit: number; cursor?: string; status?: string; from?: string; to?: string; }
export interface ControlRoomScreenshotQuery { limit: number; cursor?: string; taskId?: string; from?: string; to?: string; }
export interface ControlRoomReportProvider {
  dashboard(input: { from?: string; to?: string }): Promise<ControlRoomDashboardProjection>;
  tasks(input: ControlRoomTaskQuery): Promise<{ tasks: ControlRoomTaskProjection[]; nextCursor?: string; truncated: boolean }>;
  task(taskId: string): Promise<ControlRoomTaskProjection>;
  timeline(taskId: string, input: ControlRoomTaskQuery): Promise<{ events: ControlRoomTimelineEvent[]; nextCursor?: string; truncated: boolean }>;
  /** Live background-work feed: latest runtime activities, newest first. Poll this to show progress without watching the app. */
  activity(input: ControlRoomTaskQuery): Promise<{ activities: RuntimeActivityProjection["activities"]; nextCursor?: string; truncated: boolean }>;
  screenshots(input: ControlRoomScreenshotQuery): Promise<{ screenshots: ControlRoomScreenshotProjection[]; nextCursor?: string; truncated: boolean }>;
  screenshot(screenshotId: string): Promise<ControlRoomScreenshotProjection>;
  health(): Promise<ControlRoomHealthProjection>;
  agentStatus?(): Promise<{ stopped: boolean; takeoverActive: boolean }>;
  agentControl?(input: { action: "stop" | "resume" }): Promise<{ stopped: boolean }>;
}
