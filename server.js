
import express from "express";
import axios from "axios";
import dotenv from "dotenv";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const SAAVN_API_BASE = "https://www.jiosaavn.com/api.php";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
app.disable("x-powered-by");

function cleanText(value = "") {
  return String(value)
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

// Decrypt the media URL returned by the JioSaavn response.
function decryptMediaUrl(encryptedUrl) {
  if (!encryptedUrl) return null;

  try {
    const key = Buffer.from("383465913834659138346591", "utf8");
    const decipher = crypto.createDecipheriv(
      "des-ede3-ecb",
      key,
      null
    );

    decipher.setAutoPadding(true);

    let decrypted = decipher.update(
      encryptedUrl,
      "base64",
      "utf8"
    );

    decrypted += decipher.final("utf8");

    return decrypted.replace(
      /_(?:48|96|160|320)\.(mp4|m4a)/i,
      "_320.mp4"
    );
  } catch (error) {
    console.error("Media URL decryption failed:", error.message);
    return null;
  }
}

function normalize(track) {
  const image = String(track.image || "")
    .replace(/^http:/i, "https:");

  const streamUrl = decryptMediaUrl(track.encrypted_media_url);

  return {
    id: String(track.id || ""),
    title: cleanText(track.song || track.title || "Untitled"),
    artist: cleanText(
      track.primary_artists ||
      track.singers ||
      "Unknown artist"
    ),
    album: cleanText(track.album || ""),
    artwork: image.replace(/150x150|50x50/g, "500x500"),
    duration: Math.max(0, Number(track.duration) || 0),
    genre: "Music",
    permalink: String(track.perma_url || ""),
    streamable: Boolean(streamUrl),
    streamUrl
  };
}

async function saavnGet(params) {
  const response = await axios.get(SAAVN_API_BASE, {
    params: {
      _format: "json",
      _marker: "0",
      ctx: "web6dot0",
      ...params
    },
    headers: {
      Accept: "application/json",
      Cookie: "L=english;",
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36"
    },
    timeout: 15000
  });

  if (!response.data || typeof response.data !== "object") {
    throw new Error("Unexpected response from JioSaavn.");
  }

  return response.data;
}

async function searchSaavn(query, limit = 24) {
  const data = await saavnGet({
    __call: "search.getResults",
    q: query,
    n: String(limit),
    p: "1"
  });

  const results = Array.isArray(data.results) ? data.results : [];

  return results
    .filter(track => track && track.id)
    .map(normalize);
}
// new line dipu

app.get("/api/debug-search", async (req, res) => {
  try {
    const query = String(req.query.q || "").trim();

    if (!query) {
      return res.status(400).json({ error: "Search query is required." });
    }

    const data = await saavnGet({
      __call: "search.getResults",
      q: query,
      n: "40",
      p: "1"
    });

    const results = Array.isArray(data.results) ? data.results : [];

    res.json({
      query,
      apiBase: SAAVN_API_BASE,
      resultCount: results.length,
      results: results.map(track => ({
        id: track.id,
        title: cleanText(track.song || track.title || ""),
        artist: cleanText(track.primary_artists || track.singers || ""),
        album: cleanText(track.album || ""),
        permalink: track.perma_url || "",
        hasAudio: Boolean(track.encrypted_media_url)
      }))
    });
  } catch (error) {
    console.error("Debug search failed:", error.message);
    res.status(500).json({ error: "JioSaavn diagnostic search failed." });
  }
});
//end line dipu

function handleApiError(res, error, message) {
  console.error(
    message,
    axios.isAxiosError(error)
      ? `HTTP ${error.response?.status ?? "network error"}`
      : error.message || error
  );

  if (!res.headersSent) {
    res.status(502).json({ error: message });
  }
}

// Home page
app.get("/api/home", async (req, res) => {
  try {
    const [trending, underground] = await Promise.all([
      searchSaavn("rock music", 24),
      searchSaavn("metal music", 24)
    ]);

    res.json({ trending, underground });
  } catch (error) {
    handleApiError(res, error, "Unable to load music right now.");
  }
});

// Search
app.get("/api/search", async (req, res) => {
  const query = String(req.query.q || "").trim();

  if (!query) {
    return res.status(400).json({
      error: "Enter a song, artist, or album to search."
    });
  }

  if (query.length > 200) {
    return res.status(400).json({
      error: "Search query is too long."
    });
  }

  try {
    const results = await searchSaavn(query, 40);
    res.json({ results });
  } catch (error) {
    handleApiError(res, error, "Search failed. Please try again.");
  }
});

// Genre discovery
app.get("/api/genre/:genre", async (req, res) => {
  const genres = {
    rock: "rock music",
    metal: "metal music",
    alternative: "alternative rock",
    punk: "punk rock",
    indie: "indie rock",
    pop: "pop music",
    electronic: "electronic music",
    "hip hop": "hip hop music",
    dance: "dance music",
    "r&b": "R&B music",
    jazz: "jazz music",
    classical: "classical music"
  };

  const genre = decodeURIComponent(req.params.genre)
    .trim()
    .toLowerCase();

  const query = genres[genre];

  if (!query) {
    return res.status(400).json({
      error: "This genre is not supported."
    });
  }

  try {
    const results = await searchSaavn(query, 30);
    res.json({ results });
  } catch (error) {
    handleApiError(res, error, "Unable to load this genre.");
  }
});

// Resolve a track ID to a stream URL from a fresh catalog response.
app.get("/api/stream/:id", async (req, res) => {
  const id = String(req.params.id || "").replace(/^track_/, "");

  if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
    return res.status(400).json({ error: "Invalid track ID." });
  }

  try {
    const data = await saavnGet({
      __call: "song.getDetails",
      pids: id
    });

    const tracks = Array.isArray(data)
      ? data
      : data && typeof data === "object"
        ? [data]
        : [];

    const matchingTrack = tracks.find(
      track => String(track.id || "") === id
    );

    const streamUrl = decryptMediaUrl(
      matchingTrack?.encrypted_media_url
    );

    if (!streamUrl) {
      return res.status(404).json({
        error: "No playable audio URL was returned for this track."
      });
    }

    // Redirect only to HTTPS URLs.
    const parsedUrl = new URL(streamUrl);

    if (parsedUrl.protocol !== "https:") {
      return res.status(502).json({
        error: "The audio provider returned an unsupported URL."
      });
    }

    return res.redirect(302, parsedUrl.toString());
  } catch (error) {
    handleApiError(res, error, "Unable to resolve this track.");
  }
});

// Frontend fallback (Express 5)
//app.get("/{*splat}", (req, res) => {
//res.sendFile(path.join(__dirname, "public", "index.html"));
//});

//app.listen(PORT, () => {
//console.log(`3.a.m. therapy running at http://localhost:${PORT}`);
//});
//newww
// Export Express app for Vercel.
export default app;

// Run normally on local development and Render.
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`3.a.m. therapy running at http://localhost:${PORT}`);
  });
}
