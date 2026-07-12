/**
 * Spotify proxy for harshrathore.me
 *
 * Routes:
 *   GET /now  — currently playing (falls back to last played) · edge-cached 30s
 *   GET /top  — top artists + tracks, 4-week and 6-month windows · edge-cached 1h
 *
 * Secrets (wrangler secret put): SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, SPOTIFY_REFRESH_TOKEN
 */

const ALLOWED_ORIGINS = [
  "https://harshrathore.me",
  "https://www.harshrathore.me",
  "http://localhost:8420",
  "http://127.0.0.1:8420",
];

function corsHeaders(request) {
  const origin = request.headers.get("Origin") || "";
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    "Vary": "Origin",
  };
}

async function getAccessToken(env) {
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Authorization": "Basic " + btoa(`${env.SPOTIFY_CLIENT_ID}:${env.SPOTIFY_CLIENT_SECRET}`),
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: env.SPOTIFY_REFRESH_TOKEN,
    }),
  });
  if (!res.ok) throw new Error(`token refresh failed: ${res.status}`);
  return (await res.json()).access_token;
}

async function spotify(path, token) {
  const res = await fetch(`https://api.spotify.com/v1${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 204) return null;
  if (!res.ok) throw new Error(`spotify ${path}: ${res.status}`);
  return res.json();
}

const slimTrack = (t) => ({
  name: t.name,
  artists: t.artists.map((a) => a.name).join(", "),
  url: t.external_urls?.spotify,
});

const slimArtist = (a) => ({
  name: a.name,
  genres: (a.genres || []).slice(0, 2),
  url: a.external_urls?.spotify,
});

async function handleNow(env) {
  const token = await getAccessToken(env);
  const current = await spotify("/me/player/currently-playing", token).catch(() => null);
  if (current && current.item && current.is_playing) {
    return { playing: true, track: slimTrack(current.item) };
  }
  const recent = await spotify("/me/player/recently-played?limit=1", token);
  const item = recent?.items?.[0];
  return item
    ? { playing: false, track: slimTrack(item.track), playedAt: item.played_at }
    : { playing: false, track: null };
}

async function handleTop(env) {
  const token = await getAccessToken(env);
  const [a4, a6, t4, t6] = await Promise.all([
    spotify("/me/top/artists?time_range=short_term&limit=5", token),
    spotify("/me/top/artists?time_range=medium_term&limit=5", token),
    spotify("/me/top/tracks?time_range=short_term&limit=5", token),
    spotify("/me/top/tracks?time_range=medium_term&limit=5", token),
  ]);
  return {
    artists: { "4w": a4.items.map(slimArtist), "6m": a6.items.map(slimArtist) },
    tracks: { "4w": t4.items.map(slimTrack), "6m": t6.items.map(slimTrack) },
  };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const cors = corsHeaders(request);
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });

    const route = url.pathname.replace(/\/$/, "");
    const ttl = route === "/now" ? 30 : 3600;
    if (route !== "/now" && route !== "/top") {
      return new Response(JSON.stringify({ error: "not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json", ...cors },
      });
    }

    const cache = caches.default;
    const cacheKey = new Request(`https://cache${route}`, { method: "GET" });
    const hit = await cache.match(cacheKey);
    if (hit) {
      const body = await hit.text();
      return new Response(body, { headers: { "Content-Type": "application/json", ...cors } });
    }

    try {
      const data = route === "/now" ? await handleNow(env) : await handleTop(env);
      const body = JSON.stringify(data);
      ctx.waitUntil(
        cache.put(
          cacheKey,
          new Response(body, {
            headers: { "Content-Type": "application/json", "Cache-Control": `s-maxage=${ttl}` },
          })
        )
      );
      return new Response(body, { headers: { "Content-Type": "application/json", ...cors } });
    } catch (e) {
      return new Response(JSON.stringify({ error: String(e.message || e) }), {
        status: 502,
        headers: { "Content-Type": "application/json", ...cors },
      });
    }
  },
};
