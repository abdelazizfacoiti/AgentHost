# Performance and deterministic benchmarks

AgentHost optimizes verified completion cost, not isolated click latency. Planning and routing surfaces are advisory metadata; they never probe an application, execute a route, capture a screenshot, or send data to a remote service.

Run the deterministic fixture benchmark after building:

```bash
npm run build
npm run benchmark:routing
```

Fixtures cover simple Browser Bridge selection, disconnected Bridge with accessibility fallback, OCR versus screenshot grounding, protected guide mode, failed-route replan, deterministic adapter selection, and bounded multistep routing. Output includes decision level, goal-classification/strategy/plan/route medians and p95s, estimated verified completion cost, bounded time-to-first-useful-action, verification duration, total verified completion, approximate token usage derived only from serialized fixture metadata, fallback/replan/retry counts, OCR/screenshot/desktop/model-call counters, bounded context bytes, candidate families, health, compatibility, verification class, and selected/expected route. It contains no prompt, URL, page text, screenshot, coordinate, element ID, message, recipient, tool argument, or secret. `generatedAt` is a fixed fixture marker for comparability.

The benchmark is not an end-to-end latency claim. It measures deterministic local metadata operations and uses declared fixture estimates for completion cost; no application probe or action runs. Runtime probes remain bounded and lazy; structured browser/accessibility evidence precedes OCR and screenshots; desktop and guide fallback remain explicit. Route metrics persist only redacted fingerprints and verified outcomes with expiry. Policy blocks, cancellations, protected-context refusals, and user aborts do not reduce route reliability.

Measure context sizes separately with serialized bounded MCP responses and retain only byte counts. Do not persist raw prompts to improve cache hit rate.
