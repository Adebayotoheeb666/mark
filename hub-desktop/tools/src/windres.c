/* windres.exe - drop-in replacement for MinGW windres, backed by `zig rc` (llvm-rc).
 *
 * tauri-build -> embed-resource looks for windres on PATH for the windows-gnu target and
 * invokes it as:
 *     windres --input <resource.rc> --output <out_file> --include-dir <dir>
 *             --output-format=coff [-D MACRO] [-I DIR]...
 *
 * There is no MinGW binutils on this machine, so this shim translates that command line to
 * the rc.exe-compatible syntax implemented by Zig (`zig rc`), then writes the resulting
 * .res file to the requested output path.
 *
 * Why not a COFF object? rustc/embed-resource expect a linker input, and Zig's linker
 * accepts Windows .res files natively - but only when the file carries the .res extension.
 * So the output here is a real .res with a .a name, and tools/src/zigcc.c detects it by
 * magic bytes and passes it to Zig as a .res. That keeps the icon, version info and (most
 * importantly) the common-controls v6 manifest that the Windows subsystem needs - without
 * it, comctl32!TaskDialogIndirect is missing and the exe dies with 0xC0000139
 * (STATUS_ENTRYPOINT_NOT_FOUND) before the first window appears.
 */
#include <windows.h>
#include <process.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define MAX_ARGS 64

int main(int argc, char **argv) {
    const char *input = NULL;
    const char *output = NULL;
    const char *incdirs[MAX_ARGS];
    const char *macros[MAX_ARGS];
    int ninc = 0, nmac = 0;

    for (int i = 1; i < argc; i++) {
        if ((strcmp(argv[i], "--input") == 0 || strcmp(argv[i], "-i") == 0) && i + 1 < argc) {
            input = argv[++i];
        } else if ((strcmp(argv[i], "--output") == 0 || strcmp(argv[i], "-o") == 0) && i + 1 < argc) {
            output = argv[++i];
        } else if ((strcmp(argv[i], "--include-dir") == 0 || strcmp(argv[i], "-I") == 0) && i + 1 < argc) {
            if (ninc < MAX_ARGS) incdirs[ninc++] = argv[++i];
        } else if (strncmp(argv[i], "-I", 2) == 0 && argv[i][2]) {
            if (ninc < MAX_ARGS) incdirs[ninc++] = argv[i] + 2;
        } else if ((strcmp(argv[i], "-D") == 0 || strcmp(argv[i], "--define") == 0) && i + 1 < argc) {
            if (nmac < MAX_ARGS) macros[nmac++] = argv[++i];
        } else if (strncmp(argv[i], "-D", 2) == 0 && argv[i][2]) {
            if (nmac < MAX_ARGS) macros[nmac++] = argv[i] + 2;
        }
        /* --output-format=coff, --target=pe-x86-64, -c <codepage>, etc. need no translation:
         * `zig rc` always emits a .res, and the codepage is set by #pragma in the .rc. */
    }

    if (!input || !output) {
        fprintf(stderr, "windres: expected --input <file.rc> --output <file>\n");
        return 1;
    }

    char self[MAX_PATH];
    if (!GetModuleFileNameA(NULL, self, MAX_PATH)) return 127;
    char *slash = strrchr(self, '\\');
    if (slash) *slash = '\0';

    char rel[MAX_PATH * 2];
    snprintf(rel, sizeof rel, "%s\\..\\zig\\ziglang\\zig.exe", self);

    char zig[MAX_PATH];
    if (!GetFullPathNameA(rel, MAX_PATH, zig, NULL) || GetFileAttributesA(zig) == INVALID_FILE_ATTRIBUTES) {
        fprintf(stderr, "windres: zig.exe not found at %s\n", rel);
        return 127;
    }

    char tmpdir[MAX_PATH];
    if (!GetTempPathA(MAX_PATH, tmpdir)) return 127;
    char res[MAX_PATH];
    snprintf(res, sizeof res, "%swindres-%lu.res", tmpdir, (unsigned long)GetCurrentProcessId());

    char **na = (char **)calloc((size_t)(ninc + nmac) * 2 + 8, sizeof(char *));
    if (!na) return 127;
    int k = 0;
    na[k++] = zig;
    na[k++] = "rc";
    na[k++] = "/fo";
    na[k++] = res;
    for (int i = 0; i < ninc; i++) {
        na[k++] = "/I";
        na[k++] = (char *)incdirs[i];
    }
    for (int i = 0; i < nmac; i++) {
        na[k++] = "/d";
        na[k++] = (char *)macros[i];
    }
    na[k++] = (char *)input;
    na[k] = NULL;

    if (getenv("AGM_ZIG_DEBUG")) {
        for (int i = 0; i < k; i++) fprintf(stderr, "[windres] %s\n", na[i]);
    }

    int rc = (int)_spawnv(_P_WAIT, zig, (const char *const *)na);
    if (rc != 0) {
        fprintf(stderr, "windres: `zig rc` failed with %d for %s\n", rc, input);
        DeleteFileA(res);
        return rc;
    }

    if (!CopyFileA(res, output, FALSE)) {
        fprintf(stderr, "windres: cannot write %s (error %lu)\n", output, GetLastError());
        DeleteFileA(res);
        return 1;
    }
    DeleteFileA(res);
    return 0;
}
