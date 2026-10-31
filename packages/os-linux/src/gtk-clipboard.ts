import { spawn } from "node:child_process";
import { findCommandPath, type LinuxLookupContext } from "./dependencies.js";

/*
 * Zero-dependency clipboard backend for hosts without xclip/xsel. The GTK
 * bindings are already required by the overlay renderer, so a short-lived
 * python3-gi helper can own the CLIPBOARD selection while xdotool pastes.
 * X11 selections only exist while their owner is alive, so the write helper
 * keeps serving until the caller closes its stdin (or a hard timeout fires).
 * The payload is length-prefixed on stdin rather than passed as an argument,
 * so typed text never appears in /proc/<pid>/cmdline.
 */
const HELPER = String.raw`
import sys
import gi
gi.require_version("Gtk", "3.0")
from gi.repository import Gtk, Gdk, GLib
clipboard = Gtk.Clipboard.get(Gdk.SELECTION_CLIPBOARD)
if sys.argv[1] == "read":
    text = clipboard.wait_for_text()
    if text is None:
        sys.exit(3)
    sys.stdout.write(text)
    sys.stdout.flush()
    sys.exit(0)
stream = sys.stdin.buffer
size = int(stream.readline().strip())
data = stream.read(size).decode("utf-8")
clipboard.set_text(data, -1)
clipboard.store()
def release(_channel, _condition):
    Gtk.main_quit()
    return False
def watch_owner():
    # Another app copying something takes the selection; there is nothing left to serve.
    clipboard.connect("owner-change", lambda *_args: Gtk.main_quit())
    return False
if sys.argv[1] == "write":
    GLib.io_add_watch(GLib.IOChannel.unix_new(stream.fileno()), GLib.IO_HUP | GLib.IO_ERR | GLib.IO_IN, release)
GLib.timeout_add(200, watch_owner)
GLib.timeout_add(int(sys.argv[2]), lambda: Gtk.main_quit() or False)
sys.stdout.write("ready\n")
sys.stdout.flush()
Gtk.main()
`;

type HelperContext = LinuxLookupContext & { env?: NodeJS.ProcessEnv };

export interface GtkClipboardLease {
  /** Ends ownership; call after the paste keystroke has been delivered. */
  release(): void;
}

export async function readGtkClipboard(context: HelperContext = {}): Promise<string | undefined> {
  const python = await findCommandPath("python3", context);
  if (python === undefined) return undefined;
  return await new Promise((resolve) => {
    const child = spawn(python, ["-I", "-c", HELPER, "read"], { env: context.env ?? process.env, stdio: ["ignore", "pipe", "ignore"] });
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => { child.kill("SIGKILL"); resolve(undefined); }, 2_000);
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.on("error", () => { clearTimeout(timer); resolve(undefined); });
    child.on("close", (code) => { clearTimeout(timer); resolve(code === 0 ? Buffer.concat(chunks).toString("utf8") : undefined); });
  });
}

/**
 * Places text on the CLIPBOARD and resolves once the helper owns the
 * selection. Ownership lasts until release() or holdMs, whichever is first.
 */
export async function leaseGtkClipboard(text: string, context: HelperContext = {}, holdMs = 4_000): Promise<GtkClipboardLease | undefined> {
  return await spawnClipboardOwner("write", text, context, holdMs);
}

/**
 * Hands text back to the clipboard and leaves a detached owner serving it, so
 * the user's prior clipboard survives a paste. The owner exits as soon as any
 * other app copies something, or after holdMs.
 */
export async function restoreGtkClipboard(text: string, context: HelperContext = {}, holdMs = 30 * 60_000): Promise<boolean> {
  const owner = await spawnClipboardOwner("hold", text, context, holdMs);
  owner?.release();
  return owner !== undefined;
}

async function spawnClipboardOwner(mode: "write" | "hold", text: string, context: HelperContext, holdMs: number): Promise<GtkClipboardLease | undefined> {
  const python = await findCommandPath("python3", context);
  if (python === undefined) return undefined;
  return await new Promise((resolve) => {
    const child = spawn(python, ["-I", "-c", HELPER, mode, String(holdMs)], { env: context.env ?? process.env, stdio: ["pipe", "pipe", "ignore"], detached: mode === "hold" });
    let settled = false;
    const timer = setTimeout(() => { child.kill("SIGKILL"); finish(undefined); }, 3_000);
    function finish(lease: GtkClipboardLease | undefined): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(lease);
    }
    child.on("error", () => finish(undefined));
    child.on("close", () => finish(undefined));
    child.stdin.on("error", () => undefined);
    child.stdout.on("data", (chunk: Buffer) => {
      if (!chunk.toString("utf8").includes("ready")) return;
      finish({
        release: () => {
          child.stdin.end();
          if (mode === "hold") {
            // A holding owner outlives this call; drop every handle so Node can exit.
            child.stdout.destroy();
            child.unref();
            return;
          }
          // Closing stdin raises HUP in a write helper, which quits its main loop.
          setTimeout(() => { if (child.exitCode === null) child.kill("SIGTERM"); }, 500).unref();
        }
      });
    });
    const payload = Buffer.from(text, "utf8");
    child.stdin.write(`${payload.length}\n`);
    child.stdin.write(payload);
  });
}
