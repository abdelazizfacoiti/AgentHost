#!/usr/bin/env python3
"""Fixed GTK3 overlay renderer. JSONL stdio only; never executes target-app actions."""
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
        # Optional Debian `python3-gi-cairo` bridge. When absent, use the
        # bounded GTK-widget renderer below; never create a Cairo callback
        # that would fail after opening an opaque fullscreen window.
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
COMMANDS = {"hello", "capabilities", "show", "update", "dismiss", "clear", "emergency_hide", "state", "close"}
EVENTS = {"accepted", "rejected", "dismissed", "cancelled", "next", "back", "acknowledgement_checked", "emergency_stop_requested", "continue", "pause", "resume", "cancel", "acknowledge", "show_details", "hide", "retry_visual_render", "inspect_diagnostics", "open_control_room", "review_prepared_action", "emergency_hide", "close_control_surface"}


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
        self.surface_roots = []
        self.interactive = {}
        self.records = {}
        self.events = []
        self.emergency_hidden = False
        self.monitor_signature = None
        self.draw_ready = set()
        self.renderer_epoch = 0
        self.last_render_reason = None
        self.widget_css_ready = False
        self.tick_source = GLib.timeout_add(33, self.tick)

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
            "limitations": limitations + ([] if CAIRO_FOREIGN_AVAILABLE else ["PyGObject Cairo foreign bindings are unavailable; bounded GTK widgets render cards and targets."]),
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
        self.surface_roots = []
        self.draw_ready = set()
        for window in list(self.interactive.values()):
            window.destroy()
        self.interactive = {}

    def rebuild(self):
        self.destroy_windows()
        capability = self.capability()
        if not capability.get("supported"):
            self.last_render_reason = capability.get("reason", "overlay_transparency_unavailable")
            self.monitor_signature = tuple(self.monitor_geometries())
            return False
        self.last_render_reason = None
        geometries = self.monitor_geometries()
        signature = tuple(geometries)
        self.monitor_signature = signature
        for monitor_index, geometry in enumerate(geometries):
            window = Gtk.Window(type=Gtk.WindowType.POPUP)
            window.set_decorated(False)
            window.set_keep_above(True)
            window.set_skip_taskbar_hint(True)
            window.set_accept_focus(False)
            window.set_focus_on_map(False)
            window.set_app_paintable(True)
            # Resolve visual from default X11 screen before realization. Some
            # GTK builds return no visual from an unrealized popup window,
            # which otherwise leaves an opaque black fullscreen surface.
            screen = Gdk.Screen.get_default()
            if screen is not None:
                window.set_screen(screen)
            visual = screen.get_rgba_visual() if screen is not None else None
            if screen is None:
                self.last_render_reason = "overlay_screen_unavailable"
                self.destroy_windows()
                return False
            self.ensure_widget_css(screen)
            if visual is None:
                self.last_render_reason = "overlay_transparency_unavailable"
                self.destroy_windows()
                return False
            window.set_visual(visual)
            if CAIRO_FOREIGN_AVAILABLE:
                area = Gtk.DrawingArea()
                area.set_app_paintable(True)
                area.connect("draw", self.draw_surface, (monitor_index,) + geometry)
                window.add(area)
            else:
                root = Gtk.Fixed()
                root.set_app_paintable(True)
                root.get_style_context().add_class("agenthost-overlay-surface")
                window.add(root)
                self.surface_roots.append((root, (monitor_index,) + geometry))
            window.move(geometry[0], geometry[1])
            window.set_default_size(geometry[2], geometry[3])
            window.show_all()
            window.get_window().set_keep_above(True) if window.get_window() is not None else None
            gdk_window = window.get_window()
            if gdk_window is not None:
                if CAIRO_FOREIGN_AVAILABLE:
                    try:
                        gdk_window.input_shape_combine_region(cairo.Region(), 0, 0)
                    except Exception:
                        gdk_window.set_pass_through(True)
                else:
                    gdk_window.set_pass_through(True)
            self.windows.append(window)
        if not CAIRO_FOREIGN_AVAILABLE:
            for root, geometry in self.surface_roots:
                self.render_widget_surface(root, geometry)
                self.draw_ready.add(geometry[0])
        for record in self.records.values():
            if self.is_interactive(record):
                self.create_interactive(record)
        return True

    def ensure_widget_css(self, screen):
        if self.widget_css_ready or screen is None:
            return
        provider = Gtk.CssProvider()
        provider.load_from_data(b"""
        .agenthost-overlay-surface { background-color: rgba(0,0,0,0); }
        .agenthost-overlay-card { background-color: rgba(10,13,21,0.96); border: 2px solid #4d8dff; border-radius: 12px; padding: 12px; color: #f5f7ff; }
        .agenthost-overlay-warning { border-color: #e3a82b; }
        .agenthost-overlay-danger { border-color: #e05b5b; }
        .agenthost-overlay-highlight { background-color: rgba(45,126,255,0.10); border: 3px solid #4d8dff; border-radius: 10px; }
        .agenthost-overlay-pointer { color: #75aaff; font-size: 30px; }
        .agenthost-overlay-title { color: #f5f7ff; font-weight: bold; font-size: 16px; }
        .agenthost-overlay-text { color: #d5dbea; font-size: 13px; }
        .agenthost-overlay-progress trough { background-color: rgba(30,35,48,0.92); border-radius: 8px; min-height: 16px; }
        .agenthost-overlay-progress progress { background-color: #4d8dff; border-radius: 8px; }
        """, -1)
        Gtk.StyleContext.add_provider_for_screen(screen, provider, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION)
        self.widget_css_ready = True

    def widget_label(self, text, style_class="agenthost-overlay-text"):
        label = Gtk.Label(label=safe_text(text, 500))
        label.set_xalign(0.0)
        label.set_line_wrap(True)
        label.set_max_width_chars(80)
        label.get_style_context().add_class(style_class)
        return label

    def render_widget_surface(self, root, geometry):
        monitor_index, ox, oy, monitor_width, monitor_height, _scale = geometry
        for record in list(self.records.values()):
            policy = (record.get("payload") or {}).get("displayPolicy", "primary")
            if policy != "all" and monitor_index != 0:
                continue
            if not self.is_interactive(record):
                self.render_widget_record(root, record, ox, oy, monitor_width, monitor_height)

    def render_widget_record(self, root, record, ox, oy, monitor_width, monitor_height):
        payload = record.get("payload") or {}
        kind = payload.get("type", "widget")
        bounds = self.target_bounds(record)
        x, y, width, height = bounds
        target = payload.get("target") if isinstance(payload, dict) else {}
        if not isinstance(target, dict) or (target.get("bounds") is None and target.get("point") is None):
            placement = payload.get("placement", "top_left")
            width, height, margin = 360, 160, 24
            x = (monitor_width - width) / 2 if placement in {"top_center", "bottom_center"} else monitor_width - width - margin if placement in {"top_right", "bottom_right"} else margin
            y = monitor_height - height - margin if placement in {"bottom_left", "bottom_center", "bottom_right"} else margin
        x, y = int(x - ox), int(y - oy)
        width, height = int(max(32, min(width, monitor_width))), int(max(32, min(height, monitor_height)))
        if kind in {"pointer", "arrow"}:
            widget = self.widget_label("➤", "agenthost-overlay-pointer")
            width, height = 48, 48
        elif kind in {"highlight", "spotlight"}:
            widget = Gtk.Frame()
            widget.get_style_context().add_class("agenthost-overlay-highlight")
        elif kind == "progress":
            widget = Gtk.ProgressBar()
            widget.get_style_context().add_class("agenthost-overlay-progress")
            try:
                widget.set_fraction(max(0.0, min(1.0, float(payload.get("progress", payload.get("value", 0.0))))))
            except Exception:
                widget.set_fraction(0.0)
            height = 18
        else:
            frame = Gtk.Frame()
            frame.get_style_context().add_class("agenthost-overlay-card")
            style = payload.get("style") if isinstance(payload.get("style"), dict) else {}
            if style.get("semantic") == "warning": frame.get_style_context().add_class("agenthost-overlay-warning")
            if style.get("semantic") == "danger": frame.get_style_context().add_class("agenthost-overlay-danger")
            box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=6)
            title = payload.get("label") or payload.get("title") or payload.get("text") or kind
            box.pack_start(self.widget_label(title, "agenthost-overlay-title"), False, False, 0)
            components = payload.get("components")
            if isinstance(components, list):
                for component in components[:12]:
                    if isinstance(component, dict):
                        text = component.get("text") or component.get("label") or component.get("key")
                        if isinstance(text, str): box.pack_start(self.widget_label(text), False, False, 0)
            elif isinstance(payload.get("text"), str):
                box.pack_start(self.widget_label(payload["text"]), False, False, 0)
            frame.add(box); widget = frame
            width, height = max(width, 260), max(height, 84)
        root.put(widget, x, y)
        widget.set_size_request(width, height)
        widget.show_all()

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
        transparent = 0
        for window in self.windows:
            try:
                if window.get_visual() is not None:
                    transparent += 1
            except Exception:
                pass
        return {
            "command": command,
            "acknowledgement": acknowledgement,
            "rendererEpoch": self.renderer_epoch,
            "visibleWindowCount": visible,
            "interactiveWindowCount": interactive,
            "transparentWindowCount": transparent,
            "drawReadyCount": len(self.draw_ready),
            "visible": bool(visible > 0 and len(self.draw_ready) >= len(self.windows) and transparent >= visible),
            "liveSurfaceRegistered": bool(overlay_id is not None and overlay_id in self.records),
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
        if not CAIRO_FOREIGN_AVAILABLE:
            event_box = Gtk.EventBox()
            event_box.get_style_context().add_class("agenthost-overlay-card")
            box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=6)
            payload = record.get("payload") or {}
            box.pack_start(self.widget_label(payload.get("title") or payload.get("label") or payload.get("type", "overlay"), "agenthost-overlay-title"), False, False, 0)
            for component in payload.get("components", []) if isinstance(payload, dict) else []:
                if not isinstance(component, dict):
                    continue
                event = component.get("event")
                label = component.get("label") or component.get("text")
                if component.get("type") in {"button", "choice"} and isinstance(label, str) and isinstance(event, str):
                    button = Gtk.Button(label=safe_text(label, 200))
                    button.connect("clicked", self.widget_interactive_event, record, event)
                    box.pack_start(button, False, False, 0)
                elif isinstance(label, str):
                    box.pack_start(self.widget_label(label), False, False, 0)
            event_box.add(box)
            event_box.connect("key-press-event", self.interactive_key, record)
            window.add(event_box)
            window.move(int(x), int(y))
            window.set_default_size(int(width), int(height))
            window.show_all()
            self.interactive[record.get("overlayId")] = window
            return
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

    def widget_interactive_event(self, _button, record, event):
        if event in EVENTS:
            self.events.append({"eventId": "event_" + uuid.uuid4().hex, "overlayId": record.get("overlayId"), "event": event, "createdAt": now_iso(), "ownerSessionId": self.session_id})
            self.events = self.events[-100:]

    def draw_surface(self, _area, cr, geometry):
        # Clear with SOURCE on the RGBA visual. Using OVER here leaves the
        # window's default opaque background behind the overlay primitives.
        cr.set_operator(cairo.OPERATOR_SOURCE)
        cr.set_source_rgba(0, 0, 0, 0)
        cr.paint()
        cr.set_operator(cairo.OPERATOR_OVER)
        monitor_index, ox, oy, monitor_width, monitor_height, _scale = geometry
        for record in list(self.records.values()):
            policy = (record.get("payload") or {}).get("displayPolicy", "primary")
            if policy != "all" and monitor_index != 0:
                continue
            if not self.is_interactive(record):
                self.draw_record(cr, record, ox, oy, monitor_width, monitor_height)
        self.draw_ready.add(geometry[0])
        return False

    def draw_interactive(self, _area, cr, record):
        allocation = _area.get_allocation()
        cr.set_source_rgba(0.05, 0.07, 0.11, 0.96)
        rounded_rect(cr, 0, 0, allocation.width, allocation.height, 12)
        cr.fill()
        self.draw_payload(cr, record.get("payload") or {}, 0, 0, allocation.width, allocation.height)
        return False

    def draw_record(self, cr, record, ox, oy, monitor_width=1920, monitor_height=1080):
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
            placement = payload.get("placement", "top_left")
            width, height = 360, 160
            margin = 24
            if placement in {"top_center", "bottom_center"}:
                x = (monitor_width - width) / 2
            elif placement in {"top_right", "bottom_right"}:
                x = monitor_width - width - margin
            else:
                x = margin
            y = monitor_height - height - margin if placement in {"bottom_left", "bottom_center", "bottom_right"} else margin
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
        if not self.capability().get("supported"):
            return {"ok": False, "reason": self.last_render_reason or "overlay_transparency_unavailable"}
        self.records[record["overlayId"]] = record
        self.emergency_hidden = False
        if not self.rebuild():
            self.records.pop(record["overlayId"], None)
            return {"ok": False, "reason": self.last_render_reason or "overlay_transparency_unavailable"}
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
            if result.get("ok"): result["requestId"] = request["id"]
            reply(request["id"], bool(result.get("ok")), result if result.get("ok") else None, None if result.get("ok") else result.get("reason"))
        elif command == "update":
            result = renderer.update(payload)
            if result.get("ok"): result["requestId"] = request["id"]
            reply(request["id"], bool(result.get("ok")), result if result.get("ok") else None, None if result.get("ok") else result.get("reason"))
        elif command == "dismiss":
            result = renderer.dismiss((payload or {}).get("overlayId"))
            if result.get("ok"): result["requestId"] = request["id"]
            reply(request["id"], bool(result.get("ok")), result if result.get("ok") else None, None if result.get("ok") else result.get("reason"))
        elif command == "clear":
            result = renderer.clear()
            if result.get("ok"): result["requestId"] = request["id"]
            reply(request["id"], bool(result.get("ok")), result if result.get("ok") else None, None if result.get("ok") else result.get("reason"))
        elif command == "emergency_hide":
            result = renderer.emergency_hide()
            if result.get("ok"): result["requestId"] = request["id"]
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
    ok, _argv = Gtk.init_check()
    if not ok:
        raise SystemExit(78)
    renderer = Renderer()
    GLib.io_add_watch(sys.stdin, GLib.IO_IN | GLib.IO_HUP, stdin_watch)
    Gtk.main()
