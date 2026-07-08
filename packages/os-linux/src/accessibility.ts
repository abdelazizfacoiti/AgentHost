import {
  classifyAppSensitivity,
  redactSensitiveText,
  type AccessibilityElementCandidate,
  type AccessibilityElementDetails,
  type AccessibilityFindElementResult,
  type AccessibilityFocusElementResult,
  type AccessibilityInspectElementResult,
  type AccessibilityInvokeActionResult,
  type AccessibilitySetValueResult,
  type AccessibilityTreeNode,
  type AccessibilityTreeResult,
  type AccessibilityValueMetadata,
  type AppSensitivity,
  type DataSensitivity,
  type DesktopCapabilitySupport,
  type DesktopWindowBounds
} from "@agenthost/core";
import { findCommandPath, type LinuxLookupContext } from "./dependencies.js";
import { runSafeLinuxCommand } from "./shell.js";

export interface LinuxAccessibilityContext extends LinuxLookupContext {
  agentHostDir?: string;
  runAccessibilityQuery?: (payload: Record<string, unknown>) => Promise<AccessibilityBackendResult>;
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

export interface LinuxAccessibilityInspectElementInput {
  appName?: string;
  windowId?: string;
  pid?: number;
  elementId?: string;
  query?: string;
  role?: string;
}

export interface LinuxAccessibilityInvokeActionInput extends LinuxAccessibilityInspectElementInput {
  actionName: string;
  requireExactMatch?: boolean;
}

export interface LinuxAccessibilitySetValueInput extends LinuxAccessibilityInspectElementInput {
  value: string;
  dataSensitivity?: DataSensitivity;
}

export interface LinuxAccessibilityFocusElementInput extends LinuxAccessibilityInspectElementInput {}

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
  role?: string | null;
  name?: string | null;
  text?: string | null;
  bounds?: DesktopWindowBounds;
  confidence: number;
  reason?: string | null;
  sensitive?: boolean;
  hidden?: boolean;
}

interface RawAccessibilityValueMetadata {
  supportsText: boolean;
  supportsValue: boolean;
  editable: boolean;
  readOnly: boolean;
  textLength?: number;
  minimum?: number;
  maximum?: number;
  step?: number;
}

interface RawAccessibilityElement {
  id: string;
  role?: string | null;
  name?: string | null;
  description?: string | null;
  states?: string[];
  availableActions?: string[];
  bounds?: DesktopWindowBounds;
  valueMetadata?: RawAccessibilityValueMetadata | null;
  appName?: string | null;
  windowId?: string | null;
  windowTitle?: string | null;
  pid?: number;
  sensitive?: boolean;
  hidden?: boolean;
}

type AccessibilityBackendResult =
  | {
      supported: false;
      backend: string;
      reason: string;
    }
  | {
      supported: true;
      backend: string;
      reason: string;
      root?: RawAccessibilityNode;
      nodeCount?: number;
      truncated?: boolean;
      redacted?: boolean;
      candidates?: RawAccessibilityCandidate[];
      matched?: boolean;
      ambiguous?: boolean;
      element?: RawAccessibilityElement;
      performed?: boolean;
      changed?: boolean;
      focused?: boolean;
      actionName?: string;
    };

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

WINDOW_ROLES = {
    "frame",
    "window",
    "dialog",
    "file chooser",
    "alert",
    "page tab",
}

def normalize(value):
    return (value or "").strip().lower()

def clamp_text(value, limit=300):
    if value is None:
        return None
    value = str(value).strip()
    if len(value) > limit:
        return value[:limit] + "..."
    return value

def safe_name(node):
    try:
        return clamp_text(node.name)
    except Exception:
        return None

def safe_description(node):
    try:
        return clamp_text(node.description)
    except Exception:
        return None

def safe_pid(node):
    try:
        return node.get_process_id()
    except Exception:
        return None

def role_name(node):
    try:
        return normalize(node.getRoleName()) or "unknown"
    except Exception:
        return "unknown"

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
        return clamp_text(text_iface.getText(0, char_count))
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

def safe_states(node):
    states = []
    try:
        state_set = node.getState()
        for state in state_set.getStates():
            try:
                states.append(normalize(str(state)))
            except Exception:
                continue
    except Exception:
        return []
    unique = []
    for state in states:
        if state and state not in unique:
            unique.append(state)
    return unique[:20]

def safe_actions(node):
    actions = []
    try:
        action_iface = node.queryAction()
        for index in range(min(getattr(action_iface, "nActions", 0), 20)):
            try:
                action_name = normalize(action_iface.getName(index))
                if action_name:
                    actions.append(action_name)
            except Exception:
                continue
    except Exception:
        return []
    return actions

def safe_value_metadata(node, sensitive, hidden):
    supports_text = False
    supports_value = False
    editable = False
    text_length = None
    minimum = None
    maximum = None
    step = None

    try:
        text_iface = node.queryText()
        supports_text = True
        if not sensitive and not hidden:
            try:
                text_length = int(min(getattr(text_iface, "characterCount", 0), 10000))
            except Exception:
                text_length = None
    except Exception:
        pass

    try:
        node.queryEditableText()
        editable = True
    except Exception:
        pass

    try:
        value_iface = node.queryValue()
        supports_value = True
        try:
            minimum = float(value_iface.minimumValue)
        except Exception:
            minimum = None
        try:
            maximum = float(value_iface.maximumValue)
        except Exception:
            maximum = None
        try:
            step = float(value_iface.minimumIncrement)
        except Exception:
            step = None
    except Exception:
        pass

    if not supports_text and not supports_value and not editable:
        return None

    payload = {
        "supportsText": supports_text,
        "supportsValue": supports_value,
        "editable": editable,
        "readOnly": not editable and not supports_value,
    }

    if text_length is not None and not sensitive and not hidden:
        payload["textLength"] = text_length
    if minimum is not None and not sensitive and not hidden:
        payload["minimum"] = minimum
    if maximum is not None and not sensitive and not hidden:
        payload["maximum"] = maximum
    if step is not None and not sensitive and not hidden:
        payload["step"] = step

    return payload

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

def candidate_confidence(query_match, role_match, exact_match):
    if exact_match and role_match:
        return 1.0
    if exact_match:
        return 0.95
    if query_match and role_match:
        return 0.9
    if query_match:
        return 0.82
    if role_match:
        return 0.7
    return 0.0

def build_element(node, node_id, app_name, window_title, pid, sensitive, hidden):
    return {
        "id": node_id,
        "role": role_name(node),
        "name": safe_name(node),
        "description": None if sensitive or hidden else safe_description(node),
        "states": safe_states(node),
        "availableActions": safe_actions(node),
        "bounds": safe_bounds(node),
        "valueMetadata": safe_value_metadata(node, sensitive, hidden),
        "appName": app_name,
        "windowTitle": window_title,
        "pid": pid,
        "sensitive": sensitive,
        "hidden": hidden,
    }

input_data = json.loads(sys.argv[1])
mode = input_data.get("mode", "tree")
app_name_filter = input_data.get("appName")
window_id_filter = input_data.get("windowId")
pid_filter = input_data.get("pid")
element_id_filter = input_data.get("elementId")
query = normalize(input_data.get("query"))
role_hint = normalize(input_data.get("role"))
action_name = normalize(input_data.get("actionName"))
require_exact = bool(input_data.get("requireExactMatch", False))
value_input = input_data.get("value")
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

    if matches_app(app, app_name_filter, pid_filter):
        roots.append((index, app))

if not roots:
    if mode == "tree":
        emit({
            "supported": True,
            "backend": "atspi",
            "reason": "No matching accessibility root was found.",
            "root": None,
            "nodeCount": 0,
            "truncated": False,
            "redacted": False
        })
    elif mode == "find":
        emit({
            "supported": True,
            "backend": "atspi",
            "reason": "No matching accessibility root was found.",
            "candidates": []
        })
    else:
        emit({
            "supported": True,
            "backend": "atspi",
            "matched": False,
            "ambiguous": False,
            "reason": "No matching accessibility root was found.",
            "redacted": False
        })
    raise SystemExit(0)

node_count = 0
truncated = False
redacted = False
candidates = []
matches = []
window_id_warning = "AT-SPI windowId correlation is unavailable with the current safe backend." if window_id_filter else None

def visit(node, depth, root_index, path_parts, app_name_ctx, window_title_ctx):
    global node_count, truncated, redacted
    if node_count >= max_nodes:
        truncated = True
        return None

    node_count += 1
    sensitive, hidden = state_flags(node)
    role = role_name(node)
    name = safe_name(node)
    description = safe_description(node)
    text = safe_text(node, include_text, sensitive, hidden)
    bounds = safe_bounds(node)
    pid = safe_pid(node)
    node_id = f"{pid or root_index}:{'/'.join(path_parts)}"
    current_window_title = window_title_ctx

    if role in WINDOW_ROLES and name:
        current_window_title = name

    if sensitive or hidden:
        redacted = True

    query_match = False
    exact_match = False
    role_match = role_hint == role if role_hint else True
    if query:
      haystacks = [normalize(name), normalize(description), normalize(text)]
      query_match = any(query in haystack for haystack in haystacks if haystack)
      exact_match = any(query == haystack for haystack in haystacks if haystack)

    matched = False
    if element_id_filter is not None:
        matched = node_id == element_id_filter
    elif query:
        if require_exact:
            matched = exact_match and role_match
        else:
            matched = role_match and query_match
    elif role_hint:
        matched = role_match

    if matched and mode in {"inspect", "invoke_action", "set_value", "focus_element"}:
        matches.append({
            "node": node,
            "element": build_element(node, node_id, app_name_ctx, current_window_title, pid, sensitive, hidden),
            "confidence": candidate_confidence(query_match, role_match, exact_match)
        })

    if mode == "find":
        if (query and query_match) or (role_hint and role_match):
            candidates.append({
                "id": node_id,
                "role": role,
                "name": name,
                "text": None if sensitive or hidden else text,
                "bounds": bounds,
                "confidence": candidate_confidence(query_match, role_match, exact_match),
                "reason": "Matched accessibility query." if query else "Matched accessibility role.",
                "sensitive": sensitive,
                "hidden": hidden
            })

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

            child_node = visit(
                child,
                depth + 1,
                root_index,
                path_parts + [str(child_index)],
                app_name_ctx,
                current_window_title
            )
            if child_node is not None:
                children.append(child_node)
    else:
        try:
            if node.childCount > 0:
                truncated = True
        except Exception:
            pass

    if mode == "find" or mode in {"inspect", "invoke_action", "set_value", "focus_element"}:
        return None

    result = {
        "id": node_id,
        "role": role,
        "name": name,
        "text": None if sensitive or hidden else text,
        "description": None if sensitive or hidden else description,
        "bounds": bounds,
        "sensitive": sensitive,
        "hidden": hidden
    }

    if children:
        result["children"] = children

    return result

if mode == "tree":
    root_index, root = roots[0]
    root_node = visit(root, 0, root_index, [str(root_index)], safe_name(root) or app_name_filter, None)
    emit({
        "supported": True,
        "backend": "atspi",
        "reason": "Read accessibility data through AT-SPI.",
        "root": root_node,
        "nodeCount": node_count,
        "truncated": truncated,
        "redacted": redacted
    })
    raise SystemExit(0)

for root_index, root in roots:
    app_name_ctx = safe_name(root) or app_name_filter
    visit(root, 0, root_index, [str(root_index)], app_name_ctx, None)
    if mode == "find" and len(candidates) >= limit:
        break
    if mode in {"inspect", "invoke_action", "set_value", "focus_element"} and len(matches) > 1:
        break
    if node_count >= max_nodes:
        break

if mode == "find":
    emit({
        "supported": True,
        "backend": "atspi",
        "reason": "Found accessibility element candidates through AT-SPI.",
        "candidates": candidates[:limit]
    })
    raise SystemExit(0)

if len(matches) == 0:
    emit({
        "supported": True,
        "backend": "atspi",
        "matched": False,
        "ambiguous": False,
        "redacted": redacted,
        "reason": window_id_warning or "No accessibility element matched the requested identity."
    })
    raise SystemExit(0)

if len(matches) > 1:
    emit({
        "supported": True,
        "backend": "atspi",
        "matched": False,
        "ambiguous": True,
        "redacted": redacted,
        "reason": "The requested accessibility target matched multiple elements."
    })
    raise SystemExit(0)

match = matches[0]
node = match["node"]
element = match["element"]

if mode == "inspect":
    emit({
        "supported": True,
        "backend": "atspi",
        "matched": True,
        "ambiguous": False,
        "redacted": redacted,
        "reason": window_id_warning or "Resolved one accessibility element through AT-SPI.",
        "element": element
    })
    raise SystemExit(0)

if element.get("hidden") or element.get("sensitive"):
    emit({
        "supported": True,
        "backend": "atspi",
        "matched": True,
        "ambiguous": False,
        "redacted": True,
        "performed": False,
        "changed": False,
        "focused": False,
        "reason": "Sensitive or hidden accessibility targets cannot be changed.",
        "element": element,
        "actionName": action_name if action_name else None
    })
    raise SystemExit(0)

if mode == "invoke_action":
    try:
        action_iface = node.queryAction()
    except Exception:
        emit({
            "supported": True,
            "backend": "atspi",
            "matched": True,
            "ambiguous": False,
            "performed": False,
            "redacted": redacted,
            "reason": "The resolved element does not expose AT-SPI actions.",
            "element": element,
            "actionName": action_name
        })
        raise SystemExit(0)

    action_index = None
    for index in range(getattr(action_iface, "nActions", 0)):
        try:
            if normalize(action_iface.getName(index)) == action_name:
                action_index = index
                break
        except Exception:
            continue

    if action_index is None:
        emit({
            "supported": True,
            "backend": "atspi",
            "matched": True,
            "ambiguous": False,
            "performed": False,
            "redacted": redacted,
            "reason": "The resolved element does not support the requested action.",
            "element": element,
            "actionName": action_name
        })
        raise SystemExit(0)

    try:
        performed = bool(action_iface.doAction(action_index))
    except Exception:
        performed = False

    emit({
        "supported": True,
        "backend": "atspi",
        "matched": True,
        "ambiguous": False,
        "performed": performed,
        "redacted": redacted,
        "reason": "Invoked the requested accessibility action." if performed else "The accessibility action did not complete successfully.",
        "element": element,
        "actionName": action_name
    })
    raise SystemExit(0)

if mode == "set_value":
    changed = False
    reason = "The resolved element does not expose a settable accessibility value."

    try:
        editable_text = node.queryEditableText()
        editable_text.setTextContents(str(value_input))
        changed = True
        reason = "Set the accessibility text value."
    except Exception:
        try:
            value_iface = node.queryValue()
            numeric_value = float(value_input)
            try:
                changed = bool(value_iface.setCurrentValue(numeric_value))
            except Exception:
                try:
                    value_iface.currentValue = numeric_value
                    changed = True
                except Exception:
                    changed = False
            reason = "Set the accessibility numeric value." if changed else "The accessibility value backend did not complete successfully."
        except Exception:
            changed = False

    emit({
        "supported": True,
        "backend": "atspi",
        "matched": True,
        "ambiguous": False,
        "changed": changed,
        "redacted": True,
        "reason": reason,
        "element": element
    })
    raise SystemExit(0)

if mode == "focus_element":
    focused = False
    reason = "The resolved element cannot be focused through AT-SPI."

    try:
        component = node.queryComponent()
        focused = bool(component.grabFocus())
        reason = "Focused the accessibility element." if focused else "The accessibility focus backend did not complete successfully."
    except Exception:
        focused = False

    emit({
        "supported": True,
        "backend": "atspi",
        "matched": True,
        "ambiguous": False,
        "focused": focused,
        "redacted": redacted,
        "reason": reason,
        "element": element
    })
    raise SystemExit(0)
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

function truncateString(value: string, limit: number): string {
  return value.length > limit ? `${value.slice(0, limit)}...` : value;
}

function normalizeAccessibilityString(value: unknown, limit = 300): string | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }

  const redacted = redactSensitiveText(String(value)).trim();
  return redacted.length > 0 ? truncateString(redacted, limit) : undefined;
}

function normalizeAccessibilityStringOrFallback(value: unknown, fallback: string, limit = 300): string {
  return normalizeAccessibilityString(value, limit) ?? fallback;
}

function redactNode(node: RawAccessibilityNode | undefined): AccessibilityTreeNode | undefined {
  if (node === undefined) {
    return undefined;
  }

  const result: AccessibilityTreeNode = {
    id: node.id,
    role: node.role
  };

  const name = normalizeAccessibilityString(node.name);
  const description = normalizeAccessibilityString(node.description);
  const text = node.sensitive || node.hidden ? undefined : normalizeAccessibilityString(node.text, 200);

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
    role: normalizeAccessibilityStringOrFallback(candidate.role, "unknown", 100),
    confidence: candidate.confidence,
    reason: normalizeAccessibilityStringOrFallback(candidate.reason, "Matched accessibility query.", 200)
  };
  const name = normalizeAccessibilityString(candidate.name);
  const text = candidate.sensitive || candidate.hidden ? undefined : normalizeAccessibilityString(candidate.text, 200);

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

function classifyElementSensitivity(element: RawAccessibilityElement): DataSensitivity {
  if (element.hidden === true || element.sensitive === true) {
    return "secret";
  }

  if (element.valueMetadata !== undefined) {
    return "low";
  }

  return "none";
}

function redactValueMetadata(
  valueMetadata: RawAccessibilityValueMetadata | null | undefined,
  dataSensitivity: DataSensitivity
): AccessibilityValueMetadata | undefined {
  if (valueMetadata === undefined || valueMetadata === null) {
    return undefined;
  }

  const result: AccessibilityValueMetadata = {
    supportsText: valueMetadata.supportsText,
    supportsValue: valueMetadata.supportsValue,
    editable: valueMetadata.editable,
    readOnly: valueMetadata.readOnly
  };

  if (dataSensitivity !== "secret") {
    if (valueMetadata.textLength !== undefined) {
      result.textLength = valueMetadata.textLength;
    }

    if (valueMetadata.minimum !== undefined) {
      result.minimum = valueMetadata.minimum;
    }

    if (valueMetadata.maximum !== undefined) {
      result.maximum = valueMetadata.maximum;
    }

    if (valueMetadata.step !== undefined) {
      result.step = valueMetadata.step;
    }
  }

  return result;
}

function redactElement(element: RawAccessibilityElement | undefined): AccessibilityElementDetails | undefined {
  if (element === undefined) {
    return undefined;
  }

  const dataSensitivity = classifyElementSensitivity(element);
  const result: AccessibilityElementDetails = {
    elementId: element.id,
    role: normalizeAccessibilityStringOrFallback(element.role, "unknown", 100),
    states: (element.states ?? []).map((state) => truncateString(state, 100)).slice(0, 20),
    availableActions: (element.availableActions ?? []).map((action) => truncateString(action, 100)).slice(0, 20),
    dataSensitivity
  };

  const name = normalizeAccessibilityString(element.name);
  const description = dataSensitivity === "secret" ? undefined : normalizeAccessibilityString(element.description);
  const appName = normalizeAccessibilityString(element.appName, 120);
  const windowId = normalizeAccessibilityString(element.windowId, 120);
  const windowTitle = normalizeAccessibilityString(element.windowTitle, 160);

  if (name !== undefined) {
    result.name = name;
  }

  if (description !== undefined) {
    result.description = description;
  }

  if (element.bounds !== undefined) {
    result.bounds = element.bounds;
  }

  const valueMetadata = redactValueMetadata(element.valueMetadata, dataSensitivity);

  if (valueMetadata !== undefined) {
    result.valueMetadata = valueMetadata;
  }

  if (appName !== undefined) {
    result.appName = appName;
    const appSensitivity: AppSensitivity = classifyAppSensitivity({ appName });
    result.appSensitivity = appSensitivity;
  }

  if (windowId !== undefined) {
    result.windowId = windowId;
  }

  if (windowTitle !== undefined) {
    result.windowTitle = windowTitle;
  }

  if (element.pid !== undefined) {
    result.pid = element.pid;
  }

  if (element.hidden === true) {
    result.hidden = true;
  }

  return result;
}

async function pythonAccessibilityResult(
  payload: Record<string, unknown>,
  context: LinuxAccessibilityContext = {}
): Promise<AccessibilityBackendResult> {
  if (context.runAccessibilityQuery !== undefined) {
    return context.runAccessibilityQuery(payload);
  }

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
    return JSON.parse(result.stdout) as AccessibilityBackendResult;
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
      ...(input.appName === undefined ? {} : { appName: input.appName }),
      ...(input.windowId === undefined ? {} : { windowId: input.windowId }),
      ...(input.pid === undefined ? {} : { pid: input.pid }),
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
      ...(input.appName === undefined ? {} : { appName: input.appName }),
      ...(input.windowId === undefined ? {} : { windowId: input.windowId }),
      ...(input.pid === undefined ? {} : { pid: input.pid }),
      query: input.query,
      ...(input.role === undefined ? {} : { role: input.role }),
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

function unsupportedInspectResult(backend: string, reason: string): AccessibilityInspectElementResult {
  return {
    supported: false,
    backend,
    matched: false,
    ambiguous: false,
    redacted: false,
    reason
  };
}

function unsupportedInvokeResult(backend: string, reason: string, actionName?: string): AccessibilityInvokeActionResult {
  const result: AccessibilityInvokeActionResult = {
    supported: false,
    backend,
    matched: false,
    ambiguous: false,
    performed: false,
    redacted: false,
    reason
  };

  if (actionName !== undefined) {
    result.actionName = actionName;
  }

  return result;
}

function unsupportedSetValueResult(backend: string, reason: string): AccessibilitySetValueResult {
  return {
    supported: false,
    backend,
    matched: false,
    ambiguous: false,
    changed: false,
    redacted: true,
    redactedValue: true,
    reason
  };
}

function unsupportedFocusResult(backend: string, reason: string): AccessibilityFocusElementResult {
  return {
    supported: false,
    backend,
    matched: false,
    ambiguous: false,
    focused: false,
    redacted: false,
    reason
  };
}

export async function inspectLinuxAccessibilityElement(
  input: LinuxAccessibilityInspectElementInput,
  context: LinuxAccessibilityContext = {}
): Promise<AccessibilityInspectElementResult> {
  const session = sessionInfo(context);

  if (!session.displayAvailable) {
    return unsupportedInspectResult("unavailable", "No Linux desktop display session is available.");
  }

  const result = await pythonAccessibilityResult(
    {
      mode: "inspect",
      ...(input.appName === undefined ? {} : { appName: input.appName }),
      ...(input.windowId === undefined ? {} : { windowId: input.windowId }),
      ...(input.pid === undefined ? {} : { pid: input.pid }),
      ...(input.elementId === undefined ? {} : { elementId: input.elementId }),
      ...(input.query === undefined ? {} : { query: input.query }),
      ...(input.role === undefined ? {} : { role: input.role }),
      maxDepth: 6,
      maxNodes: 1000,
      includeText: true
    },
    context
  );

  if (!result.supported) {
    return unsupportedInspectResult(result.backend, result.reason);
  }

  const inspectResult: AccessibilityInspectElementResult = {
    supported: true,
    backend: result.backend,
    matched: result.matched ?? false,
    ambiguous: result.ambiguous ?? false,
    redacted: result.redacted ?? false,
    reason: result.reason
  };

  const element = redactElement(result.element);

  if (element !== undefined) {
    inspectResult.element = element;
  }

  return inspectResult;
}

export async function invokeLinuxAccessibilityAction(
  input: LinuxAccessibilityInvokeActionInput,
  context: LinuxAccessibilityContext = {}
): Promise<AccessibilityInvokeActionResult> {
  const session = sessionInfo(context);

  if (!session.displayAvailable) {
    return unsupportedInvokeResult("unavailable", "No Linux desktop display session is available.", input.actionName);
  }

  const result = await pythonAccessibilityResult(
    {
      mode: "invoke_action",
      ...(input.appName === undefined ? {} : { appName: input.appName }),
      ...(input.windowId === undefined ? {} : { windowId: input.windowId }),
      ...(input.pid === undefined ? {} : { pid: input.pid }),
      ...(input.elementId === undefined ? {} : { elementId: input.elementId }),
      ...(input.query === undefined ? {} : { query: input.query }),
      ...(input.role === undefined ? {} : { role: input.role }),
      actionName: input.actionName,
      requireExactMatch: input.requireExactMatch ?? false,
      maxDepth: 6,
      maxNodes: 1000,
      includeText: true
    },
    context
  );

  if (!result.supported) {
    return unsupportedInvokeResult(result.backend, result.reason, input.actionName);
  }

  const actionResult: AccessibilityInvokeActionResult = {
    supported: true,
    backend: result.backend,
    matched: result.matched ?? false,
    ambiguous: result.ambiguous ?? false,
    performed: result.performed ?? false,
    redacted: result.redacted ?? false,
    reason: result.reason
  };

  if (result.actionName !== undefined) {
    actionResult.actionName = result.actionName;
  } else {
    actionResult.actionName = input.actionName;
  }

  const target = redactElement(result.element);

  if (target !== undefined) {
    actionResult.target = target;
  }

  return actionResult;
}

export async function setLinuxAccessibilityValue(
  input: LinuxAccessibilitySetValueInput,
  context: LinuxAccessibilityContext = {}
): Promise<AccessibilitySetValueResult> {
  const session = sessionInfo(context);

  if (!session.displayAvailable) {
    return unsupportedSetValueResult("unavailable", "No Linux desktop display session is available.");
  }

  const result = await pythonAccessibilityResult(
    {
      mode: "set_value",
      ...(input.appName === undefined ? {} : { appName: input.appName }),
      ...(input.windowId === undefined ? {} : { windowId: input.windowId }),
      ...(input.pid === undefined ? {} : { pid: input.pid }),
      ...(input.elementId === undefined ? {} : { elementId: input.elementId }),
      ...(input.query === undefined ? {} : { query: input.query }),
      ...(input.role === undefined ? {} : { role: input.role }),
      value: input.value,
      maxDepth: 6,
      maxNodes: 1000,
      includeText: false
    },
    context
  );

  if (!result.supported) {
    return unsupportedSetValueResult(result.backend, result.reason);
  }

  const setResult: AccessibilitySetValueResult = {
    supported: true,
    backend: result.backend,
    matched: result.matched ?? false,
    ambiguous: result.ambiguous ?? false,
    changed: result.changed ?? false,
    redacted: true,
    redactedValue: true,
    reason: result.reason
  };

  const target = redactElement(result.element);

  if (target !== undefined) {
    setResult.target = target;
  }

  return setResult;
}

export async function focusLinuxAccessibilityElement(
  input: LinuxAccessibilityFocusElementInput,
  context: LinuxAccessibilityContext = {}
): Promise<AccessibilityFocusElementResult> {
  const session = sessionInfo(context);

  if (!session.displayAvailable) {
    return unsupportedFocusResult("unavailable", "No Linux desktop display session is available.");
  }

  const result = await pythonAccessibilityResult(
    {
      mode: "focus_element",
      ...(input.appName === undefined ? {} : { appName: input.appName }),
      ...(input.windowId === undefined ? {} : { windowId: input.windowId }),
      ...(input.pid === undefined ? {} : { pid: input.pid }),
      ...(input.elementId === undefined ? {} : { elementId: input.elementId }),
      ...(input.query === undefined ? {} : { query: input.query }),
      ...(input.role === undefined ? {} : { role: input.role }),
      maxDepth: 6,
      maxNodes: 1000,
      includeText: false
    },
    context
  );

  if (!result.supported) {
    return unsupportedFocusResult(result.backend, result.reason);
  }

  const focusResult: AccessibilityFocusElementResult = {
    supported: true,
    backend: result.backend,
    matched: result.matched ?? false,
    ambiguous: result.ambiguous ?? false,
    focused: result.focused ?? false,
    redacted: result.redacted ?? false,
    reason: result.reason
  };

  const target = redactElement(result.element);

  if (target !== undefined) {
    focusResult.target = target;
  }

  return focusResult;
}
