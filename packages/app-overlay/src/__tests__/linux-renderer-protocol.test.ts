import { describe, expect, it } from "vitest";
import { OVERLAY_IPC_MAX_BYTES, OVERLAY_IPC_VERSION, serializeRendererMessage, validateRendererReply, validateRendererRequest } from "../linux-renderer-protocol.js";

describe("overlay renderer IPC protocol", () => {
  it("caps serialized messages and accepts only fixed commands", () => {
    expect(serializeRendererMessage({ value: "x".repeat(OVERLAY_IPC_MAX_BYTES) })).toBeUndefined();
    const request = { version: OVERLAY_IPC_VERSION, id: "request-1", token: "t".repeat(32), command: "show" };
    expect(validateRendererRequest(request)).toBe(true);
    expect(validateRendererRequest({ ...request, command: "eval" })).toBe(false);
    expect(validateRendererRequest({ ...request, payload: { text: "x".repeat(OVERLAY_IPC_MAX_BYTES) } })).toBe(false);
  });

  it("rejects malformed or untrusted messages", () => {
    expect(validateRendererRequest({ version: OVERLAY_IPC_VERSION, id: "x", token: "short", command: "state" })).toBe(false);
    expect(validateRendererRequest({ version: 2, id: "x", token: "t".repeat(32), command: "state" })).toBe(false);
    expect(validateRendererReply({ version: OVERLAY_IPC_VERSION, id: "x", ok: true, error: "x".repeat(501) })).toBe(false);
    expect(validateRendererReply({ version: OVERLAY_IPC_VERSION, id: "x", ok: false, error: "renderer_token_invalid" })).toBe(true);
  });
});
