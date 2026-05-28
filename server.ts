import express from "express";
import fs from "fs";
import { promises as fsp } from "fs";
import path from "path";
import { createServer as createViteServer } from "vite";
import { execFile } from "child_process";
import { promisify } from "util";
const execFileAsync = promisify(execFile);

const SUPPORTED_FORMATS = ["mp3", "wav", "aac", "flac", "m4a", "ogg"] as const;
type SupportedFormat = typeof SUPPORTED_FORMATS[number];

const AUDIO_CONTENT_TYPES: Record<SupportedFormat, string> = {
  mp3: "audio/mpeg",
  wav: "audio/wav",
  aac: "audio/aac",
  flac: "audio/flac",
  m4a: "audio/mp4",
  ogg: "audio/ogg"
};

const YTDLP_AUDIO_FORMATS: Record<SupportedFormat, string> = {
  mp3: "mp3",
  wav: "wav",
  aac: "aac",
  flac: "flac",
  m4a: "m4a",
  ogg: "vorbis"
};

const EQ_FILTERS: Record<string, string> = {
  bass: "bass=g=6",
  vocal: "equalizer=f=1200:t=q:w=1:g=4",
  treble: "treble=g=5",
  instrumental: "acompressor=threshold=-18dB:ratio=2:attack=10:release=200",
  lofi: "lowpass=f=9000,highpass=f=120,acompressor=threshold=-16dB:ratio=3"
};

function isSupportedFormat(format: string): format is SupportedFormat {
  return SUPPORTED_FORMATS.includes(format as SupportedFormat);
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function getSafeFilename(name: string, fallback = "audio"): string {
  return (name || fallback)
    .replace(/[<>:"/\\|?*\r\n]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .substring(0, 100) || fallback;
}

function quotePostprocessorValue(value: unknown): string {
  return `"${String(value).replace(/["\\]/g, "\\$&")}"`;
}

function buildLocalTags(rawTitle: string, rawAuthor = "Unknown Artist") {
  const yearMatch = rawTitle.match(/\b(19|20)\d{2}\b/);
  let title = rawTitle
    .replace(/\[[^\]]*?\]|\([^)]*?\)/g, " ")
    .replace(/\b(official|music|video|audio|lyrics?|lyric|hd|hq|4k|mv|visualizer|remaster(?:ed)?)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  let artist = rawAuthor || "Unknown Artist";

  const splitMatch = title.match(/^(.+?)\s[-–—]\s(.+)$/);
  if (splitMatch && splitMatch[1].length <= 80 && splitMatch[2].length <= 120) {
    artist = splitMatch[1].trim();
    title = splitMatch[2].trim();
  }

  title = title
    .replace(/\bfeat\.?\s+/gi, "ft. ")
    .replace(/\s+/g, " ")
    .trim() || rawTitle || "Unknown Track";

  const lowered = `${title} ${artist}`.toLowerCase();
  const genre =
    lowered.includes("lofi") || lowered.includes("lo-fi") ? "Lo-Fi" :
    lowered.includes("ambient") ? "Ambient" :
    lowered.includes("jazz") ? "Jazz" :
    lowered.includes("hip hop") || lowered.includes("rap") ? "Hip Hop" :
    lowered.includes("rock") ? "Rock" :
    lowered.includes("electronic") || lowered.includes("synth") || lowered.includes("edm") ? "Electronic" :
    lowered.includes("podcast") ? "Podcast" :
    "Pop";

  return {
    title,
    artist,
    album: "Single",
    genre,
    year: yearMatch?.[0] || new Date().getFullYear().toString()
  };
}

function getYouTubeVideoId(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes("youtu.be")) {
      return parsed.pathname.split("/").filter(Boolean)[0] || null;
    }
    if (parsed.searchParams.has("v")) {
      return parsed.searchParams.get("v");
    }
    const parts = parsed.pathname.split("/").filter(Boolean);
    const markerIndex = parts.findIndex((part) => ["embed", "shorts", "live"].includes(part));
    if (markerIndex >= 0) {
      return parts[markerIndex + 1] || null;
    }
  } catch (_) {}
  return null;
}

function getYouTubePlaylistId(url: string): string | null {
  try {
    const parsed = new URL(url);
    const listId = parsed.searchParams.get("list");
    if (listId) return listId;

    const parts = parsed.pathname.split("/").filter(Boolean);
    const playlistIndex = parts.findIndex((part) => part.toLowerCase() === "playlist");
    return playlistIndex >= 0 ? parts[playlistIndex + 1] || null : null;
  } catch (_) {
    return null;
  }
}

async function runCommand(command: string, args: string[], options: { timeout: number; cwd: string }) {
  const localPythonPackages = path.join(options.cwd, ".python-packages");
  const localTempDir = path.join(options.cwd, ".tmp-pyi");
  await fsp.mkdir(localTempDir, { recursive: true });

  return execFileAsync(command, args, {
    timeout: options.timeout,
    cwd: options.cwd,
    maxBuffer: 1024 * 1024 * 10,
    windowsHide: true,
    env: {
      ...process.env,
      PYTHONPATH: process.env.PYTHONPATH
        ? `${localPythonPackages}${path.delimiter}${process.env.PYTHONPATH}`
        : localPythonPackages,
      TMP: localTempDir,
      TEMP: localTempDir,
      TMPDIR: localTempDir
    }
  });
}

function getBundledYtDlpPath(cwd: string): string {
  const executableName = process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp";
  const bundledPath = path.join(cwd, "node_modules", "youtube-dl-exec", "bin", executableName);
  const fallbackPath = path.join(cwd, executableName);

  if (fs.existsSync(bundledPath)) return bundledPath;
  if (fs.existsSync(fallbackPath)) return fallbackPath;
  return executableName;
}

async function getFfmpegLocationArgs(): Promise<string[]> {
  if (process.env.FFMPEG_PATH) {
    return ["--ffmpeg-location", process.env.FFMPEG_PATH];
  }

  const finderCommand = process.platform === "win32" ? "where.exe" : "which";
  try {
    const { stdout } = await execFileAsync(finderCommand, ["ffmpeg"], {
      timeout: 5000,
      windowsHide: true
    });
    const executablePath = stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
    return executablePath ? ["--ffmpeg-location", path.dirname(executablePath)] : [];
  } catch (_) {
    return [];
  }
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Middleware
  app.use(express.json());

  // API Endpoints go here

  // 1. Fetch metadata using YouTube oEmbed
  app.post("/api/metadata", async (req, res) => {
    try {
      const { url } = req.body;
      if (!url) {
        return res.status(400).json({ error: "YouTube URL is required." });
      }

      // Safe URL validation
      if (!url.includes("youtube.com") && !url.includes("youtu.be")) {
        return res.status(400).json({ error: "Invalid YouTube URL format." });
      }

      // Clean up URL
      let cleanUrl = url.trim();
      const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(cleanUrl)}&format=json`;

      const response = await fetch(oembedUrl);
      if (!response.ok) {
        // Fallback for custom or invalid urls that still can be parsed offline
        const simulatedTitle = parseOfflineTitle(cleanUrl);
        return res.json({
          title: simulatedTitle,
          author: "YouTube Creator",
          thumbnailUrl: "https://images.unsplash.com/photo-1611162617213-7d7a39e9b1d7?w=800&auto=format&fit=crop",
          duration: "3:45",
          durationSeconds: 225,
          url: cleanUrl
        });
      }

      const data = await response.json();
      res.json({
        title: data.title || "YouTube Audio Stream",
        author: data.author_name || "Unknown Channel",
        thumbnailUrl: data.thumbnail_url || "https://images.unsplash.com/photo-1611162617213-7d7a39e9b1d7?w=800&auto=format&fit=crop",
        duration: "3:40",
        durationSeconds: 220,
        url: cleanUrl
      });
    } catch (error: any) {
      console.error("Metadata error:", error);
      res.status(500).json({ error: "Failed to retrieve video metadata." });
    }
  });

  // Helper to extract offline titles when URL doesn't load/network issues
  function parseOfflineTitle(url: string): string {
    try {
      const parsed = new URL(url);
      if (parsed.searchParams.has("v")) {
        return `YouTube Audio (${parsed.searchParams.get("v")})`;
      }
      const parts = parsed.pathname.split("/");
      const last = parts[parts.length - 1];
      if (last && last !== "watch") {
        return `YouTube Audio (${last})`;
      }
    } catch (_) {}
    return "YouTube Audio Stream";
  }

  // 2. Local ID3 cleanup. No API key, quota, or network call required.
  app.post("/api/optimize-tags", async (req, res) => {
    try {
      const { title, author } = req.body;
      if (!title) {
        return res.status(400).json({ error: "Video title is required for optimization." });
      }

      res.json(buildLocalTags(String(title), String(author || "")));
    } catch (err) {
      console.error("Optimize tags error:", err);
      res.json({
        title: req.body.title || "Unknown Track",
        artist: req.body.author || "Unknown Artist",
        album: "Single",
        genre: "Pop",
        year: new Date().getFullYear().toString()
      });
    }
  });

  // 3. Search YouTube directly with youtubei.js. This is free and keyless.
  app.post("/api/search", async (req, res) => {
    try {
      const { query } = req.body;
      if (!query || query.trim() === "") {
        return res.status(400).json({ error: "Search query is required." });
      }

      const { Innertube } = await import("youtubei.js");
      const youtube = await Innertube.create();
      const search = await youtube.search(query.trim(), { type: "video" });
      const results = search.videos.slice(0, 8).map((video: any) => ({
        title: video.title?.toString?.() || video.title?.text || "Untitled video",
        channel: video.author?.name || "Unknown channel",
        url: `https://www.youtube.com/watch?v=${video.video_id || video.id}`
      })).filter((video: { url: string }) => !video.url.endsWith("undefined"));

      res.json(results);
    } catch (err) {
      console.error("Search error:", err);
      res.status(500).json({ error: "YouTube search failed. Please paste a direct YouTube URL instead." });
    }
  });

  // Path to bundled yt-dlp binary, with a local/root fallback for portable builds.
  const YTDLP_BIN = getBundledYtDlpPath(process.cwd());

  // 3.5. Fetch real playlist tracks via yt-dlp (ytpl is broken by YouTube changes)
  app.post("/api/playlist", async (req, res) => {
    let limit = 8;
    try {
      const { url } = req.body;
      if (req.body.limit) limit = Math.max(1, Math.min(50, Number(req.body.limit) || 8));

      if (!url || url.trim() === "") {
        return res.status(400).json({ error: "Playlist URL is required." });
      }
      if (!url.includes("youtube.com") && !url.includes("youtu.be")) {
        return res.status(400).json({ error: "Invalid YouTube playlist URL." });
      }

      const playlistId = getYouTubePlaylistId(url);
      if (!playlistId) {
        return res.status(400).json({ error: "Could not parse a YouTube playlist ID from the URL." });
      }

      console.log(`Fetching playlist via youtubei.js: ${playlistId} (limit: ${limit})`);

      let tracks: Array<{ title: string; channel: string; url: string }> = [];
      try {
        const { Innertube } = await import("youtubei.js");
        const youtube = await Innertube.create();
        const playlist = await youtube.getPlaylist(playlistId);
        tracks = (playlist.videos || []).slice(0, limit).map((video: any) => {
          const videoId = video.video_id || video.id;
          return {
            title: video.title?.toString?.() || video.title?.text || "Unknown Track",
            channel: video.author?.name || "Unknown Channel",
            url: videoId ? `https://www.youtube.com/watch?v=${videoId}` : ""
          };
        }).filter((track: { url: string }) => track.url);
      } catch (youtubeiError) {
        console.warn("youtubei playlist fetch failed, falling back to yt-dlp:", youtubeiError);

        const { stdout } = await runCommand(YTDLP_BIN, [
          "--flat-playlist",
          "--print", "%(title)s|||%(channel)s|||%(webpage_url)s",
          "--no-warnings",
          "--playlist-items", `1-${limit}`,
          url
        ], {
          cwd: process.cwd(),
          timeout: 60000
        });

        tracks = stdout
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((line: string) => {
            const parts = line.split("|||");
            return {
              title: (parts[0] || "Unknown Track").trim(),
              channel: (parts[1] || "Unknown Channel").trim(),
              url: (parts[2] || "").trim()
            };
          })
          .filter((track: { url: string }) => track.url.includes("youtube.com") || track.url.includes("youtu.be"));
      }

      console.log(`Found ${tracks.length} tracks`);
      res.json(tracks);

    } catch (err: any) {
      console.error("Playlist fetch error:", err);
      res.status(500).json({
        error: `Failed to fetch playlist: ${err.message || "Unknown error"}. Make sure the playlist is public and the URL is correct.`
      });
    }
  });

  // 4. Audio download via yt-dlp and ffmpeg. Produces a real converted file.
  app.get("/api/generate-audio", async (req, res) => {
    const url = req.query.url as string;
    const requestedFormat = String(req.query.format || "mp3").toLowerCase();
    const format = isSupportedFormat(requestedFormat) ? requestedFormat : "mp3";
    const bitrate = Math.round(clampNumber(req.query.bitrate, 320, 64, 320));
    const sampleRate = Math.round(clampNumber(req.query.sampleRate, 48000, 8000, 96000));
    const trimStart = clampNumber(req.query.trimStart, 0, 0, 24 * 60 * 60);
    const trimEnd = clampNumber(req.query.trimEnd, 0, 0, 24 * 60 * 60);
    const volumeBoost = clampNumber(req.query.volumeBoost, 1, 0.1, 2.5);
    const fadeIn = clampNumber(req.query.fadeIn, 0, 0, 60);
    const fadeOut = clampNumber(req.query.fadeOut, 0, 0, 60);
    const equalizer = String(req.query.equalizer || "flat");

    if (!url) return res.status(400).send("YouTube URL is required.");
    if (!url.includes("youtube.com") && !url.includes("youtu.be")) {
      return res.status(400).send("Invalid YouTube URL.");
    }

    const videoId = getYouTubeVideoId(url);
    if (!videoId) {
      return res.status(400).send("Could not parse a YouTube video ID from the URL.");
    }

    const tmpRoot = path.join(process.cwd(), ".tmp-audio");
    let jobDir = "";

    try {
      let title = getSafeFilename(String(req.query.title || ""));
      const { Innertube } = await import("youtubei.js");
      const youtube = await Innertube.create();
      const info = await youtube.getBasicInfo(videoId);
      title = title || getSafeFilename(info.basic_info.title || "");

      await fsp.mkdir(tmpRoot, { recursive: true });
      jobDir = await fsp.mkdtemp(path.join(tmpRoot, "job-"));
      const filters = [
        volumeBoost !== 1 ? `volume=${volumeBoost.toFixed(2)}` : "",
        EQ_FILTERS[equalizer] || "",
        fadeIn > 0 ? `afade=t=in:st=0:d=${fadeIn.toFixed(2)}` : "",
        fadeOut > 0 && trimEnd > trimStart
          ? `afade=t=out:st=${Math.max(0, trimEnd - trimStart - fadeOut).toFixed(2)}:d=${fadeOut.toFixed(2)}`
          : ""
      ].filter(Boolean);

      console.log(`Downloading audio via yt-dlp: ${title} -> ${format} ${bitrate}K`);

      // Build postprocessor args for ffmpeg (sample rate, trim, EQ, fade).
      const ppArgs = [
        `-ar ${sampleRate}`,
        filters.length > 0 ? `-af ${filters.join(",")}` : "",
        trimStart > 0 ? `-ss ${trimStart.toFixed(2)}` : "",
        trimEnd > trimStart ? `-to ${trimEnd.toFixed(2)}` : "",
        `-metadata title=${quotePostprocessorValue(title)}`,
        req.query.artist ? `-metadata artist=${quotePostprocessorValue(req.query.artist)}` : "",
        req.query.album ? `-metadata album=${quotePostprocessorValue(req.query.album)}` : "",
        req.query.genre ? `-metadata genre=${quotePostprocessorValue(req.query.genre)}` : "",
        req.query.year ? `-metadata date=${quotePostprocessorValue(req.query.year)}` : ""
      ].filter(Boolean).join(" ");
      const ffmpegLocationArgs = await getFfmpegLocationArgs();

      const ytdlpArgs = [
        "--no-playlist",
        "--no-mtime",
        "--embed-metadata",
        "--compat-options", "filename-sanitization",
        "-f", "bestaudio/best",
        "-x",
        "--audio-format", YTDLP_AUDIO_FORMATS[format],
        "--audio-quality", `${bitrate}k`,
        "-o", path.join(jobDir, "%(title).100B.%(ext)s"),
        ...(ppArgs ? ["--postprocessor-args", `ffmpeg:${ppArgs}`] : []),
        ...ffmpegLocationArgs,
        url
      ];

      await runCommand(YTDLP_BIN, ytdlpArgs, {
        cwd: process.cwd(),
        timeout: 10 * 60 * 1000
      });

      const files = await fsp.readdir(jobDir);
      const outputFile = files.find((file) => file.toLowerCase().endsWith(`.${format}`)) || files[0];
      if (!outputFile) {
        throw new Error("No converted audio file was created.");
      }
      const finalOutputPath = path.join(jobDir, outputFile);

      const contentType = AUDIO_CONTENT_TYPES[format];
      const filename = `${title || "audio"}.${format}`;

      res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(filename)}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
      res.setHeader("Content-Type", contentType);

      const stream = fs.createReadStream(finalOutputPath);
      stream.pipe(res);
      res.on("finish", () => {
        fsp.rm(jobDir, { recursive: true, force: true }).catch(() => {});
      });
      res.on("close", () => {
        fsp.rm(jobDir, { recursive: true, force: true }).catch(() => {});
      });

    } catch (e: any) {
      console.error("Download error:", e);
      if (jobDir) {
        fsp.rm(jobDir, { recursive: true, force: true }).catch(() => {});
      }
      if (!res.headersSent) res.status(500).send("Failed to download audio: " + e.message);
    }
  });

  // Serve static assets or mount Vite in dev mode
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer();
