# harshrathore.me

Terminal-style personal site — live at **[harshrathore.me](https://harshrathore.me)**.

- One HTML file, inline CSS/JS. No framework, no build step.
- Boot animation types out each section as a shell command; the prompt at the
  bottom is a real mini-CLI (`help`, `about`, `work`, `projects`, `travel`,
  `music`, `sudo hire-me`…).
- Live "now playing" via a Cloudflare Worker (`worker/`) proxying the Spotify API.
- Dot-matrix travel maps generated from GeoJSON (`assets/map-*.svg`).

Deployed by GitHub Pages from `master`.

## Run locally

```console
python3 -m http.server 8420
open http://localhost:8420
```
