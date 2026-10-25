/* zigcc.exe - forwards every argument to `zig cc -target x86_64-windows-gnu`.
 *
 * Why this exists: this PC has no MSVC linker and no MinGW toolchain (and the
 * Microsoft/GitHub download hosts are unusably slow here). Zig ships a complete
 * compiler + MinGW-w64 headers/import libraries, so Rust's windows-gnu target can
 * be linked end to end with nothing but this ~50MB toolchain.
 *
 * Cargo is pointed at this binary via hub-desktop/.cargo/config.toml and via
 * CC_x86_64_pc_windows_gnu for C dependencies (bundled SQLite).
 *
 * Four incompatibilities between rustc's GNU link line and Zig's cc driver are
 * papered over here (each verified against rustc 1.99 / zig 0.16):
 *
 *   1. rustc passes most arguments in an `@response-file`. Zig does not expand it the
 *      way rustc intends for these rewrites, so we expand it ourselves first.
 *   2. `-nodefaultlibs`: Zig's MinGW sysroot is built on demand, so with this flag there
 *      are no library search paths at all and even `-lmsvcrt` fails ("searched paths:
 *      none"). Dropped - Zig supplies the CRT and libc itself.
 *   3. `-lmsvcrt` cannot be resolved by name (Zig only links it implicitly), and
 *      `-l:libpthread.a` crashes zig 0.16's linker outright. Both dropped; `-lc` is
 *      injected instead, which registers Zig's libc search paths. Windows-gnu std uses
 *      Win32 threads, so no pthread symbols are actually required.
 *   4. Proc-macro crates are DLLs: rustc exports their entry points with
 *      `-Wl,<tmp>\list.def`. Zig rejects a .def inside -Wl, but accepts it as a
 *      positional input, so the prefix is stripped.
 *   5. cc-rs passes rustc's triple spelling (`--target=x86_64-pc-windows-gnu`); Zig only
 *      parses `x86_64-windows-gnu` and aborts with "UnknownOperatingSystem". The
 *      duplicate flag is dropped since the correct target is set here.
 */
#include <windows.h>
#include <process.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct {
    char **v;
    int n;
    int cap;
} Args;

static void args_init(Args *a, int cap) {
    a->v = (char **)calloc((size_t)cap, sizeof(char *));
    a->n = 0;
    a->cap = cap;
}

static void args_push(Args *a, char *s) {
    if (a->n + 1 >= a->cap) {
        a->cap = a->cap ? a->cap * 2 : 64;
        a->v = (char **)realloc(a->v, (size_t)a->cap * sizeof(char *));
        if (!a->v) { fprintf(stderr, "zigcc: out of memory\n"); exit(127); }
    }
    a->v[a->n++] = s;
    a->v[a->n] = NULL;
}

/* Split a rustc/LLVM response file: whitespace separated, double quotes group,
 * backslash escapes a following quote (CommandLineToArgvW rules). */
static void expand_response(const char *path, Args *out) {
    FILE *f = fopen(path, "rb");
    if (!f) {
        fprintf(stderr, "zigcc: cannot read response file %s\n", path);
        exit(127);
    }
    fseek(f, 0, SEEK_END);
    long len = ftell(f);
    fseek(f, 0, SEEK_SET);
    char *buf = (char *)malloc((size_t)len + 1);
    if (!buf) { fclose(f); exit(127); }
    size_t got = fread(buf, 1, (size_t)len, f);
    fclose(f);
    buf[got] = '\0';

    char *p = buf;
    while (*p) {
        while (*p == ' ' || *p == '\t' || *p == '\r' || *p == '\n') p++;
        if (!*p) break;
        char *token = p;
        if (*p == '"') {
            p++;
            token = p;
            while (*p && *p != '"') {
                if (*p == '\\' && p[1] == '"') { p++; }
                p++;
            }
            if (*p == '"') { *p = '\0'; p++; }
        } else {
            while (*p && *p != ' ' && *p != '\t' && *p != '\r' && *p != '\n') p++;
            if (*p) { *p = '\0'; p++; }
        }
        args_push(out, token);
    }
    /* buf is intentionally leaked: tokens point into it and live until exit. */
}

static int ends_with_def(const char *s) {
    size_t n = strlen(s);
    return n > 4 && _stricmp(s + n - 4, ".def") == 0;
}

static int ends_with_ci(const char *s, const char *suffix) {
    size_t n = strlen(s), m = strlen(suffix);
    return n >= m && _stricmp(s + n - m, suffix) == 0;
}

/* Windows .res files start with: reserved DWORD 0, then header size 0x20. */
static int is_res_file(const char *path) {
    FILE *f = fopen(path, "rb");
    if (!f) return 0;
    unsigned char b[8] = {0};
    size_t n = fread(b, 1, sizeof b, f);
    fclose(f);
    return n == 8 && b[0] == 0 && b[1] == 0 && b[2] == 0 && b[3] == 0 &&
           b[4] == 0x20 && b[5] == 0 && b[6] == 0 && b[7] == 0;
}

int main(int argc, char **argv) {
    char self[MAX_PATH];
    if (!GetModuleFileNameA(NULL, self, MAX_PATH)) {
        fprintf(stderr, "zigcc: cannot locate own executable\n");
        return 127;
    }
    char *slash = strrchr(self, '\\');
    if (slash) *slash = '\0';

    char rel[MAX_PATH * 2];
    snprintf(rel, sizeof rel, "%s\\..\\zig\\ziglang\\zig.exe", self);

    char zig[MAX_PATH];
    if (!GetFullPathNameA(rel, MAX_PATH, zig, NULL) || GetFileAttributesA(zig) == INVALID_FILE_ATTRIBUTES) {
        fprintf(stderr, "zigcc: zig.exe not found at %s\n", rel);
        return 127;
    }

    /* 1. Expand @response-files. */
    Args in;
    args_init(&in, argc + 32);
    for (int i = 1; i < argc; i++) {
        if (argv[i][0] == '@') {
            expand_response(argv[i] + 1, &in);
        } else if (ends_with_def(argv[i]) && strncmp(argv[i], "-Wl,", 4) == 0) {
            args_push(&in, argv[i] + 4); /* rewrite even outside a response file */
        } else {
            args_push(&in, argv[i]);
        }
    }

    /* 2. Decide whether this is a link step. */
    int linking = 1;
    for (int i = 0; i < in.n; i++) {
        if (strcmp(in.v[i], "-c") == 0 || strcmp(in.v[i], "-E") == 0) { linking = 0; break; }
    }

    /* 3. Build the final zig command line, filtering the incompatible flags. */
    Args out;
    args_init(&out, in.n + 8);
    args_push(&out, zig);
    args_push(&out, "cc");
    args_push(&out, "-target");
    args_push(&out, "x86_64-windows-gnu");
    if (linking) args_push(&out, "-lc");
    /* Collect -L directories so library names with an extension can be resolved. */
    char *ldirs[64];
    int nldirs = 0;
    for (int i = 0; i < in.n && nldirs < 64; i++) {
        if (strcmp(in.v[i], "-L") == 0 && i + 1 < in.n) {
            ldirs[nldirs++] = in.v[i + 1];
        } else if (strncmp(in.v[i], "-L", 2) == 0 && in.v[i][2]) {
            ldirs[nldirs++] = in.v[i] + 2;
        }
    }

    /* Resource object from our windres shim: a real .res wearing a .a name. Zig links .res
     * happily, but classifies inputs by extension, so hand it a copy named .res. */
    char res_tmp[MAX_PATH] = {0};

    for (int i = 0; i < in.n; i++) {
        char *a = in.v[i];
        if (strcmp(a, "-nodefaultlibs") == 0) continue;
        if (strcmp(a, "-lmsvcrt") == 0) continue;
        if (strcmp(a, "-l:libpthread.a") == 0) continue;

        if (!res_tmp[0] && ends_with_ci(a, ".a") && is_res_file(a)) {
            char tmpdir[MAX_PATH];
            if (GetTempPathA(MAX_PATH, tmpdir)) {
                snprintf(res_tmp, sizeof res_tmp, "%szigcc-res-%lu.res", tmpdir,
                         (unsigned long)GetCurrentProcessId());
                if (CopyFileA(a, res_tmp, FALSE)) {
                    args_push(&out, res_tmp);
                    continue;
                }
                res_tmp[0] = '\0';
            }
        }

        /* rustc links WebView2 as `-lWebView2Loader.dll` (the crate declares the DLL name).
         * Zig appends its own suffix and looks for "WebView2Loader.dll.dll". The crate ships
         * the matching MSVC import library as <name>.lib next to -L dirs, so link that. */
        if (strncmp(a, "-l", 2) == 0 && strstr(a + 2, ".dll")) {
            const char *name = a + 2;
            int resolved = 0;
            for (int j = 0; j < nldirs; j++) {
                char cand[MAX_PATH];
                snprintf(cand, sizeof cand, "%s\\%s.lib", ldirs[j], name);
                if (GetFileAttributesA(cand) != INVALID_FILE_ATTRIBUTES) {
                    args_push(&out, _strdup(cand));
                    resolved = 1;
                    break;
                }
            }
            if (resolved) continue;
        }

        /* cc-rs adds rustc's triple (x86_64-pc-windows-gnu). Zig only understands its own
         * spelling (x86_64-windows-gnu) and dies with "UnknownOperatingSystem", so drop
         * the duplicate - we already passed the right one above. */
        if (strncmp(a, "--target=", 9) == 0 && strstr(a, "windows-gnu")) continue;
        if (strcmp(a, "--target") == 0 && i + 1 < in.n && strstr(in.v[i + 1], "windows-gnu")) { i++; continue; }

        if (strncmp(a, "-Wl,", 4) == 0 && ends_with_def(a)) {
            args_push(&out, a + 4);
            continue;
        }
        args_push(&out, a);
    }

    if (getenv("AGM_ZIG_DEBUG")) {
        for (int i = 0; i < out.n; i++) fprintf(stderr, "[zigcc] %s\n", out.v[i]);
    }

    const char *dump = getenv("AGM_ZIG_DUMP");
    if (dump && *dump) {
        FILE *df = fopen(dump, "a");
        if (df) {
            fprintf(df, "-----BEGIN %d\n", out.n);
            for (int i = 0; i < out.n; i++) fprintf(df, "%s\n", out.v[i]);
            fprintf(df, "-----END\n");
            fclose(df);
        }
    }

    /* Windows caps a process command line at 32767 characters. A Tauri link pulls in
     * hundreds of .rlib paths, so expand-then-spawn blows that limit. Zig accepts @file,
     * so long command lines are handed over in a temp response file instead. */
    size_t total = 0;
    for (int i = 0; i < out.n; i++) total += strlen(out.v[i]) + 3;
    char rsp[MAX_PATH] = {0};
    if (total > 8000) {
        char tmpdir[MAX_PATH];
        if (GetTempPathA(MAX_PATH, tmpdir)) {
            snprintf(rsp, sizeof rsp, "%szigcc-%lu.rsp", tmpdir, (unsigned long)GetCurrentProcessId());
            FILE *f = fopen(rsp, "wb");
            if (f) {
                /* out.v[0] is zig.exe and out.v[1] is the "cc" subcommand: both are passed
                 * explicitly on the short command line, so the response file starts at 2. */
                for (int i = 2; i < out.n; i++) {
                    const char *a = out.v[i];
                    if (strchr(a, ' ') || strchr(a, '\t')) {
                        fprintf(f, "\"%s\"\n", a);
                    } else {
                        fprintf(f, "%s\n", a);
                    }
                }
                fclose(f);
                Args shortv;
                args_init(&shortv, 8);
                args_push(&shortv, zig);
                args_push(&shortv, "cc");
                args_push(&shortv, "-target");
                args_push(&shortv, "x86_64-windows-gnu");
                if (linking) args_push(&shortv, "-lc");
                static char at[MAX_PATH + 2];
                snprintf(at, sizeof at, "@%s", rsp);
                args_push(&shortv, at);
                int rc = (int)_spawnv(_P_WAIT, zig, (const char *const *)shortv.v);
                DeleteFileA(rsp);
                if (res_tmp[0]) DeleteFileA(res_tmp);
                if (rc == -1) {
                    perror("zigcc: _spawnv");
                    return 127;
                }
                return rc;
            }
        }
    }

    int rc = (int)_spawnv(_P_WAIT, zig, (const char *const *)out.v);
    if (res_tmp[0]) DeleteFileA(res_tmp);
    if (rc == -1) {
        perror("zigcc: _spawnv");
        return 127;
    }
    return rc;
}
