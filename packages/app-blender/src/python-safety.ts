const BANNED_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\bimport\s+os\b/, reason: "Operating-system imports are not allowed." },
  { pattern: /\bfrom\s+os\s+import\b/, reason: "Operating-system imports are not allowed." },
  { pattern: /\bsubprocess\b/, reason: "Process spawning is not allowed." },
  { pattern: /\bsocket\b/, reason: "Network access is not allowed." },
  { pattern: /\bshutil\b/, reason: "Filesystem helper imports are not allowed." },
  { pattern: /\bpathlib\b/, reason: "Pathlib is not allowed for Blender scripts." },
  { pattern: /\brequests\b/, reason: "Network requests are not allowed." },
  { pattern: /\burllib\b/, reason: "Network URL helpers are not allowed." },
  { pattern: /\btempfile\b/, reason: "Temporary-file helpers are not allowed." },
  { pattern: /\bopen\s*\(/, reason: "Direct file opening is not allowed." },
  { pattern: /\beval\s*\(/, reason: "Dynamic evaluation is not allowed." },
  { pattern: /\bexec\s*\(/, reason: "Dynamic execution is not allowed." },
  { pattern: /__import__\s*\(/, reason: "Dynamic imports are not allowed." },
  { pattern: /\bimportlib\b/, reason: "Dynamic import helpers are not allowed." },
  { pattern: /\bbpy\.ops\.wm\.open_mainfile\b/, reason: "Opening arbitrary Blender files is not allowed." },
  { pattern: /\bbpy\.ops\.wm\.save_as_mainfile\b/, reason: "Saving must use the AgentHost wrapper output path." },
  { pattern: /\bbpy\.ops\.script\b/, reason: "Script execution operators are not allowed." },
  { pattern: /["']\/[^"']+["']/, reason: "Absolute file paths are not allowed in Blender scripts." },
  { pattern: /["'][^"']*\.\.[^"']*["']/, reason: "Parent-directory traversal is not allowed." }
];

export interface BlenderPythonSafetyResult {
  ok: boolean;
  reasons: string[];
}

export function reviewBlenderPython(script: string): BlenderPythonSafetyResult {
  const reasons = BANNED_PATTERNS.filter((rule) => rule.pattern.test(script)).map((rule) => rule.reason);

  return {
    ok: reasons.length === 0,
    reasons: [...new Set(reasons)]
  };
}
