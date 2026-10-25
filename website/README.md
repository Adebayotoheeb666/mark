# Agent Mark — download website

Static site. No framework, no build step, no serverless functions, no analytics, no
third-party requests. Everything is HTML/CSS/JS plus the two Windows artifacts.

## Deploy to Vercel

### Option A — dashboard

1. Push this folder to a Git repository (GitHub/GitLab/Bitbucket).
2. Vercel → **Add New → Project** → import the repo.
3. Set **Root Directory** to `website`.
4. Framework Preset: **Other**. Build Command: *(empty)*. Output Directory: `.`.
5. Deploy.

`vercel.json` supplies the security headers, the cache policy for `/assets` and `/downloads`,
and the correct `Content-Type` for `manifest.webmanifest`. Nothing else is needed.

### Option B — CLI

```powershell
npm i -g vercel
cd website
vercel            # preview deployment
vercel --prod     # production
```

No `package.json` is required; Vercel treats the directory as static files.

### After the first deploy

- The live production alias is `https://mark-tau-wheat.vercel.app/`, already used in
  `sitemap.xml` and `robots.txt`. If a custom domain replaces it, update both files (or delete
  them if the site should not be indexed).
- Keep **Root Directory** set to `website`. Changing it only affects *new* deployments, so
  redeploy after saving — otherwise `/` serves the repo root and returns Vercel's 404.
- If a custom domain is attached, add it in Vercel → Settings → Domains. No code change is
  needed; every internal link is relative.

## Publishing a new release

Do **not** hand-edit hashes in `download.html`. The page fetches `version.json` at load time
and fills every size, full hash, short hash and copy button from it.

```powershell
# from the repo root
.\scripts\release.cmd                     # build + bundle + stage + stamp
cd website
vercel --prod
```

`release.ps1` copies these two files into `downloads/` with stable names:

```
downloads/Agent-Mark-Hub-<version>-x64-setup.exe
downloads/Agent-Mark-Hub-<version>-windows-x64-portable.zip
```

and then `scripts/stamp_release.py` rewrites `version.json` and `downloads/SHA256SUMS.txt`
from the actual bytes. Commit the artifacts and the manifest together so the published
checksums always describe the published files.

## What each file is

| Path | Purpose |
| --- | --- |
| `index.html` | Landing page: what it is, the no-AI/offline/privacy claims, screenshots |
| `download.html` | Installer, portable ZIP, mobile app, live checksums |
| `install.html` | Install → first ten minutes → uninstall → troubleshooting |
| `privacy.html` | Data locations, encrypted backups, signature verification, pilot gate |
| `404.html` | Not-found page (Vercel serves it automatically) |
| `app/` | Installable mobile companion (PWA), its manifest and service worker |
| `assets/` | Shared CSS/JS, logo, OG image, real screenshots captured from the app |
| `downloads/` | Windows artifacts + `SHA256SUMS.txt` |
| `version.json` | Release manifest read by the download page |
| `vercel.json` | Headers/caching/CSP |
| `robots.txt`, `sitemap.xml` | Indexing hints |

## Local check

```powershell
cd website
python -m http.server 8899
# http://127.0.0.1:8899/
```

The service worker and the install prompt need `http://localhost` or HTTPS; opening
`app/index.html` as a `file://` URL will not register the worker.

## Mobile app notes

- `app/sw.js` caches the shell under `agentmark-app-v4`. When `app.js`, `app.css` or
  `app/index.html` change, bump **both** the cache name and the `?v=` query in
  `app/index.html` (and in `sw.js`'s asset list), otherwise installed copies keep the old shell.
- The PWA stores data in `localStorage` under `agentmark.mobile.v1`. It never talks to the hub
  and never sends anything over the network. The site's CSP (`connect-src 'self'`) keeps it
  that way even if a bug tried.
- The install button only appears when the browser fires `beforeinstallprompt`; on iOS use
  Safari → Share → **Add to Home Screen**.

## Privacy posture of the site itself

- No cookies, no localStorage on the marketing pages, no analytics, no fonts or scripts from
  other origins.
- The only network requests are for files on this origin (plus the download itself).
- Student data never touches this site. The desktop app has no telemetry; the mobile app is
  local-only.
