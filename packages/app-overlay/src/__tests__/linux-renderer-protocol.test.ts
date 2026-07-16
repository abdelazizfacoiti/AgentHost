import { describe, expect, it } from "vitest";
import { OVERLAY_IPC_MAX_BYTES, OVERLAY_IPC_VERSION, serializeRendererMessage, validateRendererHandshake, validateRendererOperationData, validateRendererReply, validateRendererRequest } from "../linux-renderer-protocol.js";

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

  it("requires handshake epoch and correlated render acknowledgement", () => {
    expect(validateRendererHandshake({ protocolVersion: 1, capabilities: {}, rendererEpoch: 1 })).toBe(true);
    expect(validateRendererHandshake({ protocolVersion: 1, capabilities: {} })).toBe(false);
    const ack = { command: "show", acknowledgement: "visible", rendererEpoch: 3, visibleWindowCount: 1, interactiveWindowCount: 0, overlayId: "overlay-1" };
    expect(validateRendererOperationData(ack, "show")).toBe(true);
    expect(validateRendererOperationData({ ...ack, command: "update" }, "show")).toBe(false);
    expect(validateRendererOperationData({ ...ack, visibleWindowCount: 0 }, "show")).toBe(false);
  });
});
