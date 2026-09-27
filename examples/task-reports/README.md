# Task reports: shareable run transcripts

`agenthost task export` renders a task's redacted event log — the same
bounded summaries `task watch` shows — to a self-contained file you can
post in issues, PRs, and chat:

```bash
agenthost task export <task-id> --format md --out ./run-report.md
agenthost task export <task-id> --format html --out ./run-report.html
```

- Markdown: goal, status/phase table, and a time/kind/summary timeline.
- HTML: same content as a single styled file, no JavaScript, no external
  assets — safe to attach anywhere.
- Only redacted summaries are included: no secrets, page content,
  screenshots, or absolute private paths.

See [`sample-hespress-run.md`](./sample-hespress-run.md) for what the
Hespress web-research run's report looks like.
