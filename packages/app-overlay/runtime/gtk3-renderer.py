#!/usr/bin/env python3
"""Fixed GTK3 overlay renderer. JSONL stdio only; never executes target-app actions.

Cards are small native GTK windows that update in place. Fullscreen transparent
surfaces are created only for pointer/highlight primitives so ordinary cards
never intercept desktop clicks.
"""
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
    try:
        import cairo
    except Exception:
        cairo = None
    try:
        if cairo is None:
            raise ImportError("pycairo_unavailable")
        gi.require_foreign("cairo")
        CAIRO_FOREIGN_AVAILABLE = True
    except Exception:
        CAIRO_FOREIGN_AVAILABLE = False
except Exception as exc:
    print("gtk3_unavailable", file=sys.stderr)
    raise SystemExit(78) from exc

VERSION = 1
MAX_BYTES = 256 * 1024
COMMANDS = {"hello", "capabilities", "show", "update", "dismiss", "clear", "emergency_hide", "state", "events", "close"}
EVENTS = {"accepted", "rejected", "dismissed", "cancelled", "next", "back", "acknowledgement_checked", "emergency_stop_requested", "continue", "pause", "resume", "cancel", "acknowledge", "show_details", "hide", "retry_visual_render", "inspect_diagnostics", "open_control_room", "review_prepared_action", "emergency_hide", "close_control_surface"}
SURFACE_TYPES = {"pointer", "arrow", "highlight", "spotlight"}
CARD_TYPES = {"widget", "tooltip", "instruction_card", "approval_card", "warning", "progress", "checkpoint_result", "status_toast", "comparison", "cancel_control", "emergency_stop_control"}
CARD_WIDTH = 380
CARD_MARGIN = 24
MAX_CARD_HEIGHT = 620
CHECK_GLYPHS = {"done": "✓", "failed": "✕", "active": "●", "pending": "○"}
STATUS_CAIRO = {
    "neutral": (0.30, 0.36, 0.48, 0.95),
    "info": (0.11, 0.37, 0.75, 0.95),
    "success": (0.13, 0.48, 0.26, 0.95),
    "warning": (0.69, 0.38, 0.02, 0.95),
    "danger": (0.71, 0.18, 0.18, 0.95),
}
STATUS_CLASS = {"neutral": "ah-badge-neutral", "info": "ah-badge-info", "success": "ah-badge-success", "warning": "ah-badge-warning", "danger": "ah-badge-danger"}
STATUS_HEX = {
    "neutral": "#4d5a75",
    "info": "#1d5fc2",
    "success": "#1f7a42",
    "warning": "#b06205",
    "danger": "#c22f2f",
}
ICON_GLYPHS = {"info": "i", "success": "✓", "warning": "!", "danger": "×", "check": "✓", "close": "×", "pointer": "➤"}
DIM_CAIRO = (0.60, 0.64, 0.70, 1)
WARN_CAIRO = (0.95, 0.70, 0.20, 1)


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


def draw_text(cr, text, x, y, size=16, color=(1, 1, 1, 1), max_width=520, weight=cairo.FONT_WEIGHT_NORMAL):
    cr.set_source_rgba(*color)
    cr.select_font_face("Sans", cairo.FONT_SLANT_NORMAL, weight)
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


def component_rows(payload):
    if not isinstance(payload, dict):
        return []
    components = payload.get("components")
    if isinstance(components, list):
        return [c for c in components if isinstance(c, dict)][:30]
    if isinstance(payload.get("text"), str):
        return [{"type": "text", "text": payload.get("text")}]
    return []


def card_content_height(payload):
    height = 60
    for component in component_rows(payload):
        kind = component.get("type")
        if kind == "progress":
            height += 46
        elif kind == "checklist":
            items = component.get("items") if isinstance(component.get("items"), list) else []
            height += 26 + 24 * max(1, min(8, len(items)))
        elif kind in {"status_badge", "heading", "spinner"}:
            height += 32
        elif kind == "divider":
            height += 14
        else:
            height += 24
    return max(120, min(MAX_CARD_HEIGHT, height))


_XSHAPE = {"ready": None, "x11": None, "xext": None, "display": None}


def clear_x11_input_shape(gdk_window):
    try:
        xid = int(gdk_window.get_xid())
    except Exception:
        return False
    try:
        import ctypes
        import ctypes.util

        state = _XSHAPE
        if state["ready"] is None:
            x11 = ctypes.CDLL(ctypes.util.find_library("X11"))
            xext = ctypes.CDLL(ctypes.util.find_library("Xext"))
            x11.XOpenDisplay.restype = ctypes.c_void_p
            x11.XOpenDisplay.argtypes = [ctypes.c_char_p]
            x11.XFlush.argtypes = [ctypes.c_void_p]
            xext.XShapeCombineRectangles.argtypes = [
                ctypes.c_void_p,
                ctypes.c_ulong,
                ctypes.c_int,
                ctypes.c_int,
                ctypes.c_int,
                ctypes.c_void_p,
                ctypes.c_int,
                ctypes.c_int,
                ctypes.c_int,
            ]
            xext.XShapeCombineRectangles.restype = None
            display = x11.XOpenDisplay(None)
            state.update(x11=x11, xext=xext, display=display)
            state["ready"] = bool(display)
        if not state["ready"]:
            return False
        state["xext"].XShapeCombineRectangles(state["display"], xid, 2, 0, 0, None, 0, 0, 0)
        state["x11"].XFlush(state["display"])
        return True
    except Exception:
        return False


class Renderer:
    def __init__(self):
        self.token = None
        self.session_id = "renderer"
        self.cards = {}
        self.surface_windows = []
        self.surface_fixed = []
        self.records = {}
        self.events = []
        self.emergency_hidden = False
        self.monitor_signature = None
        self.draw_ready = set()
        self.renderer_epoch = 0
        self.last_render_reason = None
        self.widget_css_ready = False
        self.command_queue = []
        self.queue_scheduled = False
        self.monitor_source = GLib.timeout_add_seconds(2, self.monitor_tick)

    def capability(self):
        display = Gdk.Display.get_default()
        count = display.get_n_monitors() if display is not None else 0
        screen = Gdk.Screen.get_default() if display is not None else None
        try:
            composited = bool(screen is not None and screen.is_composited())
        except Exception:
            composited = False
        try:
            visual = screen.get_rgba_visual() if screen is not None else None
        except Exception:
            visual = None
        transparent = bool(composited and visual is not None)
        if display is None:
            reason = "GTK3 display unavailable."
            limitations = ["No supported graphical display session is available."]
        elif not composited:
            reason = "overlay_compositor_unavailable"
            limitations = ["An X11 compositor is required for transparent overlays.", "Visible mode is disabled to prevent an opaque fullscreen window from covering the desktop."]
        elif visual is None:
            reason = "overlay_transparency_unavailable"
            limitations = ["The display does not expose an RGBA visual for transparent overlays.", "Visible mode is disabled to prevent an opaque fullscreen window from covering the desktop."]
        else:
            reason = "GTK3 X11 renderer ready."
            limitations = ["Compositor and window-manager z-order behavior may vary."]
        return {
            "supported": transparent,
            "renderer": "gtk3-x11",
            "rendererStatus": "available" if transparent else "unavailable",
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
            "compositorAvailable": composited,
            "transparentWindowsAvailable": transparent,
            "drawingBackend": "cairo" if CAIRO_FOREIGN_AVAILABLE else "gtk3-widgets",
            "cairoCallbacks": CAIRO_FOREIGN_AVAILABLE,
            "reason": reason,
            "limitations": limitations + ([] if CAIRO_FOREIGN_AVAILABLE else ["PyGObject Cairo foreign bindings are unavailable; pointer primitives use GTK widgets with X11 input shaping."]),
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

    def workarea(self):
        display = Gdk.Display.get_default()
        if display is None:
            return None
        monitor = display.get_primary_monitor()
        if monitor is None:
            monitor = display.get_monitor(0)
        if monitor is None:
            return None
        try:
            return monitor.get_workarea()
        except Exception:
            return None

    def pump(self, iterations=8):
        for _index in range(iterations):
            while Gtk.events_pending():
                Gtk.main_iteration_do(False)

    def destroy_cards(self):
        for card in list(self.cards.values()):
            window = card.get("window")
            if window is not None:
                window.destroy()
        self.cards = {}

    def destroy_surfaces(self):
        for window in self.surface_windows:
            window.destroy()
        self.surface_windows = []
        self.surface_fixed = []

    def destroy_windows(self):
        self.destroy_cards()
        self.destroy_surfaces()
        self.draw_ready = set()

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

    def is_interactive(self, record):
        payload = record.get("payload") if isinstance(record, dict) else {}
        interaction = payload.get("interaction") if isinstance(payload, dict) else {}
        return isinstance(interaction, dict) and interaction.get("interactive") is True

    def allowed_events(self, record):
        payload = record.get("payload") if isinstance(record, dict) else {}
        interaction = payload.get("interaction") if isinstance(payload, dict) else {}
        values = interaction.get("allowedEvents") if isinstance(interaction, dict) else None
        return set(value for value in values if isinstance(value, str) and value in EVENTS) if isinstance(values, list) else set()

    def dismiss_event(self, record):
        payload = record.get("payload") if isinstance(record, dict) else {}
        interaction = payload.get("interaction") if isinstance(payload, dict) else {}
        if not isinstance(interaction, dict) or interaction.get("dismissible") is not True:
            return None
        allowed = self.allowed_events(record)
        if "dismissed" in allowed:
            return "dismissed"
        if "hide" in allowed:
            return "hide"
        return None

    def ensure_widget_css(self, screen):
        if self.widget_css_ready or screen is None:
            return
        provider = Gtk.CssProvider()
        provider.load_from_data(b"""
        window { background-color: rgba(0,0,0,0); }
        .ah-card { background-image: linear-gradient(145deg, rgba(24,28,39,0.98), rgba(13,16,24,0.98)); border-width: 1px; border-style: solid; border-color: rgba(126,156,210,0.30); border-radius: 16px; color: #eef2fa; }
        .ah-surface { background-color: rgba(0,0,0,0); }
        .ah-highlight { background-color: rgba(45,126,255,0.10); border-width: 3px; border-style: solid; border-color: #4d8dff; border-radius: 10px; }
        .ah-title { color: #f7f9ff; font-weight: bold; font-size: 16px; }
        .ah-subtitle { color: #aab4c8; font-size: 12px; }
        .ah-heading { color: #f2f5fc; font-weight: bold; font-size: 14px; }
        .ah-text { color: #c8d1e2; font-size: 13px; }
        .ah-dim { color: #9aa6bc; font-size: 12px; }
        .ah-key { color: #8794ac; font-size: 12px; }
        .ah-value { color: #e7ecf7; font-size: 13px; font-weight: 600; }
        .ah-warning { color: #f2c46d; font-size: 13px; }
        .ah-danger { color: #ff9b9b; font-size: 13px; }
        .ah-success { color: #7ddfa0; }
        .ah-active { color: #7db4ff; }
        .ah-pending { color: #7b8699; }
        .ah-failed { color: #ff8f8f; }
        .ah-check { font-size: 14px; font-weight: bold; }
        .ah-badge { border-radius: 999px; padding-top: 2px; padding-bottom: 2px; padding-left: 10px; padding-right: 10px; font-size: 12px; font-weight: bold; }
        .ah-badge-neutral { background-color: rgba(148,163,184,0.16); color: #cbd5e1; }
        .ah-badge-info { background-color: rgba(59,130,246,0.20); color: #9cc2ff; }
        .ah-badge-success { background-color: rgba(52,211,153,0.18); color: #8ef0c2; }
        .ah-badge-warning { background-color: rgba(245,184,64,0.18); color: #ffd58a; }
        .ah-badge-danger { background-color: rgba(248,113,113,0.18); color: #ffadad; }
        .ah-divider { background-color: rgba(148,163,184,0.20); min-height: 1px; }
        .ah-progress { min-height: 8px; }
        .ah-progress trough { background-color: rgba(148,163,184,0.20); border-radius: 6px; min-height: 8px; }
        .ah-progress progress { background-color: #5b9dff; border-radius: 6px; min-height: 8px; }
        .ah-button { background-image: none; background-color: rgba(148,163,184,0.16); border-width: 1px; border-style: solid; border-color: rgba(148,163,184,0.22); border-radius: 9px; color: #e7ecf7; padding-top: 7px; padding-bottom: 7px; padding-left: 14px; padding-right: 14px; font-size: 13px; font-weight: bold; }
        .ah-button:hover { background-color: rgba(148,163,184,0.26); }
        .ah-primary { background-image: none; background-color: #2f6fdf; border-width: 1px; border-style: solid; border-color: #4f8bf0; color: #ffffff; }
        .ah-primary:hover { background-color: #3b7cf0; }
        .ah-stop { background-image: none; background-color: rgba(220,55,55,0.22); border-width: 1px; border-style: solid; border-color: rgba(255,120,120,0.45); color: #ffb3b3; }
        .ah-stop:hover { background-color: rgba(235,70,70,0.30); }
        .ah-close { background-image: none; background-color: transparent; border-style: none; color: #9aa6bc; font-size: 16px; padding-left: 4px; padding-right: 4px; }
        .ah-close:hover { color: #f0f4ff; }
        """, -1)
        Gtk.StyleContext.add_provider_for_screen(screen, provider, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION)
        self.widget_css_ready = True

    def label(self, text, style_class="ah-text", limit=500):
        widget = Gtk.Label(label=safe_text(text, limit))
        widget.set_xalign(0.0)
        widget.set_line_wrap(True)
        widget.set_max_width_chars(48)
        widget.get_style_context().add_class(style_class)
        return widget

    def margin(self, widget, top=0, start=0, end=0, bottom=0):
        widget.set_margin_top(top)
        widget.set_margin_start(start)
        widget.set_margin_end(end)
        widget.set_margin_bottom(bottom)
        return widget

    def new_popup(self, focus_required, click_through=False):
        window = Gtk.Window(type=Gtk.WindowType.POPUP)
        window.set_decorated(False)
        window.set_title("AgentHost Overlay")
        window.set_keep_above(True)
        window.set_skip_taskbar_hint(True)
        window.set_accept_focus(focus_required)
        # Never steal keyboard focus on map; interactive cards accept focus
        # only after an explicit click so typing never jumps to the overlay.
        window.set_focus_on_map(False)
        window.set_app_paintable(True)
        screen = Gdk.Screen.get_default()
        if screen is not None:
            window.set_screen(screen)
            self.ensure_widget_css(screen)
        visual = screen.get_rgba_visual() if screen is not None else None
        if visual is not None:
            window.set_visual(visual)
        gdk_window = window.get_window()
        if click_through:
            if gdk_window is not None:
                self.make_click_through(gdk_window)
            window.connect("map-event", self.on_click_through_map)
        return window

    def on_click_through_map(self, window, _event):
        self.make_click_through(window.get_window())
        return False

    def make_click_through(self, gdk_window):
        if gdk_window is None:
            return False
        if CAIRO_FOREIGN_AVAILABLE:
            try:
                gdk_window.input_shape_combine_region(cairo.Region(), 0, 0)
                return True
            except Exception:
                pass
        try:
            gdk_window.set_pass_through(True)
        except Exception:
            pass
        return clear_x11_input_shape(gdk_window)

    def fade_in(self, window, record):
        animation = (record.get("payload") or {}).get("animation") if isinstance(record.get("payload"), dict) else None
        if isinstance(animation, dict) and animation.get("reducedMotion") in {"instant", "none"}:
            window.set_opacity(1.0)
            return
        window.set_opacity(0.0)
        start = time.monotonic()

        def step():
            try:
                if not window.get_visible():
                    return False
                progress = min(1.0, (time.monotonic() - start) / 0.12)
                window.set_opacity(progress)
                return progress < 1.0
            except Exception:
                return False

        GLib.timeout_add(16, step)

    def fade_out(self, window):
        start = time.monotonic()

        def step():
            try:
                if not window.get_visible():
                    return False
                progress = 1.0 - min(1.0, (time.monotonic() - start) / 0.09)
                window.set_opacity(max(0.0, progress))
                if progress <= 0.0:
                    window.destroy()
                    return False
                return True
            except Exception:
                return False

        GLib.timeout_add(16, step)

    def build_row(self, component):
        kind = component.get("type")
        if kind == "heading":
            widget = self.label(component.get("text", ""), "ah-heading", 200)
            return {"kind": kind, "data": component, "widget": widget, "update": lambda value, target=widget: target.set_text(safe_text(value.get("text", ""), 200))}
        if kind in {"text", "warning"}:
            style = "ah-warning" if kind == "warning" else "ah-text"
            widget = self.label(("! " if kind == "warning" else "") + safe_text(component.get("text", ""), 500), style)
            prefix = "! " if kind == "warning" else ""

            def update(value, target=widget, lead=prefix):
                target.set_text(lead + safe_text(value.get("text", ""), 500))

            return {"kind": kind, "data": component, "widget": widget, "update": update}
        if kind == "status_badge":
            badge = self.label(component.get("text", ""), "ah-badge " + STATUS_CLASS.get(component.get("status"), "ah-badge-neutral"), 80)
            self.margin(badge, 0, 0, 0, 0)
            holder = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=0)
            holder.pack_start(badge, False, False, 0)

            def update(value, target=badge):
                status = value.get("status") if value.get("status") in STATUS_CLASS else "neutral"
                target.set_text(safe_text(value.get("text", ""), 80))
                context = target.get_style_context()
                for name in STATUS_CLASS.values():
                    context.remove_class(name)
                context.add_class(STATUS_CLASS[status])

            return {"kind": kind, "data": component, "widget": holder, "update": update}
        if kind == "progress":
            box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=4)
            bar = Gtk.ProgressBar()
            bar.get_style_context().add_class("ah-progress")
            bar.set_show_text(False)
            label = self.label(component.get("label", ""), "ah-dim", 120)
            box.pack_start(bar, False, False, 0)
            box.pack_start(label, False, False, 0)

            def update(value, target=bar, caption=label):
                try:
                    fraction = max(0.0, min(1.0, float(value.get("value", 0.0))))
                except Exception:
                    fraction = 0.0
                target.set_fraction(fraction)
                caption.set_text(safe_text(value.get("label", ""), 120))
                caption.set_visible(bool(caption.get_text()))

            return {"kind": kind, "data": component, "widget": box, "update": update}
        if kind == "spinner":
            box = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=9)
            spinner = Gtk.Spinner()
            spinner.set_size_request(16, 16)
            spinner.start()
            label = self.label(component.get("label", ""), "ah-text", 200)
            box.pack_start(spinner, False, False, 0)
            box.pack_start(label, True, True, 0)

            def update(value, target=label):
                target.set_text(safe_text(value.get("label", ""), 200))
                target.set_visible(bool(target.get_text()))

            return {"kind": kind, "data": component, "widget": box, "update": update}
        if kind == "checklist":
            box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=5)

            def fill(items):
                for child in box.get_children():
                    box.remove(child)
                    child.destroy()
                for item in items[:8]:
                    state = item.get("state") or ("done" if item.get("checked") else "pending")
                    if state not in CHECK_GLYPHS:
                        state = "pending"
                    row = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=8)
                    marker = self.label(CHECK_GLYPHS[state], "ah-check ah-" + state, 4)
                    marker.set_size_request(18, -1)
                    row.pack_start(marker, False, False, 0)
                    row.pack_start(self.label(item.get("label", ""), "ah-text" if state != "pending" else "ah-dim", 200), True, True, 0)
                    box.pack_start(row, False, False, 0)
                box.show_all()

            fill(component.get("items") if isinstance(component.get("items"), list) else [])

            def update(value, target=box):
                fill(value.get("items") if isinstance(value.get("items"), list) else [])

            return {"kind": kind, "data": component, "widget": box, "update": update}
        if kind == "key_value":
            row = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=8)
            key = self.label(component.get("key", ""), "ah-key", 60)
            key.set_size_request(96, -1)
            value = self.label(component.get("value", ""), "ah-value", 200)
            row.pack_start(key, False, False, 0)
            row.pack_start(value, True, True, 0)

            def update(item, key_target=key, value_target=value):
                key_target.set_text(safe_text(item.get("key", ""), 60))
                value_target.set_text(safe_text(item.get("value", ""), 200))

            return {"kind": kind, "data": component, "widget": row, "update": update}
        if kind == "comparison":
            box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=3)
            before = self.label(component.get("before", ""), "ah-dim", 300)
            after = self.label(component.get("after", ""), "ah-text", 300)
            box.pack_start(before, False, False, 0)
            box.pack_start(after, False, False, 0)

            def update(value, old=before, new=after):
                old.set_text(safe_text(value.get("before", ""), 300))
                new.set_text(safe_text(value.get("after", ""), 300))

            return {"kind": kind, "data": component, "widget": box, "update": update}
        if kind == "divider":
            divider = Gtk.Box()
            divider.get_style_context().add_class("ah-divider")
            divider.set_size_request(-1, 1)
            return {"kind": kind, "data": component, "widget": divider, "update": lambda _value: None}
        if kind == "icon":
            token = component.get("token") if component.get("token") in {"info", "success", "warning", "danger", "check", "close", "pointer"} else "info"
            widget = self.label(ICON_GLYPHS.get(token, "i"), "ah-check ah-active", 4)
            widget.set_size_request(18, -1)
            return {"kind": kind, "data": component, "widget": widget, "update": lambda _value: None}
        if kind == "image_reference":
            widget = self.label(component.get("alt", ""), "ah-dim", 300)
            return {"kind": kind, "data": component, "widget": widget, "update": lambda value, target=widget: target.set_text(safe_text(value.get("alt", ""), 300))}
        return None

    def build_body(self, card, components):
        body = card["body"]
        for child in body.get_children():
            body.remove(child)
            child.destroy()
        rows = []
        for component in components:
            row = self.build_row(component)
            if row is not None:
                rows.append(row)
                body.pack_start(row["widget"], False, False, 0)
        card["rows"] = rows
        body.show_all()

    def update_body(self, card, components):
        current = card["rows"]
        kinds = [component.get("type") for component in components]
        rebuild = len(current) != len(components) or any(row["kind"] != kind for row, kind in zip(current, kinds))
        if rebuild:
            self.build_body(card, components)
            return
        for row, component in zip(current, components):
            if row["data"] == component:
                continue
            try:
                row["update"](component)
                row["data"] = component
            except Exception:
                # A row-level failure (historically seen inside Gtk.Label.set_text
                # under rapid updates) must not wedge the whole card: rebuild the
                # body from scratch and move on.
                self.build_body(card, components)
                return

    def build_footer(self, card, components, record):
        footer = card["footer"]
        for child in footer.get_children():
            footer.remove(child)
            child.destroy()
        interactive = self.is_interactive(record)
        allowed = self.allowed_events(record)
        for component in components:
            event = component.get("event")
            if component.get("type") not in {"button", "choice"} or not isinstance(event, str):
                continue
            button = Gtk.Button(label=safe_text(component.get("label", ""), 200))
            button.set_relief(Gtk.ReliefStyle.NONE)
            button.set_focus_on_click(False)
            button.get_style_context().add_class("ah-button")
            if event in {"resume", "continue", "accepted"}:
                button.get_style_context().add_class("ah-primary")
            elif event in {"emergency_stop_requested", "cancel", "cancelled"}:
                button.get_style_context().add_class("ah-stop")
            enabled = interactive and event in allowed
            button.set_sensitive(enabled)
            if enabled:
                button.connect("clicked", lambda _button, current=record, name=event: self.emit(current, name))
            footer.pack_start(button, False, False, 0)
        card["footer_signature"] = [component for component in components if component.get("type") in {"button", "choice"}]
        footer.set_visible(len(footer.get_children()) > 0)
        card["separator"].set_visible(len(footer.get_children()) > 0)
        footer.show_all()

    def set_accessible_name(self, widget, name):
        try:
            accessible = widget.get_accessible()
            if accessible is not None:
                accessible.set_name(safe_text(name, 200))
        except Exception:
            pass

    def build_header(self, card, record):
        payload = record.get("payload") or {}
        title_text = safe_text(payload.get("title") or payload.get("label") or "AgentHost", 200)
        close_event = self.dismiss_event(record)
        signature = (title_text, close_event)
        # Rebuilding the header destroys/recreates the drag EventBox on every
        # detail tick. Only rebuild when the title or close affordance actually
        # changes; otherwise update the label text in place.
        if card.get("header_signature") == signature and card.get("title") is not None:
            if card["title"].get_text() != title_text:
                card["title"].set_text(title_text)
                self.set_accessible_name(card["window"], title_text)
            return
        header = card["header"]
        for child in header.get_children():
            header.remove(child)
            child.destroy()
        title = self.label(title_text, "ah-title", 200)
        title.set_ellipsize(3)
        title.set_line_wrap(False)
        title.set_max_width_chars(38)
        drag = Gtk.EventBox()
        drag.add(title)
        drag.connect("button-press-event", self.start_drag, card)
        header.pack_start(drag, True, True, 0)
        button = None
        if close_event is not None:
            button = Gtk.Button(label="✕")
            button.set_relief(Gtk.ReliefStyle.NONE)
            button.set_focus_on_click(False)
            button.get_style_context().add_class("ah-close")
            button.connect("clicked", lambda _button, current=record, name=close_event: self.emit(current, name))
            header.pack_start(button, False, False, 0)
        card["title"] = title
        card["close_button"] = button
        card["close_event"] = close_event
        card["header_signature"] = signature
        self.set_accessible_name(card["window"], title_text)
        header.show_all()

    def start_drag(self, _widget, event, card):
        if event.button == 1:
            card["move_drag"] = True
            card["window"].begin_move_drag(event.button, int(event.x_root), int(event.y_root), event.time)
        return False

    def on_card_configure(self, _window, event, card):
        # While the window manager is running a move drag, remember where the
        # operator put the card so later content updates do not snap it back.
        if card.get("move_drag"):
            card["user_position"] = (int(event.x), int(event.y))
        return False

    def create_card(self, record):
        window = self.new_popup((record.get("payload") or {}).get("interaction", {}).get("focus") == "when_required" if isinstance(record.get("payload"), dict) else False)
        frame = Gtk.EventBox()
        frame.get_style_context().add_class("ah-card")
        frame.set_size_request(CARD_WIDTH, -1)
        outer = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=0)
        self.margin(outer, 14, 16, 16, 14)
        header = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=8)
        self.margin(header, 0, 0, 0, 6)
        body = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=7)
        separator = Gtk.Box()
        separator.get_style_context().add_class("ah-divider")
        separator.set_size_request(-1, 1)
        self.margin(separator, 10, 0, 0, 10)
        footer = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=8)
        footer.set_halign(Gtk.Align.END)
        outer.pack_start(header, False, False, 0)
        outer.pack_start(body, False, False, 0)
        outer.pack_start(separator, False, False, 0)
        outer.pack_start(footer, False, False, 0)
        frame.add(outer)
        window.add(frame)
        window.connect("key-press-event", self.card_key, record)
        card = {"overlayId": record.get("overlayId"), "window": window, "frame": frame, "outer": outer, "header": header, "body": body, "separator": separator, "footer": footer, "rows": [], "footer_signature": [], "header_signature": None, "title": None, "close_button": None, "close_event": None, "last_position": None, "move_drag": False, "user_position": None}
        window.connect("configure-event", self.on_card_configure, card)
        self.cards[record.get("overlayId")] = card
        return card

    def render_card(self, record):
        overlay_id = record.get("overlayId")
        card = self.cards.get(overlay_id)
        first = card is None
        if card is None:
            card = self.create_card(record)
        payload = record.get("payload") or {}
        components = component_rows(payload)
        if not components and payload.get("type") == "progress":
            try:
                components = [{"type": "progress", "value": max(0.0, min(1.0, float(payload.get("progress", payload.get("value", 0.0)))))}]
            except Exception:
                components = [{"type": "progress", "value": 0.0}]
        body_components = [component for component in components if component.get("type") not in {"button", "choice"}]
        footer_components = [component for component in components if component.get("type") in {"button", "choice"}]
        self.build_header(card, record)
        if first:
            self.build_body(card, body_components)
        else:
            self.update_body(card, body_components)
        if card.get("footer_signature") != footer_components:
            self.build_footer(card, footer_components, record)
        if first:
            card["window"].show_all()
            self.fade_in(card["window"], record)
        self.position_card(card, record)
        self.draw_ready.add(overlay_id)

    def position_card(self, card, record):
        window = card["window"]
        if not window.get_visible():
            window.show_all()
        self.pump(3)
        try:
            _minimum, natural = card["frame"].get_preferred_size()
            height = int(natural.height)
        except Exception:
            height = card_content_height(record.get("payload") or {})
        width = CARD_WIDTH
        area = self.workarea()
        if area is None:
            return
        height = max(64, min(height, area.height - 2 * CARD_MARGIN, MAX_CARD_HEIGHT))
        payload = record.get("payload") or {}
        target = payload.get("target") if isinstance(payload, dict) else {}
        bounds = target.get("bounds") if isinstance(target, dict) else None
        point = target.get("point") if isinstance(target, dict) else None
        user_position = card.get("user_position")
        if isinstance(user_position, tuple) and not isinstance(bounds, dict) and not isinstance(point, dict):
            x, y = float(user_position[0]), float(user_position[1])
        elif isinstance(bounds, dict):
            try:
                x = float(bounds.get("x", 0)) + float(bounds.get("width", 1)) + 12
                y = float(bounds.get("y", 0))
            except Exception:
                x, y = area.x + CARD_MARGIN, area.y + CARD_MARGIN
        elif isinstance(point, dict):
            try:
                x = float(point.get("x", 0)) + 20
                y = float(point.get("y", 0)) + 20
            except Exception:
                x, y = area.x + CARD_MARGIN, area.y + CARD_MARGIN
        else:
            placement = payload.get("placement", "top_right")
            if placement in {"top_center", "bottom_center"}:
                x = area.x + (area.width - width) / 2
            elif placement in {"top_left", "bottom_left"}:
                x = area.x + CARD_MARGIN
            else:
                x = area.x + area.width - width - CARD_MARGIN
            y = area.y + area.height - height - CARD_MARGIN if placement in {"bottom_left", "bottom_center", "bottom_right"} else area.y + CARD_MARGIN
        x = min(max(x, area.x + CARD_MARGIN), area.x + area.width - width - CARD_MARGIN)
        y = min(max(y, area.y + CARD_MARGIN), area.y + area.height - height - CARD_MARGIN)
        card["last_position"] = (int(x), int(y), width, height)
        window.resize(width, height)
        window.move(int(x), int(y))

    def card_key(self, _widget, event, record):
        if event.keyval == Gdk.KEY_Escape:
            event_name = self.dismiss_event(record)
            if event_name is not None:
                self.emit(record, event_name)
                return True
        return False

    def needs_surfaces(self):
        return any(self.is_surface_record(record) for record in self.records.values())

    def is_surface_record(self, record):
        payload = record.get("payload") if isinstance(record, dict) else {}
        kind = payload.get("type", record.get("type", "widget")) if isinstance(payload, dict) else record.get("type", "widget")
        return kind in SURFACE_TYPES

    def ensure_surfaces(self):
        if not self.needs_surfaces():
            self.destroy_surfaces()
            return True
        geometries = self.monitor_geometries()
        signature = tuple(geometries)
        if signature == self.monitor_signature and self.surface_windows:
            self.redraw_surfaces()
            return True
        self.destroy_surfaces()
        self.monitor_signature = signature
        for monitor_index, geometry in enumerate(geometries):
            window = self.new_popup(False, click_through=True)
            if CAIRO_FOREIGN_AVAILABLE:
                area = Gtk.DrawingArea()
                area.set_app_paintable(True)
                area.connect("draw", self.draw_surface, (monitor_index,) + geometry)
                window.add(area)
            else:
                root = Gtk.Fixed()
                root.get_style_context().add_class("ah-surface")
                window.add(root)
                self.surface_fixed.append(root)
            window.move(geometry[0], geometry[1])
            window.set_default_size(geometry[2], geometry[3])
            window.show_all()
            gdk_window = window.get_window()
            if gdk_window is not None:
                self.make_click_through(gdk_window)
            self.surface_windows.append(window)
            self.draw_ready.add("surface:%d" % monitor_index)
        if not CAIRO_FOREIGN_AVAILABLE:
            self.redraw_surfaces()
        return True

    def redraw_surfaces(self):
        if CAIRO_FOREIGN_AVAILABLE:
            for window in self.surface_windows:
                child = window.get_child()
                if child is not None:
                    child.queue_draw()
            return
        for index, root in enumerate(self.surface_fixed):
            for child in root.get_children():
                root.remove(child)
                child.destroy()
            geometry = self.monitor_geometries()[index] if index < len(self.monitor_geometries()) else (0, 0, 1920, 1080, 1)
            ox, oy = geometry[0], geometry[1]
            for record in self.records.values():
                if not self.is_surface_record(record):
                    continue
                bounds = self.target_bounds(record)
                widget = self.surface_widget(record)
                root.put(widget, int(bounds[0] - ox), int(bounds[1] - oy))
                widget.show_all()
            root.show_all()

    def surface_widget(self, record):
        payload = record.get("payload") or {}
        kind = payload.get("type", "pointer")
        if kind in {"pointer", "arrow"}:
            return self.label("➤", "ah-active", 4)
        frame = Gtk.EventBox()
        frame.get_style_context().add_class("ah-highlight")
        return frame

    def draw_surface(self, _area, cr, geometry):
        cr.set_operator(cairo.OPERATOR_SOURCE)
        cr.set_source_rgba(0, 0, 0, 0)
        cr.paint()
        cr.set_operator(cairo.OPERATOR_OVER)
        monitor_index, ox, oy, monitor_width, monitor_height, _scale = geometry
        for record in list(self.records.values()):
            if not self.is_surface_record(record):
                continue
            policy = (record.get("payload") or {}).get("displayPolicy", "primary")
            if policy != "all" and monitor_index != 0:
                continue
            self.draw_record(cr, record, ox, oy, monitor_width, monitor_height)
        self.draw_ready.add("surface:%d" % monitor_index)
        return False

    def draw_record(self, cr, record, ox, oy, monitor_width=1920, monitor_height=1080):
        payload = record.get("payload") or {}
        bounds = self.target_bounds(record)
        x, y, width, height = bounds[0] - ox, bounds[1] - oy, bounds[2], bounds[3]
        self.draw_primitive(cr, payload, x, y, width, height)

    def draw_primitive(self, cr, payload, x, y, width, height):
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

    def emit(self, record, event):
        if not isinstance(event, str) or event not in EVENTS:
            return
        if event not in self.allowed_events(record):
            return
        self.events.append({"eventId": "event_" + uuid.uuid4().hex, "overlayId": record.get("overlayId"), "event": event, "createdAt": now_iso(), "ownerSessionId": self.session_id})
        self.events = self.events[-100:]

    def drain_events(self):
        events = list(self.events)
        self.events = []
        return events

    def visibility_counts(self):
        self.pump(8)
        visible = 0
        for card in self.cards.values():
            window = card.get("window")
            gdk_window = window.get_window() if window is not None else None
            if gdk_window is not None and (not hasattr(gdk_window, "get_mapped") or gdk_window.get_mapped()):
                visible += 1
        for window in self.surface_windows:
            gdk_window = window.get_window()
            if gdk_window is not None and (not hasattr(gdk_window, "get_mapped") or gdk_window.get_mapped()):
                visible += 1
        interactive = sum(1 for card in self.cards.values() if self.is_interactive(self.records.get(card.get("overlayId"), {})))
        transparent = visible
        return visible, interactive, transparent

    def operation_ack(self, command, acknowledgement, overlay_id=None, reason=None):
        visible, interactive, transparent = self.visibility_counts()
        return {
            "command": command,
            "acknowledgement": acknowledgement,
            "rendererEpoch": self.renderer_epoch,
            "visibleWindowCount": visible,
            "interactiveWindowCount": interactive,
            "transparentWindowCount": transparent,
            "drawReadyCount": len(self.draw_ready),
            "visible": bool(visible > 0 and len(self.draw_ready) > 0),
            "liveSurfaceRegistered": bool(overlay_id is not None and overlay_id in self.records),
            **({"overlayId": overlay_id} if overlay_id is not None else {}),
            **({"reason": reason} if reason is not None else {}),
        }

    def show(self, record):
        if not isinstance(record, dict) or not isinstance(record.get("overlayId"), str) or not isinstance(record.get("payload"), dict):
            return {"ok": False, "reason": "render_record_invalid"}
        encoded = json.dumps(record, separators=(",", ":"))
        if len(encoded.encode("utf-8")) > MAX_BYTES:
            return {"ok": False, "reason": "render_record_oversized"}
        if not self.capability().get("supported"):
            return {"ok": False, "reason": self.last_render_reason or "overlay_transparency_unavailable"}
        previous = self.records.get(record["overlayId"])
        self.records[record["overlayId"]] = record
        self.emergency_hidden = False
        try:
            self.render_record(record)
        except Exception:
            if previous is not None:
                self.records[record["overlayId"]] = previous
            else:
                self.records.pop(record["overlayId"], None)
            return {"ok": False, "reason": "overlay_render_failed"}
        visible, _interactive, _transparent = self.visibility_counts()
        if visible <= 0:
            if previous is not None:
                self.records[record["overlayId"]] = previous
            else:
                self.records.pop(record["overlayId"], None)
                self.dismiss_card(record["overlayId"], animate=False)
            return {"ok": False, "reason": "overlay_live_registration_missing"}
        return {"ok": True, **self.operation_ack("show", "visible", record["overlayId"], "gtk3_overlay_shown")}

    def render_record(self, record):
        payload = record.get("payload") or {}
        kind = payload.get("type", record.get("type", "widget")) if isinstance(payload, dict) else record.get("type", "widget")
        if kind in SURFACE_TYPES:
            self.dismiss_card(record.get("overlayId"), animate=False)
            self.ensure_surfaces()
            self.redraw_surfaces()
            self.draw_ready.add(record.get("overlayId"))
            return
        self.render_card(record)

    def update(self, record):
        if not isinstance(record, dict) or record.get("overlayId") not in self.records:
            return {"ok": False, "reason": "overlay_not_found"}
        previous = self.records[record["overlayId"]]
        result = self.show(record)
        if result.get("ok"):
            result["command"] = "update"
            result["acknowledgement"] = "updated"
            result["reason"] = "gtk3_overlay_updated"
        elif previous is not None:
            self.records[record["overlayId"]] = previous
        return result

    def dismiss_card(self, overlay_id, animate=True):
        card = self.cards.pop(overlay_id, None)
        if card is None:
            return
        window = card.get("window")
        if window is None:
            return
        if animate:
            self.fade_out(window)
        else:
            window.destroy()
        self.draw_ready.discard(overlay_id)

    def dismiss(self, overlay_id):
        self.records.pop(overlay_id, None)
        self.dismiss_card(overlay_id)
        if not self.needs_surfaces():
            self.destroy_surfaces()
        else:
            self.redraw_surfaces()
        return {"ok": True, **self.operation_ack("dismiss", "dismissed", overlay_id, "gtk3_overlay_dismissed")}

    def clear(self):
        self.records.clear()
        self.destroy_cards()
        self.destroy_surfaces()
        self.draw_ready = set()
        return {"ok": True, **self.operation_ack("clear", "cleared", reason="gtk3_overlays_cleared")}

    def emergency_hide(self):
        self.records.clear()
        self.destroy_cards()
        self.destroy_surfaces()
        self.draw_ready = set()
        self.emergency_hidden = True
        return {"ok": True, **self.operation_ack("emergency_hide", "emergency_hidden", reason="gtk3_emergency_hide_complete")}

    def state(self):
        return {
            "renderer": self.capability(),
            "overlays": [{"overlayId": key, "ownerSessionId": self.session_id, "type": value.get("type", "widget"), "sensitivity": (value.get("payload") or {}).get("sensitivity", "public"), "interactive": self.is_interactive(value), "visible": True, "createdAt": now_iso(), "updatedAt": now_iso(), "expiresAt": now_iso()} for key, value in self.records.items()],
            "pendingEvents": list(self.events),
            "emergencyHidden": self.emergency_hidden,
        }

    def monitor_tick(self):
        if Gtk.main_level() <= 0:
            return False
        signature = tuple(self.monitor_geometries())
        if signature != self.monitor_signature and self.needs_surfaces():
            self.ensure_surfaces()
        return True

    def close(self):
        self.destroy_windows()
        if self.monitor_source:
            GLib.source_remove(self.monitor_source)
            self.monitor_source = None
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
    enqueue_request(request)


def enqueue_request(request):
    # Rendering runs on a GLib idle callback instead of inside the stdin IO
    # watch. Rapid show/update bursts used to wedge the main loop inside
    # Gtk.Label.set_text; queueing serializes mutations at idle priority and
    # coalesces per-overlay updates to the latest payload (latest wins).
    command = request.get("command")
    overlay_id = request.get("payload", {}).get("overlayId") if isinstance(request.get("payload"), dict) else None
    if command in {"show", "update"} and isinstance(overlay_id, str):
        renderer.command_queue = [
            item for item in renderer.command_queue
            if not (item[1] in {"show", "update"} and item[2] == overlay_id)
        ]
    renderer.command_queue.append((request, command, overlay_id))
    if not renderer.queue_scheduled:
        renderer.queue_scheduled = True
        GLib.idle_add(process_command_queue)


def process_command_queue():
    renderer.queue_scheduled = False
    while renderer.command_queue:
        request, _command, _overlay_id = renderer.command_queue.pop(0)
        handle_request(request)
    return False


def handle_request(request):
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
            if result.get("ok"):
                result["requestId"] = request["id"]
            reply(request["id"], bool(result.get("ok")), result if result.get("ok") else None, None if result.get("ok") else result.get("reason"))
        elif command == "update":
            result = renderer.update(payload)
            if result.get("ok"):
                result["requestId"] = request["id"]
            reply(request["id"], bool(result.get("ok")), result if result.get("ok") else None, None if result.get("ok") else result.get("reason"))
        elif command == "dismiss":
            result = renderer.dismiss((payload or {}).get("overlayId"))
            if result.get("ok"):
                result["requestId"] = request["id"]
            reply(request["id"], bool(result.get("ok")), result if result.get("ok") else None, None if result.get("ok") else result.get("reason"))
        elif command == "clear":
            result = renderer.clear()
            if result.get("ok"):
                result["requestId"] = request["id"]
            reply(request["id"], bool(result.get("ok")), result if result.get("ok") else None, None if result.get("ok") else result.get("reason"))
        elif command == "emergency_hide":
            result = renderer.emergency_hide()
            if result.get("ok"):
                result["requestId"] = request["id"]
            reply(request["id"], bool(result.get("ok")), result if result.get("ok") else None, None if result.get("ok") else result.get("reason"))
        elif command == "state":
            reply(request["id"], True, renderer.state())
        elif command == "events":
            reply(request["id"], True, {"events": renderer.drain_events()})
        elif command == "close":
            reply(request["id"], True, {"reason": "renderer_closing"})
            renderer.close()
    except Exception:
        reply(request["id"], False, error="renderer_command_failed")


def stdin_watch(_source, condition):
    if condition & GLib.IO_HUP:
        while renderer.command_queue:
            request, _command, _overlay_id = renderer.command_queue.pop(0)
            handle_request(request)
        renderer.close()
        return False
    line = sys.stdin.readline()
    if line:
        handle(line.strip())
        return True
    renderer.close()
    return False


if __name__ == "__main__":
    ok, _argv = Gtk.init_check()
    if not ok:
        raise SystemExit(78)
    renderer = Renderer()
    GLib.io_add_watch(sys.stdin, GLib.IO_IN | GLib.IO_HUP, stdin_watch)
    _starter_ppid = os.getppid()

    def _parent_watch():
        try:
            if os.getppid() != _starter_ppid:
                renderer.close()
                return False
        except Exception:
            pass
        return True

    GLib.timeout_add_seconds(5, _parent_watch)
    Gtk.main()
