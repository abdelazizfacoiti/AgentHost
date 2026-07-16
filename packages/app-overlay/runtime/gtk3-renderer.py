#!/usr/bin/env python3
"""Fixed GTK3 overlay renderer. JSONL stdio only; never executes target-app actions."""
import cairo
import hashlib
import hmac
import json
import math
import os
import sys
import time
import uuid

try:
    import gi
    gi.require_version("Gtk", "3.0")
    gi.require_version("Gdk", "3.0")
    from gi.repository import Gdk, GLib, Gtk
except Exception as exc:
    print("gtk3_unavailable", file=sys.stderr)
    raise SystemExit(78) from exc

VERSION = 1
MAX_BYTES = 256 * 1024
COMMANDS = {"hello", "capabilities", "show", "update", "dismiss", "clear", "emergency_hide", "state", "close"}
EVENTS = {"accepted", "rejected", "dismissed", "cancelled", "next", "back", "acknowledgement_checked", "emergency_stop_requested"}


def now_iso():
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def safe_text(value, limit=500):
    if not isinstance(value, str):
        return ""
    return " ".join(value.split())[:limit]


def color_for(style, alpha=1.0):
    semantic = (style or {}).get("semantic", "neutral") if isinstance(style, dict) else "neutral"
    colors = {
        "neutral": (0.18, 0.22, 0.29),
        "info": (0.08, 0.35, 0.72),
        "success": (0.08, 0.48, 0.25),
        "warning": (0.68, 0.39, 0.02),
        "danger": (0.70, 0.08, 0.08),
    }
    r, g, b = colors.get(semantic, colors["neutral"])
    return r, g, b, alpha


def rounded_rect(cr, x, y, width, height, radius):
    radius = max(0.0, min(radius, min(width, height) / 2.0))
    cr.new_sub_path()
    cr.arc(x + width - radius, y + radius, radius, -math.pi / 2, 0)
    cr.arc(x + width - radius, y + height - radius, radius, 0, math.pi / 2)
    cr.arc(x + radius, y + height - radius, radius, math.pi / 2, math.pi)
    cr.arc(x + radius, y + radius, radius, math.pi, 3 * math.pi / 2)
    cr.close_path()


def draw_text(cr, text, x, y, size=16, color=(1, 1, 1, 1), max_width=520):
    cr.set_source_rgba(*color)
    cr.select_font_face("Sans", cairo.FONT_SLANT_NORMAL, cairo.FONT_WEIGHT_NORMAL)
    cr.set_font_size(size)
    words = safe_text(text).split(" ")
    line = ""
    line_y = y
    for word in words:
        candidate = word if not line else line + " " + word
        if cr.text_extents(candidate).width > max_width and line:
            cr.move_to(x, line_y)
            cr.show_text(line)
            line = word
            line_y += size * 1.35
        else:
            line = candidate
    if line:
        cr.move_to(x, line_y)
        cr.show_text(line)
    return line_y + size * 1.35


class Renderer:
    def __init__(self):
        self.token = None
        self.session_id = "renderer"
        self.windows = []
        self.interactive = {}
        self.records = {}
        self.events = []
        self.emergency_hidden = False
        self.monitor_signature = None
        self.renderer_epoch = 0
        self.tick_source = GLib.timeout_add(33, self.tick)

    def capability(self):
        display = Gdk.Display.get_default()
        count = display.get_n_monitors() if display is not None else 0
        return {
            "supported": display is not None,
            "renderer": "gtk3-x11",
            "rendererStatus": "available" if display is not None else "unavailable",
            "sessionType": "x11",
            "displayAvailable": display is not None,
            "clickThrough": True,
            "interactiveWidgets": True,
            "multipleDisplays": count > 1,
            "globalOverlayAvailable": display is not None,
            "clickThroughAvailable": display is not None,
            "multiDisplayAvailable": count > 0,
            "animationAvailable": True,
            "interactiveWidgetsAvailable": True,
            "reason": "GTK3 X11 renderer ready." if display is not None else "GTK3 display unavailable.",
            "limitations": ["Compositor and window-manager z-order behavior may vary."],
        }

    def monitor_geometries(self):
        display = Gdk.Display.get_default()
        if display is None:
            return []
        result = []
        for index in range(display.get_n_monitors()):
            monitor = display.get_monitor(index)
            geometry = monitor.get_geometry()
            result.append((geometry.x, geometry.y, geometry.width, geometry.height, monitor.get_scale_factor()))
        return result

    def destroy_windows(self):
        for window in self.windows:
            window.destroy()
        self.windows = []
        for window in list(self.interactive.values()):
            window.destroy()
        self.interactive = {}

    def rebuild(self):
        self.destroy_windows()
        geometries = self.monitor_geometries()
        signature = tuple(geometries)
        self.monitor_signature = signature
        for geometry in geometries:
            window = Gtk.Window(type=Gtk.WindowType.POPUP)
            window.set_decorated(False)
            window.set_keep_above(True)
            window.set_skip_taskbar_hint(True)
            window.set_accept_focus(False)
            window.set_focus_on_map(False)
            window.set_app_paintable(True)
            screen = window.get_screen()
            visual = screen.get_rgba_visual() if screen is not None else None
            if visual is not None:
                window.set_visual(visual)
            area = Gtk.DrawingArea()
            area.connect("draw", self.draw_surface, geometry)
            window.add(area)
            window.move(geometry[0], geometry[1])
            window.set_default_size(geometry[2], geometry[3])
            window.show_all()
            gdk_window = window.get_window()
            if gdk_window is not None:
                try:
                    gdk_window.input_shape_combine_region(cairo.Region(), 0, 0)
                except Exception:
                    pass
            self.windows.append(window)
        for record in self.records.values():
            if self.is_interactive(record):
                self.create_interactive(record)

    def visibility_counts(self):
        for _index in range(8):
            while Gtk.events_pending():
                Gtk.main_iteration_do(False)
        visible = 0
        for window in self.windows:
            gdk_window = window.get_window()
            if gdk_window is not None and (not hasattr(gdk_window, "get_mapped") or gdk_window.get_mapped()):
                visible += 1
        interactive = 0
        for window in self.interactive.values():
            gdk_window = window.get_window()
            if gdk_window is not None and (not hasattr(gdk_window, "get_mapped") or gdk_window.get_mapped()):
                interactive += 1
        return visible, interactive

    def operation_ack(self, command, acknowledgement, overlay_id=None, reason=None):
        visible, interactive = self.visibility_counts()
        return {
            "command": command,
            "acknowledgement": acknowledgement,
            "rendererEpoch": self.renderer_epoch,
            "visibleWindowCount": visible,
            "interactiveWindowCount": interactive,
            **({"overlayId": overlay_id} if overlay_id is not None else {}),
            **({"reason": reason} if reason is not None else {}),
        }

    def is_interactive(self, record):
        payload = record.get("payload") if isinstance(record, dict) else {}
        interaction = payload.get("interaction") if isinstance(payload, dict) else {}
        return isinstance(interaction, dict) and interaction.get("interactive") is True

    def target_bounds(self, record):
        payload = record.get("payload") if isinstance(record, dict) else {}
        target = payload.get("target") if isinstance(payload, dict) else {}
        bounds = target.get("bounds") if isinstance(target, dict) else None
        if isinstance(bounds, dict):
            try:
                return float(bounds.get("x", 0)), float(bounds.get("y", 0)), float(bounds.get("width", 1)), float(bounds.get("height", 1))
            except Exception:
                return 0, 0, 1, 1
        point = target.get("point") if isinstance(target, dict) else None
        if isinstance(point, dict):
            return float(point.get("x", 0)) - 24, float(point.get("y", 0)) - 24, 48, 48
        return 100, 100, 360, 180

    def create_interactive(self, record):
        bounds = self.target_bounds(record)
        x, y, width, height = bounds
        width = min(max(width, 180), 640)
        height = min(max(height, 80), 420)
        window = Gtk.Window(type=Gtk.WindowType.POPUP)
        window.set_decorated(False)
        window.set_keep_above(True)
        window.set_skip_taskbar_hint(True)
        interaction = (record.get("payload") or {}).get("interaction", {})
        focus_required = isinstance(interaction, dict) and interaction.get("focus") == "when_required"
        window.set_accept_focus(focus_required)
        window.set_focus_on_map(focus_required)
        area = Gtk.DrawingArea()
        area.set_can_focus(focus_required)
        area.add_events(Gdk.EventMask.BUTTON_RELEASE_MASK | Gdk.EventMask.KEY_PRESS_MASK)
        area.connect("draw", self.draw_interactive, record)
        area.connect("button-release-event", self.interactive_click, record)
        area.connect("key-press-event", self.interactive_key, record)
        window.add(area)
        window.move(int(x), int(y))
        window.set_default_size(int(width), int(height))
        window.show_all()
        self.interactive[record.get("overlayId")] = window

    def draw_surface(self, _area, cr, geometry):
        cr.set_operator(cairo.OPERATOR_SOURCE)
        cr.set_source_rgba(0, 0, 0, 0)
        cr.paint()
        cr.set_operator(cairo.OPERATOR_OVER)
        ox, oy = geometry[0], geometry[1]
        for record in list(self.records.values()):
            if not self.is_interactive(record):
                self.draw_record(cr, record, ox, oy)
        return False

    def draw_interactive(self, _area, cr, record):
        allocation = _area.get_allocation()
        cr.set_source_rgba(0.05, 0.07, 0.11, 0.96)
        rounded_rect(cr, 0, 0, allocation.width, allocation.height, 12)
        cr.fill()
        self.draw_payload(cr, record.get("payload") or {}, 0, 0, allocation.width, allocation.height)
        return False

    def draw_record(self, cr, record, ox, oy):
        payload = record.get("payload") or {}
        target = payload.get("target") if isinstance(payload, dict) else {}
        bounds = target.get("bounds") if isinstance(target, dict) else None
        point = target.get("point") if isinstance(target, dict) else None
        if isinstance(bounds, dict):
            try:
                x, y, width, height = float(bounds.get("x", 0)) - ox, float(bounds.get("y", 0)) - oy, float(bounds.get("width", 1)), float(bounds.get("height", 1))
            except Exception:
                x, y, width, height = 20, 20, 40, 40
        elif isinstance(point, dict):
            x, y, width, height = float(point.get("x", 0)) - ox, float(point.get("y", 0)) - oy, 48, 48
        else:
            x, y, width, height = 20, 20, 360, 160
        self.draw_payload(cr, payload, x, y, width, height)

    def draw_payload(self, cr, payload, x, y, width, height):
        if not isinstance(payload, dict):
            return
        kind = payload.get("type", "widget")
        style = payload.get("style") if isinstance(payload.get("style"), dict) else {}
        color = color_for(style, 0.88)
        if kind in {"highlight", "spotlight"}:
            cr.set_source_rgba(*color)
            cr.set_line_width(3)
            rounded_rect(cr, x, y, width, height, 10)
            cr.stroke()
            return
        if kind in {"pointer", "arrow"}:
            cx, cy = x + width / 2, y + height / 2
            cr.set_source_rgba(*color)
            cr.move_to(cx, cy - 22)
            cr.line_to(cx - 12, cy + 20)
            cr.line_to(cx + 2, cy + 12)
            cr.line_to(cx + 14, cy + 24)
            cr.close_path()
            cr.fill()
            return
        if kind == "progress":
            value = payload.get("progress", payload.get("value", 0.0))
            try:
                value = max(0.0, min(1.0, float(value)))
            except Exception:
                value = 0.0
            cr.set_source_rgba(0.08, 0.09, 0.12, 0.85)
            rounded_rect(cr, x, y, max(width, 180), 18, 8)
            cr.fill()
            cr.set_source_rgba(*color_for(style, 0.95))
            rounded_rect(cr, x, y, max(width, 180) * value, 18, 8)
            cr.fill()
            return
        self.draw_card(cr, payload, x, y, width, height, color)

    def draw_card(self, cr, payload, x, y, width, height, color):
        width = max(width, 260)
        height = max(height, 84)
        cr.set_source_rgba(0.04, 0.05, 0.08, 0.94)
        rounded_rect(cr, x, y, width, height, 12)
        cr.fill()
        cr.set_source_rgba(*color)
        cr.set_line_width(2)
        rounded_rect(cr, x, y, width, height, 12)
        cr.stroke()
        title = payload.get("label") or payload.get("title") or payload.get("text") or payload.get("type", "overlay")
        draw_text(cr, title, x + 16, y + 28, 16, (0.96, 0.97, 1, 1), width - 32)
        components = payload.get("components")
        if isinstance(components, list):
            line_y = y + 52
            for component in components[:12]:
                if not isinstance(component, dict):
                    continue
                text = component.get("text") or component.get("label") or component.get("key")
                if isinstance(text, str):
                    line_y = draw_text(cr, text, x + 16, line_y, 13, (0.82, 0.85, 0.9, 1), width - 32)
                    if line_y > y + height - 12:
                        break
        elif isinstance(payload.get("text"), str):
            draw_text(cr, payload["text"], x + 16, y + 52, 13, (0.82, 0.85, 0.9, 1), width - 32)

    def interactive_click(self, _widget, _event, record):
        event = self.first_event(record)
        if event is not None:
            self.events.append({"eventId": "event_" + uuid.uuid4().hex, "overlayId": record.get("overlayId"), "event": event, "createdAt": now_iso(), "ownerSessionId": self.session_id})
            self.events = self.events[-100:]
        return False

    def interactive_key(self, _widget, event, record):
        if event.keyval == Gdk.KEY_Escape:
            self.events.append({"eventId": "event_" + uuid.uuid4().hex, "overlayId": record.get("overlayId"), "event": "dismissed", "createdAt": now_iso(), "ownerSessionId": self.session_id})
            self.events = self.events[-100:]
            return True
        return False

    def first_event(self, record):
        payload = record.get("payload") or {}
        for component in payload.get("components", []) if isinstance(payload, dict) else []:
            if isinstance(component, dict) and component.get("event") in EVENTS:
                return component.get("event")
        return "accepted"

    def tick(self):
        if Gtk.main_level() <= 0:
            return False
        signature = tuple(self.monitor_geometries())
        if signature != self.monitor_signature:
            self.rebuild()
        for window in self.windows:
            child = window.get_child()
            if child is not None:
                child.queue_draw()
        for window in self.interactive.values():
            child = window.get_child()
            if child is not None:
                child.queue_draw()
        return True

    def show(self, record):
        if not isinstance(record, dict) or not isinstance(record.get("overlayId"), str) or not isinstance(record.get("payload"), dict):
            return {"ok": False, "reason": "render_record_invalid"}
        encoded = json.dumps(record, separators=(",", ":"))
        if len(encoded.encode("utf-8")) > MAX_BYTES:
            return {"ok": False, "reason": "render_record_oversized"}
        self.records[record["overlayId"]] = record
        self.emergency_hidden = False
        self.rebuild()
        visible, _interactive = self.visibility_counts()
        if visible <= 0:
            self.records.pop(record["overlayId"], None)
            self.rebuild()
            return {"ok": False, "reason": "overlay_live_registration_missing"}
        return {"ok": True, **self.operation_ack("show", "visible", record["overlayId"], "gtk3_overlay_shown")}

    def update(self, record):
        if not isinstance(record, dict) or record.get("overlayId") not in self.records:
            return {"ok": False, "reason": "overlay_not_found"}
        result = self.show(record)
        if result.get("ok"):
            result["command"] = "update"
            result["acknowledgement"] = "updated"
        return result

    def dismiss(self, overlay_id):
        self.records.pop(overlay_id, None)
        window = self.interactive.pop(overlay_id, None)
        if window is not None:
            window.destroy()
        self.rebuild()
        return {"ok": True, **self.operation_ack("dismiss", "dismissed", overlay_id, "gtk3_overlay_dismissed")}

    def clear(self):
        self.records.clear()
        self.rebuild()
        return {"ok": True, **self.operation_ack("clear", "cleared", reason="gtk3_overlays_cleared")}

    def emergency_hide(self):
        self.records.clear()
        self.emergency_hidden = True
        self.rebuild()
        return {"ok": True, **self.operation_ack("emergency_hide", "emergency_hidden", reason="gtk3_emergency_hide_complete")}

    def state(self):
        return {"renderer": self.capability(), "overlays": [{"overlayId": key, "ownerSessionId": self.session_id, "type": value.get("type", "widget"), "sensitivity": (value.get("payload") or {}).get("sensitivity", "public"), "interactive": self.is_interactive(value), "visible": True, "createdAt": now_iso(), "updatedAt": now_iso(), "expiresAt": now_iso()} for key, value in self.records.items()], "pendingEvents": list(self.events), "emergencyHidden": self.emergency_hidden}

    def close(self):
        self.destroy_windows()
        if self.tick_source:
            GLib.source_remove(self.tick_source)
        Gtk.main_quit()


renderer = None


def reply(request_id, ok, data=None, error=None):
    value = {"version": VERSION, "id": request_id, "ok": ok}
    if data is not None:
        value["data"] = data
    if error is not None:
        value["error"] = safe_text(error, 200)
    encoded = json.dumps(value, separators=(",", ":"))
    if len(encoded.encode("utf-8")) <= MAX_BYTES:
        sys.stdout.write(encoded + "\n")
        sys.stdout.flush()


def handle(line):
    if len(line.encode("utf-8")) > MAX_BYTES:
        return
    try:
        request = json.loads(line)
    except Exception:
        return
    if not isinstance(request, dict) or any(key not in {"version", "id", "token", "command", "payload"} for key in request) or request.get("version") != VERSION or not isinstance(request.get("id"), str) or not 1 <= len(request.get("id")) <= 100 or not isinstance(request.get("token"), str) or not 32 <= len(request.get("token")) <= 200 or request.get("command") not in COMMANDS:
        if isinstance(request, dict) and isinstance(request.get("id"), str):
            reply(request["id"], False, error="renderer_request_invalid")
        return
    if renderer.token is None:
        if request["command"] != "hello":
            reply(request["id"], False, error="renderer_handshake_required")
            return
        renderer.token = request["token"]
        hello_payload = request.get("payload")
        if isinstance(hello_payload, dict) and isinstance(hello_payload.get("sessionId"), str) and 1 <= len(hello_payload["sessionId"]) <= 200:
            renderer.session_id = hello_payload["sessionId"]
    if not hmac.compare_digest(renderer.token, request["token"]):
        reply(request["id"], False, error="renderer_token_invalid")
        return
    command = request["command"]
    payload = request.get("payload")
    try:
        if command == "hello":
            hello_payload = payload if isinstance(payload, dict) else {}
            if not isinstance(hello_payload.get("rendererEpoch"), int) or hello_payload.get("rendererEpoch") < 1:
                reply(request["id"], False, error="renderer_epoch_required")
                return
            renderer.renderer_epoch = hello_payload["rendererEpoch"]
            reply(request["id"], True, {"protocolVersion": VERSION, "rendererEpoch": renderer.renderer_epoch, "capabilities": renderer.capability()})
        elif command == "capabilities":
            reply(request["id"], True, renderer.capability())
        elif command == "show":
            result = renderer.show(payload)
            reply(request["id"], bool(result.get("ok")), result if result.get("ok") else None, None if result.get("ok") else result.get("reason"))
        elif command == "update":
            result = renderer.update(payload)
            reply(request["id"], bool(result.get("ok")), result if result.get("ok") else None, None if result.get("ok") else result.get("reason"))
        elif command == "dismiss":
            result = renderer.dismiss((payload or {}).get("overlayId"))
            reply(request["id"], bool(result.get("ok")), result if result.get("ok") else None, None if result.get("ok") else result.get("reason"))
        elif command == "clear":
            result = renderer.clear()
            reply(request["id"], bool(result.get("ok")), result if result.get("ok") else None, None if result.get("ok") else result.get("reason"))
        elif command == "emergency_hide":
            result = renderer.emergency_hide()
            reply(request["id"], bool(result.get("ok")), result if result.get("ok") else None, None if result.get("ok") else result.get("reason"))
        elif command == "state":
            reply(request["id"], True, renderer.state())
        elif command == "close":
            reply(request["id"], True, {"reason": "renderer_closing"})
            renderer.close()
    except Exception:
        reply(request["id"], False, error="renderer_command_failed")


def stdin_watch(_source, condition):
    if condition & GLib.IO_HUP:
        renderer.close()
        return False
    line = sys.stdin.readline()
    if line:
        handle(line.strip())
        return True
    renderer.close()
    return False


if __name__ == "__main__":
    ok, _argv = Gtk.init_check([])
    if not ok:
        raise SystemExit(78)
    renderer = Renderer()
    GLib.io_add_watch(sys.stdin, GLib.IO_IN | GLib.IO_HUP, stdin_watch)
    Gtk.main()
