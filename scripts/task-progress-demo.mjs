#!/usr/bin/env node
/* Live progress-card demo. The buttons only change local demo state. */
import { createOverlayRenderer, OverlayManager, TaskProgressOverlay } from "../packages/app-overlay/dist/index.js";

const sessionId = "task-progress-demo";
const renderer = createOverlayRenderer("gtk3-x11", { environment: process.env, sessionId });
const capabilities = await renderer.capabilities();
if (!capabilities.supported) {
  console.log(JSON.stringify({ ok: false, reason: capabilities.reason, limitations: capabilities.limitations }));
  await renderer.close?.();
  process.exit(1);
}

const manager = new OverlayManager(renderer, { sessionId });
let paused = false;
let stopped = false;
const controller = new TaskProgressOverlay({
  manager,
  taskId: "task_demo_salary_research",
  title: "Researching Aubay salaries",
  steps: [
    { id: "reviews", label: "Collect review pages" },
    { id: "bands", label: "Extract salary bands" },
    { id: "compare", label: "Compare to offer" },
    { id: "summary", label: "Write negotiation summary" }
  ],
  onAction: (action) => {
    if (action === "pause") paused = true;
    if (action === "resume") paused = false;
    if (action === "stop") stopped = true;
    if (action === "dismiss") stopped = true;
    console.log(`control ${action}`);
  }
});

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const poller = setInterval(() => void controller.pollEvents().catch(() => undefined), 200);

if (!(await controller.start())) {
  console.log(JSON.stringify({ ok: false, reason: "overlay_not_visible" }));
  clearInterval(poller);
  await manager.close();
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, renderer: capabilities.renderer, sessionId, taskId: controller.snapshot().taskId }));

const runStep = async (id, durationMs, detail) => {
  await controller.setStep(id);
  await controller.setDetail(detail);
  let remaining = durationMs;
  while (remaining > 0 && !stopped) {
    if (paused) {
      await controller.pause();
      while (paused && !stopped) await sleep(150);
      if (!stopped) await controller.resume();
    }
    await sleep(Math.min(250, remaining));
    remaining -= 250;
  }
};

try {
  await runStep("reviews", 4_000, "Reading public review summaries");
  if (!stopped) await runStep("bands", 5_000, "Extracting reported salary ranges");
  if (!stopped) await runStep("compare", 4_000, "Comparing the offer with market ranges");
  if (!stopped) await runStep("summary", 4_000, "Drafting the negotiation summary");
} finally {
  clearInterval(poller);
  if (stopped) {
    await controller.stopped("Stopped by operator");
    await sleep(1_500);
  } else {
    await controller.complete("Summary ready");
    await sleep(15_500);
  }
  await controller.dismiss();
  await manager.close();
}
