/**
 * Shareable task run reports. Renders a redacted task event log (the same
 * bounded summaries shown by `task watch`) to self-contained Markdown or
 * HTML, so interesting runs can be posted, compared, and learned from.
 * Pure functions with no filesystem or network access; easy to unit test.
 */

export interface TaskExportEvent {
  at?: string;
  kind?: string;
  summary?: string;
}

export interface TaskExportRecord {
  taskId?: string;
  goal?: string;
  status?: string;
  phase?: string;
  currentAction?: string;
  createdAt?: string;
  updatedAt?: string;
  events?: TaskExportEvent[];
}

function text(value: unknown, fallback = "?"): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function escHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escMd(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>");
}

function eventsOf(record: TaskExportRecord): TaskExportEvent[] {
  return Array.isArray(record.events) ? record.events : [];
}

export function renderTaskMarkdown(record: TaskExportRecord): string {
  const events = eventsOf(record);
  const lines = [
    `# AgentHost run: ${text(record.taskId, "task")}`,
    "",
    `- Status: **${text(record.status)}**`,
    `- Phase: ${text(record.phase)}`,
    `- Current action: ${text(record.currentAction)}`,
    `- Created: ${text(record.createdAt)}`,
    `- Updated: ${text(record.updatedAt)}`,
    "",
    `> Goal: ${text(record.goal)}`,
    "",
    "## Timeline",
    "",
    "| Time | Kind | Summary |",
    "|------|------|---------|"
  ];
  for (const event of events) {
    lines.push(`| ${escMd(text(event.at))} | ${escMd(text(event.kind))} | ${escMd(text(event.summary, ""))} |`);
  }
  lines.push("", `_Exported from the redacted task event log (${events.length} events). No secrets, page content, screenshots, or absolute private paths are included._`);
  return `${lines.join("\n")}\n`;
}

export function renderTaskHtml(record: TaskExportRecord): string {
  const events = eventsOf(record);
  const rows = events
    .map(
      (event) =>
        `      <tr><td>${escHtml(text(event.at))}</td><td>${escHtml(text(event.kind))}</td><td>${escHtml(text(event.summary, ""))}</td></tr>`
    )
    .join("\n");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AgentHost run: ${escHtml(text(record.taskId, "task"))}</title>
<style>body{font-family:system-ui,sans-serif;max-width:900px;margin:2rem auto;padding:0 1rem;color:#111}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ccc;padding:.4rem .6rem;text-align:left;vertical-align:top}th{background:#f4f4f4}.badge{display:inline-block;padding:.1rem .5rem;border-radius:999px;background:#eef;border:1px solid #ccd}blockquote{border-left:3px solid #888;margin:1rem 0;padding:.2rem 1rem;color:#333}footer{margin-top:2rem;color:#666;font-size:.85rem}</style>
</head>
<body>
<h1>AgentHost run: ${escHtml(text(record.taskId, "task"))}</h1>
<p><span class="badge">${escHtml(text(record.status))}</span> phase ${escHtml(text(record.phase))} &middot; action ${escHtml(text(record.currentAction))}</p>
<blockquote>Goal: ${escHtml(text(record.goal))}</blockquote>
<h2>Timeline</h2>
<table>
<thead><tr><th>Time</th><th>Kind</th><th>Summary</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>
<footer>Exported from the redacted task event log (${events.length} events). No secrets, page content, screenshots, or absolute private paths are included.</footer>
</body>
</html>
`;
}
