import { AsyncLocalStorage } from "node:async_hooks";
import type { AgentHostMcpContext } from "./context.js";

interface ExecutionLane {
  tail: Promise<void>;
}

const EXECUTION_LANES = new WeakMap<AgentHostMcpContext, ExecutionLane>();
const ACTIVE_LANE = new AsyncLocalStorage<ExecutionLane>();

export async function withStateChangingLane<T>(
  context: AgentHostMcpContext,
  action: () => Promise<T>
): Promise<T> {
  let lane = EXECUTION_LANES.get(context);
  if (lane === undefined) {
    lane = { tail: Promise.resolve() };
    EXECUTION_LANES.set(context, lane);
  }
  if (ACTIVE_LANE.getStore() === lane) {
    return action();
  }
  const previous = lane.tail;
  let release: () => void = () => undefined;
  lane.tail = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await ACTIVE_LANE.run(lane, action);
  } finally {
    release();
  }
}
