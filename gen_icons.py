"""Generate Neo-Brutalist icons for JobHub extension."""
from PIL import Image, ImageDraw

SIZES = [16, 32, 48, 128]
BLACK = (0, 0, 0)
WHITE = (255, 255, 255)
YELLOW = (255, 204, 0)
PINK = (255, 0, 110)
GREEN = (0, 212, 170)
BLUE = (51, 102, 255)


def draw_icon(size, output_path):
    """Draw a Neo-Brutalist job-hub icon: bold geometric document + checkmark."""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Border width scales with size
    border = max(2, size // 24)
    # Inner margin
    margin = border + max(1, size // 64)

    # 1. Yellow background rectangle with black border
    bg_box = [border, border, size - border, size - border]
    draw.rectangle(bg_box, fill=YELLOW, outline=BLACK, width=border)

    # 2. Inner white document shape
    doc_margin = size // 6
    doc_width = size * 0.4
    doc_height = size * 0.55
    doc_x = (size - doc_width * 1.3) // 2 + size * 0.08
    doc_y = (size - doc_height) // 2 + size * 0.02
    doc_box = [
        doc_x,
        doc_y,
        doc_x + doc_width,
        doc_y + doc_height,
    ]
    draw.rectangle(doc_box, fill=WHITE, outline=BLACK, width=max(1, border // 2))

    # 3. Document "fold" triangle (top-right corner)
    fold_size = size * 0.12
    fold_points = [
        (doc_x + doc_width - fold_size, doc_y),
        (doc_x + doc_width, doc_y + fold_size),
        (doc_x + doc_width - fold_size, doc_y + fold_size),
    ]
    draw.polygon(fold_points, fill=BLACK)

    # 4. Document "lines" (horizontal black bars)
    bar_margin = doc_x + size * 0.06
    bar_width = doc_width * 0.6
    bar_height = max(1, size // 48)
    bar_gap = size // 16

    for i in range(2):
        bar_y = doc_y + size * 0.14 + i * bar_gap
        draw.rectangle(
            [bar_margin, bar_y, bar_margin + bar_width, bar_y + bar_height],
            fill=BLACK,
        )

    # 5. Bold checkmark in pink (bottom-right overlap)
    check_size = size * 0.22
    check_x = size * 0.55
    check_y = size * 0.55
    # Draw checkmark as filled polygon
    import math

    cx, cy = check_x, check_y
    # Thick checkmark: two overlapping triangles
    # Point 1: top of check
    pts = [
        (cx - check_size * 0.1, cy + check_size * 0.05),   # left end
        (cx + check_size * 0.15, cy + check_size * 0.25),   # bend point
        (cx + check_size * 0.55, cy - check_size * 0.25),   # right top
        (cx + check_size * 0.55, cy - check_size * 0.40),   # right top outer
        (cx + check_size * 0.05, cy + check_size * 0.04),   # bend outer
        (cx - check_size * 0.25, cy - check_size * 0.18),   # left end outer
    ]
    draw.polygon(pts, fill=PINK, outline=BLACK, width=max(1, border // 3))

    # Resize for smaller icons (draw at 128 then scale down for better anti-aliasing)
    img.save(output_path, "PNG")


if __name__ == "__main__":
    import os

    output_dir = os.path.join(os.path.dirname(__file__), "icons")
    os.makedirs(output_dir, exist_ok=True)

    # Generate at 128 first, then scale down for smaller sizes
    master = Image.new("RGBA", (128, 128), (0, 0, 0, 0))
    draw_icon(128, os.path.join(output_dir, "icon128.png"))

    # Re-draw at 128 then resize
    master = Image.open(os.path.join(output_dir, "icon128.png"))
    for size in [48, 32, 16]:
        resized = master.resize((size, size), Image.LANCZOS)
        resized.save(os.path.join(output_dir, f"icon{size}.png"), "PNG")

    print("Icons generated: icon16.png, icon32.png, icon48.png, icon128.png")
