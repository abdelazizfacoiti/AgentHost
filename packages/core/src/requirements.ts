/*
 * Linux desktop packages AgentHost uses, ordered by how much an agent loses
 * without them. `requirements-linux.txt` at the repository root mirrors the
 * apt package names (kept in sync by a test) for people installing by hand.
 */

export interface LinuxDesktopRequirement {
  name: string;
  aptPackage: string;
  /** An executable on PATH, or a Python import, proves the requirement is met. */
  check: { command: string } | { pythonImport: string };
  required: boolean;
  impact: string;
}

export const LINUX_DESKTOP_REQUIREMENTS: LinuxDesktopRequirement[] = [
  { name: "xdotool", aptPackage: "xdotool", check: { command: "xdotool" }, required: true, impact: "clicks, typing, hotkeys" },
  { name: "wmctrl", aptPackage: "wmctrl", check: { command: "wmctrl" }, required: true, impact: "window list and focus" },
  { name: "python3-gi", aptPackage: "python3-gi", check: { pythonImport: "gi" }, required: true, impact: "overlay dock, cards, built-in clipboard" },
  { name: "xwininfo", aptPackage: "x11-utils", check: { command: "xwininfo" }, required: false, impact: "accurate window coordinates" },
  { name: "xprop", aptPackage: "x11-utils", check: { command: "xprop" }, required: false, impact: "dock space reservation" },
  { name: "scrot", aptPackage: "scrot", check: { command: "scrot" }, required: false, impact: "screenshots" },
  { name: "pyatspi", aptPackage: "python3-pyatspi", check: { pythonImport: "pyatspi" }, required: false, impact: "ui.* accessibility tools (read UIs as text)" },
  { name: "tesseract", aptPackage: "tesseract-ocr", check: { command: "tesseract" }, required: false, impact: "OCR (vision.find_text*)" },
  { name: "ffmpeg", aptPackage: "ffmpeg", check: { command: "ffmpeg" }, required: false, impact: "JPEG, scaled, and cropped screenshots" },
  { name: "xclip", aptPackage: "xclip", check: { command: "xclip" }, required: false, impact: "faster paste (built-in GTK fallback otherwise)" },
  { name: "notify-send", aptPackage: "libnotify-bin", check: { command: "notify-send" }, required: false, impact: "desktop notifications for approvals" }
];

export function aptPackagesFor(requirements: LinuxDesktopRequirement[]): string[] {
  return [...new Set(requirements.map((requirement) => requirement.aptPackage))];
}
