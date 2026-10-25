"""Generate src-tauri/icons/icon.ico (no third-party deps).

Needed because tauri-build refuses to build on Windows without an .ico:
  "`icons/icon.ico` not found; required for generating a Windows Resource file"
Run:  python tools/make_icon.py
"""
import struct
import pathlib

SIZE = 64
BG = (11, 110, 79, 255)      # Agent Mark green
FG = (255, 255, 255, 255)
SHADOW = (8, 74, 54, 255)


def pixel(x: int, y: int):
    """Tiny hand-drawn mark: white 'A' bar chart on green."""
    # rounded-ish corners
    if (x < 3 or x > SIZE - 4) and (y < 3 or y > SIZE - 4):
        return (0, 0, 0, 0)
    # baseline
    if 44 <= y <= 49 and 12 <= x <= SIZE - 13:
        return FG
    # three bars of increasing height (records -> results)
    for x0, top in ((14, 36), (27, 27), (40, 18)):
        if top <= y <= 43 and x0 <= x <= x0 + 8:
            return FG
    # shadow line under baseline
    if 50 <= y <= 51 and 12 <= x <= SIZE - 13:
        return SHADOW
    return BG


def main() -> None:
    rows = []
    for y in range(SIZE - 1, -1, -1):  # BMP rows are bottom-up
        row = bytearray()
        for x in range(SIZE):
            row += bytes(pixel(x, y))  # BGRA
        rows.append(bytes(row))
    xor = b"".join(rows)
    mask_row = bytes((SIZE + 31) // 32 * 4)
    and_mask = mask_row * SIZE

    header = struct.pack("<IiiHHIIiiII", 40, SIZE, SIZE * 2, 1, 32, 0, len(xor) + len(and_mask), 0, 0, 0, 0)
    image = header + xor + and_mask

    icondir = struct.pack("<HHH", 0, 1, 1)
    entry = struct.pack("<BBBBHHII", SIZE, SIZE, 0, 0, 1, 32, len(image), 6 + 16)
    out = pathlib.Path(__file__).resolve().parent.parent / "src-tauri" / "icons" / "icon.ico"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(icondir + entry + image)
    print(f"wrote {out} ({out.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
