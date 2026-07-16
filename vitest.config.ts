import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@agenthost/app-browser": path.resolve("packages/app-browser/src/index.ts"), "@agenthost/app-control-room": path.resolve("packages/app-control-room/src/index.ts") } },
  test: {
    environment: "node",
    include: ["packages/*/src/**/*.test.ts"]
  }
});
