# PhotoVault - Cloud-Style Photo Gallery (SIWES Project)

A full-stack image gallery inspired by Google Photos, built by **Igogo Ebenezer Akperemi** (Matric No. 20/024145121TR), Department of Computer Science, University of Calabar, during SIWES at ARVY'S Technologies.

**Stack:** Node.js 22, Express, Multer, SQLite3, vanilla HTML/CSS/JavaScript (fetch + async/await).
**Data:** only synthetic sample images are used (`sample-images/`, generated with a fixed random seed). No real personal photos or data.

## Features
Date-grouped timeline, drag-and-drop upload with preview, debounced live search (title, tag, album), album filter, favourites, soft-delete Trash with restore and permanent delete, lightbox with keyboard navigation, metadata editing, storage meter.

## Install and run
```bash
npm install
cp .env.example .env      # PORT, MAX_FILE_SIZE_MB
npm start                 # http://localhost:4000
npm run seed              # (optional, server running) upload the 12 sample images
npm run snapshot          # (optional, server running) refresh outputs/
npm test                  # 27 automated API tests
```

`npm run seed` is **idempotent**: a sample photo that is already in the gallery is
skipped instead of being uploaded twice, and the script then re-applies the fixed
demo state (3 favourites, 2 photos in Trash) so the screenshots stay reproducible.
It expects the server to be running (`BASE_URL` overrides the default
`http://localhost:4000`) and writes `outputs/seed_log.txt`.

`npm run snapshot` refreshes the documentation artifacts from the live server:
`outputs/stats.json` (a snapshot of `/api/photos/stats`) and
`outputs/test_results.txt` (the output of the test suite).

## Demo state

The seeded gallery holds 12 sample photos across 4 albums (Camera, Projects,
Travel, University): 10 in the Photos view, 3 starred as favourites, 2 in Trash.
`outputs/stats.json` is a snapshot of `/api/photos/stats` for that state.

## REST API
| Method | Endpoint | Purpose |
|---|---|---|
| GET | /api/photos?view=all/favorites/trash&album=&search= | List photos |
| GET | /api/photos/stats | Counts, bytes, albums |
| POST | /api/photos | Upload (multipart field `image`) |
| PUT | /api/photos/:id | Edit title/album/tags/description |
| PATCH | /api/photos/:id/favorite | Toggle favourite |
| PATCH | /api/photos/:id/trash | Move to Trash / restore |
| DELETE | /api/photos/:id | Permanent delete (only if in Trash) |

## Deploy to Render

The app is ready to deploy to Render as a Web Service.

**Via Blueprint (fastest):** Render Dashboard → *New* → *Blueprint* → select this
repository. The included `render.yaml` sets the build command, start command,
health check and environment variables for you.

**Via the Dashboard:** *New* → *Web Service* → connect this repository, then:

| Field | Value |
|---|---|
| Runtime | Node |
| Build Command | `npm ci --omit=dev` |
| Start Command | `npm start` |
| Health Check Path | `/api/health` |
| Node version | `22.22.0` (pinned by `.node-version`) |

`PORT` is set automatically by Render, and the server binds to `0.0.0.0`, so no
other configuration is needed. The frontend calls the API with relative URLs,
so it works on any Render domain without a rebuild.

### Storage on Render

Render's filesystem is **ephemeral**: the SQLite database and the uploaded
images are lost on every redeploy and on every free-tier spin-down. Two
behaviours cover this:

- **Auto-seeding** — on boot the server checks whether the gallery holds only
  sample photos (or nothing at all). If so it uploads the 12 sample images and
  re-applies the demo state, so a fresh instance always shows a populated
  gallery instead of an empty grid. A gallery that contains your own uploads
  is left untouched. Set `AUTO_SEED=false` to disable this.
- **Persistent Disk (recommended)** — to keep your uploads across restarts,
  use a paid instance, attach a disk mounted at `/var/data`, and set
  `DATA_DIR=/var/data`. The app then keeps the database and the uploads in that
  folder. The `disk` block in `render.yaml` is ready to uncomment.

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `4000` (`10000` on Render) | Port the server listens on |
| `AUTO_SEED` | `true` | Seed the sample gallery when it is empty |
| `DATA_DIR` | *(unset)* | Folder for the database and uploads (disk mount) |
| `DB_PATH` | `database/photovault.sqlite` | Overrides the database path |
| `UPLOAD_DIR` | `uploads` | Overrides the uploads folder |
| `MAX_FILE_SIZE_MB` | `10` | Maximum upload size |

### Verify a deployment

```bash
npm run verify:render   # boots a fresh instance, checks the auto-seed, static files and images
npm run verify:cli      # checks `npm run seed` and `npm run snapshot` against a running server
```

## Structure
`app.js` (Express app) - `server.js` (listener) - `config.js` (runtime paths) - `database/db.js` - `middleware/` - `routes/photoRoutes.js` - `public/` (frontend) - `tests/api.test.js` - `scripts/seed.js` + `scripts/seed-core.js` - `sample-images/` - `screenshots/` - `outputs/` (test log, stats).

## Security notes
MIME + extension whitelist, magic-byte signature check, size limit, random file names, parameterised SQL, textContent rendering (no innerHTML with user data).

## Fixes applied
- Repeated query parameters (`?album=a&album=b`) and repeated multipart fields are normalised to a single value, so they no longer raise a 500.
- Numeric/boolean metadata is coerced to a string instead of crashing on `.trim()`.
- `PUT /api/photos/:id` is now a true partial update: omitted fields keep their previous value instead of being reset to `General`/empty.
- A blank or whitespace-only title falls back to the uploaded file name.
- `%` and `_` in a search term are treated as literal text (LIKE wildcards are escaped).
- `stats.totalPhotos` now excludes photos sitting in Trash, so it matches the count shown in the Photos view.
- Malformed or empty JSON bodies return 400 instead of 500; multer errors report a specific message.
- The upload form no longer relies on a hidden `required` file input (which silently blocks submission in Chrome) and validates file type and size client-side.
- Frontend blob URLs for the upload preview are revoked instead of leaking.

