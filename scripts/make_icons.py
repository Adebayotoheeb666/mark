"""Generate the PWA icons and the Open Graph image with Pillow.

Run from the repo root:
    python scripts/make_icons.py

Outputs:
    website/app/icons/icon-192.png
    website/app/icons/icon-512.png
    website/app/icons/maskable-512.png
    website/app/icons/apple-touch-icon.png
    website/assets/og.png
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
ICONS = ROOT / "website" / "app" / "icons"
ASSETS = ROOT / "website" / "assets"

GREEN = (20, 83, 45)
GREEN_2 = (28, 107, 60)
CREAM = (247, 245, 239)
MINT = (167, 215, 179)
PAPER = (247, 245, 239)
INK = (19, 26, 23)
INK_2 = (61, 74, 68)
MUTED = (107, 122, 115)

FONTS = Path(r"C:\Windows\Fonts")


def font(name: str, size: int) -> ImageFont.FreeTypeFont:
    path = FONTS / name
    if path.exists():
        return ImageFont.truetype(str(path), size)
    return ImageFont.load_default(size=size)


def mark(size: int, *, maskable: bool = False, radius_ratio: float = 0.22) -> Image.Image:
    """The Agent Mark glyph: a ledger page with a verified check."""
    scale = 2
    s = size * scale
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    if maskable:
        d.rectangle([0, 0, s, s], fill=GREEN)
    else:
        d.rounded_rectangle([0, 0, s - 1, s - 1], radius=int(s * radius_ratio), fill=GREEN)

    # Maskable icons keep artwork inside the central 80% safe zone.
    k = 0.80 if maskable else 1.0
    cx, cy = s / 2, s / 2

    def T(x: float, y: float) -> tuple[float, float]:
        return (cx + (x - 0.5) * s * k, cy + (y - 0.5) * s * k)

    def box(x0: float, y0: float, x1: float, y1: float) -> list[float]:
        a, b = T(x0, y0)
        c, e = T(x1, y1)
        return [a, b, c, e]

    # Page
    d.rounded_rectangle(box(0.24, 0.21, 0.62, 0.80), radius=int(s * 0.04 * k),
                        outline=CREAM, width=max(2, int(s * 0.032 * k)))
    # Ruled lines
    for y, x1 in ((0.37, 0.52), (0.46, 0.48)):
        d.line([T(0.31, y), T(x1, y)], fill=CREAM + (150,), width=max(2, int(s * 0.024 * k)))
    # Verification badge
    bx, by = T(0.71, 0.72)
    r = s * 0.15 * k
    d.ellipse([bx - r, by - r, bx + r, by + r], fill=MINT)
    d.line([(bx - r * 0.42, by + r * 0.02), (bx - r * 0.08, by + r * 0.36), (bx + r * 0.46, by - r * 0.30)],
           fill=GREEN, width=max(3, int(s * 0.034 * k)), joint="curve")

    return img.resize((size, size), Image.LANCZOS)


def og_image() -> Image.Image:
    W, H = 1200, 630
    img = Image.new("RGB", (W, H), PAPER)
    d = ImageDraw.Draw(img)

    # Soft bands
    d.rectangle([0, 0, W, 8], fill=GREEN)
    d.rectangle([0, H - 8, W, H], fill=GREEN)

    # Brand lockup
    icon = mark(96)
    img.paste(icon, (72, 62), icon)
    d.text((186, 74), "Agent Mark", font=font("georgiab.ttf", 42), fill=INK)
    d.text((188, 122), "SCHOOL RECORDS", font=font("segoeuib.ttf", 15), fill=MUTED)

    # Headline
    headline = font("georgiab.ttf", 62)
    d.text((72, 214), "Report cards that", font=headline, fill=INK)
    d.text((72, 288), "never leave the school.", font=headline, fill=INK)

    # Sub
    d.text((74, 392), "Offline records, deterministic validation, two-person", font=font("segoeui.ttf", 25), fill=INK_2)
    d.text((74, 426), "approval and signed report cards. No AI. No cloud.", font=font("segoeui.ttf", 25), fill=INK_2)

    # Pills
    pills = ["NO AI", "NO CLOUD", "WINDOWS 10/11", "OPEN SOURCE RULES"]
    x = 74
    pf = font("segoeuib.ttf", 15)
    for text in pills:
        tw = d.textlength(text, font=pf)
        d.rounded_rectangle([x, 492, x + tw + 32, 532], radius=20, fill=(231, 240, 232))
        d.text((x + 16, 501), text, font=pf, fill=GREEN)
        x += tw + 32 + 12

    # Big mark on the right
    big = mark(360)
    img.paste(big, (790, 150), big)

    return img


def main() -> None:
    ICONS.mkdir(parents=True, exist_ok=True)
    ASSETS.mkdir(parents=True, exist_ok=True)

    mark(512).save(ICONS / "icon-512.png")
    mark(192).save(ICONS / "icon-192.png")
    mark(512, maskable=True).save(ICONS / "maskable-512.png")
    mark(180, radius_ratio=0.0).save(ICONS / "apple-touch-icon.png")
    og_image().save(ASSETS / "og.png", optimize=True)

    for p in sorted(ICONS.glob("*.png")) + [ASSETS / "og.png"]:
        print(f"{p.relative_to(ROOT)}  {p.stat().st_size / 1024:.1f} KB")


if __name__ == "__main__":
    main()
