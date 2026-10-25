/* dlltool.exe - forwards to `zig dlltool` (LLVM's llvm-dlltool).
 *
 * rustc's windows-gnu target shells out to dlltool to synthesise import libraries for
 * `#[link(kind = "raw-dylib")]` declarations. The `windows-link` / `windows-sys` crates
 * use exactly that, so the build cannot proceed without it. Zig makes dlltool
 * available as a subcommand, so no binutils install is needed.
 */
#include <windows.h>
#include <process.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int main(int argc, char **argv) {
    char self[MAX_PATH];
    if (!GetModuleFileNameA(NULL, self, MAX_PATH)) return 127;
    char *slash = strrchr(self, '\\');
    if (slash) *slash = '\0';

    char rel[MAX_PATH * 2];
    snprintf(rel, sizeof rel, "%s\\..\\zig\\ziglang\\zig.exe", self);

    char zig[MAX_PATH];
    if (!GetFullPathNameA(rel, MAX_PATH, zig, NULL) || GetFileAttributesA(zig) == INVALID_FILE_ATTRIBUTES) {
        fprintf(stderr, "dlltool: zig.exe not found at %s\n", rel);
        return 127;
    }

    char **na = (char **)calloc((size_t)argc + 3, sizeof(char *));
    if (!na) return 127;
    int k = 0;
    na[k++] = zig;
    na[k++] = "dlltool";
    for (int i = 1; i < argc; i++) na[k++] = argv[i];
    na[k] = NULL;

    int rc = (int)_spawnv(_P_WAIT, zig, (const char *const *)na);
    free(na);
    return rc == -1 ? 127 : rc;
}
