import {
  redactSensitiveText,
  type AccessibilityElementCandidate,
  type AccessibilityFindElementResult,
  type AccessibilityTreeNode,
  type AccessibilityTreeResult,
  type DesktopCapabilitySupport,
  type DesktopWindowBounds
} from "@agenthost/core";
import { findCommandPath, type LinuxLookupContext } from "./dependencies.js";
import { runSafeLinuxCommand } from "./shell.js";

export interface LinuxAccessibilityContext extends LinuxLookupContext {
  agentHostDir?: string;
}

export interface LinuxAccessibilityTreeInput {
  appName?: string;
  windowId?: string;
  pid?: number;
  maxDepth?: number;
  maxNodes?: number;
  includeText?: boolean;
}

export interface LinuxAccessibilityFindElementInput {
  appName?: string;
  windowId?: string;
  pid?: number;
  query: string;
  role?: string;
  limit?: number;
}

interface SessionInfo {
  sessionType: "x11" | "wayland" | "unknown";
  displayAvailable: boolean;
}

interface RawAccessibilityNode {
  id: string;
  role: string;
  name?: string;
  text?: string;
  description?: string;
  bounds?: DesktopWindowBounds;
  sensitive?: boolean;
  hidden?: boolean;
  children?: RawAccessibilityNode[];
}

interface RawAccessibilityCandidate {
  id: string;
  role: string;
  name?: string;
  text?: string;
  bounds?: DesktopWindowBounds;
  confidence: number;
  reason: string;
  sensitive?: boolean;
  hidden?: boolean;
}

function sessionInfo(context: LinuxAccessibilityContext = {}): SessionInfo {
  const env = context.env ?? process.env;
  const raw = (env.XDG_SESSION_TYPE ?? "").trim().toLowerCase();

  if (raw === "x11") {
    return { sessionType: "x11", displayAvailable: Boolean(env.DISPLAY) };
  }

  if (raw === "wayland") {
    return { sessionType: "wayland", displayAvailable: Boolean(env.WAYLAND_DISPLAY) };
  }

  if (env.DISPLAY !== undefined && env.DISPLAY.length > 0) {
    return { sessionType: "x11", displayAvailable: true };
  }

  if (env.WAYLAND_DISPLAY !== undefined && env.WAYLAND_DISPLAY.length > 0) {
    return { sessionType: "wayland", displayAvailable: true };
  }

  return { sessionType: "unknown", displayAvailable: false };
}

const ACCESSIBILITY_SCRIPT = String.raw`
import json
import re
import sys

def emit(payload):
    sys.stdout.write(json.dumps(payload))

try:
    import pyatspi
except Exception:
    emit({
        "supported": False,
        "backend": "atspi",
        "reason": "Python pyatspi is unavailable."
    })
    raise SystemExit(0)

def safe_name(node):
    try:
        return node.name
    except Exception:
        return None

def safe_description(node):
    try:
        return node.description
    except Exception:
        return None

def safe_pid(node):
    try:
        return node.get_process_id()
    except Exception:
        return None

def state_flags(node):
    sensitive = False
    hidden = False

    try:
        state_set = node.getState()
        if state_set.contains(pyatspi.STATE_PASSWORD_TEXT):
            sensitive = True
        if not state_set.contains(pyatspi.STATE_SHOWING):
            hidden = True
    except Exception:
        pass

    return sensitive, hidden

def safe_text(node, include_text, sensitive, hidden):
    if not include_text or sensitive or hidden:
        return None

    try:
        text_iface = node.queryText()
        char_count = min(getattr(text_iface, "characterCount", 0), 200)
        if char_count <= 0:
            return None
        return text_iface.getText(0, char_count)
    except Exception:
        return None

def safe_bounds(node):
    try:
        component = node.queryComponent()
        extents = component.getExtents(pyatspi.XY_SCREEN)
        return {
            "x": int(extents.x),
            "y": int(extents.y),
            "width": int(extents.width),
            "height": int(extents.height)
        }
    except Exception:
        return None

def role_name(node):
    try:
        return node.getRoleName()
    except Exception:
        return "unknown"

def normalize(value):
    return (value or "").strip().lower()

def matches_app(app_node, app_name, pid):
    if app_name is None and pid is None:
        return True

    node_name = normalize(safe_name(app_node))
    node_pid = safe_pid(app_node)

    if pid is not None and node_pid == pid:
        return True

    if app_name is not None and node_name == normalize(app_name):
        return True

    return False

input_data = json.loads(sys.argv[1])
mode = input_data.get("mode", "tree")
app_name = input_data.get("appName")
pid = input_data.get("pid")
query = normalize(input_data.get("query"))
role_hint = normalize(input_data.get("role"))
max_depth = int(input_data.get("maxDepth", 3))
max_nodes = int(input_data.get("maxNodes", 200))
include_text = bool(input_data.get("includeText", True))
limit = int(input_data.get("limit", 10))

desktop = pyatspi.Registry.getDesktop(0)
roots = []

for index in range(desktop.childCount):
    try:
        app = desktop.getChildAtIndex(index)
    except Exception:
        continue

    if matches_app(app, app_name, pid):
        roots.append(app)

if not roots:
    emit({
        "supported": True,
        "backend": "atspi",
        "reason": "No matching accessibility root was found.",
        "root": None,
        "nodeCount": 0,
        "truncated": False,
        "redacted": False,
        "candidates": []
    })
    raise SystemExit(0)

node_count = 0
truncated = False
redacted = False
candidates = []

def record_candidate(node_id, role, name, text, bounds, confidence, reason, sensitive, hidden):
    global redacted
    if sensitive or hidden:
        redacted = True
    candidates.append({
        "id": node_id,
        "role": role,
        "name": name,
        "text": None if sensitive or hidden else text,
        "bounds": bounds,
        "confidence": confidence,
        "reason": reason,
        "sensitive": sensitive,
        "hidden": hidden
    })

def visit(node, depth):
    global node_count, truncated, redacted
    if node_count >= max_nodes:
      truncated = True
      return None

    node_count += 1
    sensitive, hidden = state_flags(node)
    role = role_name(node)
    name = safe_name(node)
    text = safe_text(node, include_text, sensitive, hidden)
    description = safe_description(node)
    bounds = safe_bounds(node)
    node_id = f"{safe_pid(node) or 'node'}:{node_count}"

    if sensitive or hidden:
        redacted = True

    if mode == "find":
        haystacks = [normalize(name), normalize(text), normalize(description)]
        role_match = role_hint and normalize(role) == role_hint
        query_match = any(query and query in haystack for haystack in haystacks)

        if role_match or query_match:
            confidence = 1.0 if role_match and query_match else 0.82 if query_match else 0.7
            reason = "Matched role and text hints." if role_match and query_match else "Matched text hint." if query_match else "Matched role hint."
            record_candidate(node_id, role, name, text, bounds, confidence, reason, sensitive, hidden)

    children = []
    if depth < max_depth:
        try:
            child_count = node.childCount
        except Exception:
            child_count = 0

        for child_index in range(child_count):
            try:
                child = node.getChildAtIndex(child_index)
            except Exception:
                continue
            child_node = visit(child, depth + 1)
            if child_node is not None:
                children.append(child_node)
    else:
        try:
            if node.childCount > 0:
                truncated = True
        except Exception:
            pass

    if mode == "find":
        return None

    result = {
        "id": node_id,
        "role": role,
        "name": name,
        "text": None if sensitive or hidden else text,
        "description": description,
        "bounds": bounds,
        "sensitive": sensitive,
        "hidden": hidden
    }

    if children:
        result["children"] = children

    return result

if mode == "tree":
    root_node = visit(roots[0], 0)
    emit({
        "supported": True,
        "backend": "atspi",
        "reason": "Read accessibility data through AT-SPI.",
        "root": root_node,
        "nodeCount": node_count,
        "truncated": truncated,
        "redacted": redacted
    })
else:
    for root in roots:
        visit(root, 0)
        if len(candidates) >= limit or node_count >= max_nodes:
            break

    emit({
        "supported": True,
        "backend": "atspi",
        "reason": "Found accessibility element candidates through AT-SPI.",
        "candidates": candidates[:limit],
        "redacted": redacted
    })
`;

function support(backend: string, reason: string): DesktopCapabilitySupport {
  return {
    supported: true,
    backend,
    reason
  };
}

function unsupported(backend: string, reason: string): DesktopCapabilitySupport {
  return {
    supported: false,
    backend,
    reason
  };
}

async function runAccessibilityCommand(
  command: string,
  args: string[],
  context: LinuxAccessibilityContext = {}
): Promise<Awaited<ReturnType<typeof runSafeLinuxCommand>>> {
  const input: {
    command: string;
    args: string[];
    timeoutMs: number;
    maxOutputBytes: number;
    cwd?: string;
  } = {
    command,
    args,
    timeoutMs: 10_000,
    maxOutputBytes: 512 * 1024
  };

  if (context.agentHostDir !== undefined) {
    input.cwd = context.agentHostDir;
  }

  return runSafeLinuxCommand(input);
}

function redactUiString(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  const redacted = redactSensitiveText(value).trim();
  return redacted.length > 0 ? redacted : undefined;
}

function redactNode(node: RawAccessibilityNode | undefined): AccessibilityTreeNode | undefined {
  if (node === undefined) {
    return undefined;
  }

  const result: AccessibilityTreeNode = {
    id: node.id,
    role: node.role
  };

  const name = redactUiString(node.name);
  const description = redactUiString(node.description);
  const text = node.sensitive || node.hidden ? undefined : redactUiString(node.text);

  if (name !== undefined) {
    result.name = name;
  }

  if (description !== undefined) {
    result.description = description;
  }

  if (text !== undefined) {
    result.text = text;
  }

  if (node.bounds !== undefined) {
    result.bounds = node.bounds;
  }

  if (node.sensitive === true) {
    result.sensitive = true;
  }

  if (node.hidden === true) {
    result.hidden = true;
  }

  if (node.children !== undefined && node.children.length > 0) {
    result.children = node.children
      .map((child) => redactNode(child))
      .filter((child): child is AccessibilityTreeNode => child !== undefined);
  }

  return result;
}

function redactCandidate(candidate: RawAccessibilityCandidate): AccessibilityElementCandidate {
  const result: AccessibilityElementCandidate = {
    id: candidate.id,
    role: candidate.role,
    confidence: candidate.confidence,
    reason: candidate.reason
  };
  const name = redactUiString(candidate.name);
  const text = candidate.sensitive || candidate.hidden ? undefined : redactUiString(candidate.text);

  if (name !== undefined) {
    result.name = name;
  }

  if (text !== undefined) {
    result.text = text;
  }

  if (candidate.bounds !== undefined) {
    result.bounds = candidate.bounds;
  }

  return result;
}

async function pythonAccessibilityResult(
  payload: Record<string, unknown>,
  context: LinuxAccessibilityContext = {}
): Promise<
  | { supported: false; backend: string; reason: string }
  | {
      supported: true;
      backend: string;
      reason: string;
      root?: RawAccessibilityNode;
      nodeCount?: number;
      truncated?: boolean;
      redacted?: boolean;
      candidates?: RawAccessibilityCandidate[];
    }
> {
  const pythonPath = await findCommandPath("python3", context);

  if (pythonPath === undefined) {
    return {
      supported: false,
      backend: "unavailable",
      reason: "Python 3 is unavailable, so the AT-SPI accessibility backend cannot be used."
    };
  }

  const result = await runAccessibilityCommand(pythonPath, ["-c", ACCESSIBILITY_SCRIPT, JSON.stringify(payload)], context);

  if (result.exitCode !== 0) {
    return {
      supported: false,
      backend: "atspi",
      reason: "The AT-SPI accessibility backend did not complete successfully."
    };
  }

  try {
    return JSON.parse(result.stdout) as ReturnType<typeof pythonAccessibilityResult> extends Promise<infer TValue>
      ? Exclude<TValue, Promise<unknown>>
      : never;
  } catch {
    return {
      supported: false,
      backend: "atspi",
      reason: "The accessibility backend returned invalid data."
    };
  }
}

export async function detectLinuxAccessibilitySupport(
  context: LinuxAccessibilityContext = {}
): Promise<DesktopCapabilitySupport> {
  const session = sessionInfo(context);

  if (!session.displayAvailable) {
    return unsupported("unavailable", "No Linux desktop display session is available.");
  }

  const result = await pythonAccessibilityResult({ mode: "tree", maxDepth: 0, maxNodes: 1, includeText: false }, context);

  if (!result.supported) {
    return unsupported(result.backend, result.reason);
  }

  return support("atspi", "AT-SPI accessibility data is available.");
}

export async function getLinuxAccessibilityTree(
  input: LinuxAccessibilityTreeInput,
  context: LinuxAccessibilityContext = {}
): Promise<AccessibilityTreeResult> {
  const session = sessionInfo(context);

  if (!session.displayAvailable) {
    return {
      supported: false,
      backend: "unavailable",
      nodeCount: 0,
      truncated: false,
      redacted: false,
      reason: "No Linux desktop display session is available."
    };
  }

  const result = await pythonAccessibilityResult(
    {
      mode: "tree",
      appName: input.appName,
      pid: input.pid,
      maxDepth: Math.min(Math.max(input.maxDepth ?? 3, 1), 6),
      maxNodes: Math.min(Math.max(input.maxNodes ?? 200, 1), 1000),
      includeText: input.includeText ?? true
    },
    context
  );

  if (!result.supported) {
    return {
      supported: false,
      backend: result.backend,
      nodeCount: 0,
      truncated: false,
      redacted: false,
      reason: result.reason
    };
  }

  const tree: AccessibilityTreeResult = {
    supported: true,
    backend: result.backend,
    nodeCount: result.nodeCount ?? 0,
    truncated: result.truncated ?? false,
    redacted: result.redacted ?? false,
    reason: result.reason
  };

  const root = redactNode(result.root);

  if (root !== undefined) {
    tree.root = root;
  }

  return tree;
}

export async function findLinuxAccessibilityElements(
  input: LinuxAccessibilityFindElementInput,
  context: LinuxAccessibilityContext = {}
): Promise<AccessibilityFindElementResult> {
  const session = sessionInfo(context);

  if (!session.displayAvailable) {
    return {
      supported: false,
      backend: "unavailable",
      candidates: [],
      reason: "No Linux desktop display session is available."
    };
  }

  const result = await pythonAccessibilityResult(
    {
      mode: "find",
      appName: input.appName,
      pid: input.pid,
      query: input.query,
      role: input.role,
      limit: Math.min(Math.max(input.limit ?? 10, 1), 50),
      maxDepth: 6,
      maxNodes: 1000,
      includeText: true
    },
    context
  );

  if (!result.supported) {
    return {
      supported: false,
      backend: result.backend,
      candidates: [],
      reason: result.reason
    };
  }

  return {
    supported: true,
    backend: result.backend,
    candidates: (result.candidates ?? []).map(redactCandidate),
    reason: result.reason
  };
}
