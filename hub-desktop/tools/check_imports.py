"""Report PE imports of a built .exe and verify each one exists in the system DLL.

Usage: python tools/check_imports.py <path-to-exe>
Exit code 0 = every import resolved; 1 = missing symbols (Windows would fail with
0xC0000139 STATUS_ENTRYPOINT_NOT_FOUND) or a missing DLL (0xC0000135).
"""
import os
import sys

import pefile


def main() -> int:
    exe = sys.argv[1] if len(sys.argv) > 1 else None
    if not exe or not os.path.exists(exe):
        print("usage: check_imports.py <exe>")
        return 2

    pe = pefile.PE(exe, fast_load=True)
    pe.parse_data_directories(
        directories=[pefile.DIRECTORY_ENTRY["IMAGE_DIRECTORY_ENTRY_IMPORT"]]
    )

    problems = []
    for entry in getattr(pe, "DIRECTORY_ENTRY_IMPORT", []):
        dll = entry.dll.decode()
        search = [os.path.join(r"C:\Windows\System32", dll), os.path.join(os.path.dirname(exe), dll)]
        path = next((p for p in search if os.path.exists(p)), None)
        if path is None:
            print(f"  {dll}: NOT FOUND on system or next to exe")
            problems.append(f"{dll} (missing DLL)")
            continue
        target = pefile.PE(path, fast_load=True)
        target.parse_data_directories(
            directories=[pefile.DIRECTORY_ENTRY["IMAGE_DIRECTORY_ENTRY_EXPORT"]]
        )
        exports = set()
        if hasattr(target, "DIRECTORY_ENTRY_EXPORT"):
            exports = {s.name.decode() for s in target.DIRECTORY_ENTRY_EXPORT.symbols if s.name}
        bad = [imp.name.decode() for imp in entry.imports if imp.name and imp.name.decode() not in exports]
        if bad:
            print(f"  {dll}: {len(bad)} missing of {len(entry.imports)}")
            problems += [f"{dll}!{b}" for b in bad]
        else:
            print(f"  {dll}: ok ({len(entry.imports)} imports)")

    print()
    if problems:
        print("MISSING:")
        for p in problems:
            print(f"  {p}")
        return 1
    print("all imports resolved")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
