"""Pure geometry helpers for the GTK3 overlay renderer."""


def clamp(value, low, high):
    return min(max(value, low), high)


def card_position(area, width, height, placement="top_right", bounds=None, point=None, user_position=None, margin=24):
    area_x, area_y, area_width, area_height = area
    width = max(1, int(width))
    height = max(1, int(height))
    margin = max(0, int(margin))

    if isinstance(user_position, (tuple, list)) and not isinstance(bounds, dict) and not isinstance(point, dict):
        x, y = float(user_position[0]), float(user_position[1])
    elif isinstance(bounds, dict):
        try:
            x = float(bounds.get("x", 0)) + float(bounds.get("width", 1)) + 12
            y = float(bounds.get("y", 0))
        except (TypeError, ValueError):
            x, y = area_x + margin, area_y + margin
    elif isinstance(point, dict):
        try:
            x = float(point.get("x", 0)) + 20
            y = float(point.get("y", 0)) + 20
        except (TypeError, ValueError):
            x, y = area_x + margin, area_y + margin
    else:
        if placement in {"top_center", "bottom_center"}:
            x = area_x + (area_width - width) / 2
        elif placement in {"top_left", "bottom_left"}:
            x = area_x + margin
        else:
            x = area_x + area_width - width - margin
        y = area_y + area_height - height - margin if placement in {"bottom_left", "bottom_center", "bottom_right"} else area_y + margin

    avoid = None
    if isinstance(bounds, dict):
        try:
            avoid = (
                float(bounds.get("x", 0)) - 28,
                float(bounds.get("y", 0)) - 28,
                float(bounds.get("width", 1)) + 56,
                float(bounds.get("height", 1)) + 56,
            )
        except (TypeError, ValueError):
            avoid = None
    elif isinstance(point, dict):
        try:
            avoid = (float(point.get("x", 0)) - 52, float(point.get("y", 0)) - 52, 104, 104)
        except (TypeError, ValueError):
            avoid = None

    if avoid is not None:
        avoid_x, avoid_y, avoid_width, avoid_height = avoid

        def overlaps(candidate_x, candidate_y):
            return candidate_x < avoid_x + avoid_width and candidate_x + width > avoid_x and candidate_y < avoid_y + avoid_height and candidate_y + height > avoid_y

        corners = [
            (area_x + margin, area_y + margin),
            (area_x + area_width - width - margin, area_y + margin),
            (area_x + margin, area_y + area_height - height - margin),
            (area_x + area_width - width - margin, area_y + area_height - height - margin),
        ]
        if placement in {"top_left", "bottom_left"}:
            corners = [corners[0], corners[2], corners[1], corners[3]]
        elif placement in {"top_right", "bottom_right"}:
            corners = [corners[1], corners[3], corners[0], corners[2]]
        elif placement == "bottom_center":
            corners = [corners[2], corners[3], corners[0], corners[1]]
        for candidate_x, candidate_y in [(x, y), *corners]:
            if not overlaps(candidate_x, candidate_y):
                x, y = candidate_x, candidate_y
                break

    x = clamp(x, area_x + margin, area_x + area_width - width - margin)
    y = clamp(y, area_y + margin, area_y + area_height - height - margin)
    return int(x), int(y)


def ring_placement(monitors, bounds, pad=28):
    pad = max(0, int(pad))
    width = max(64, int(bounds[2] + 2 * pad))
    height = max(64, int(bounds[3] + 2 * pad))
    monitor = monitors[0] if monitors else (0, 0, 1920, 1080, 1)
    center_x = bounds[0] + bounds[2] / 2
    center_y = bounds[1] + bounds[3] / 2
    for candidate in monitors:
        if candidate[0] <= center_x < candidate[0] + candidate[2] and candidate[1] <= center_y < candidate[1] + candidate[3]:
            monitor = candidate
            break
    monitor_x, monitor_y, monitor_width, monitor_height = monitor[:4]
    x = clamp(int(bounds[0] - pad), int(monitor_x), int(monitor_x + monitor_width - width))
    y = clamp(int(bounds[1] - pad), int(monitor_y), int(monitor_y + monitor_height - height))
    return x, y, width, height
