import express from "express";
import fs from "fs";
import { promises as fsp } from "fs";
import path from "path";
import { createServer as createViteServer } from "vite";
import { execFile, spawn } from "child_process";
import { promisify } from "util";
import { randomUUID } from "crypto";
const execFileAsync = promisify(execFile);

interface ConversionJob {
  status: "running" | "done" | "error";
  outputPath: string;
  tmpDir: string;
  progressPercent: number;
  error?: string;
  createdAt: number;
  filename: string;
  contentType: string;
}
const conversionJobs = new Map<string, ConversionJob>();
setInterval(() => {
  const cutoff = Date.now() - 15 * 60 * 1000;
  for (const [id, job] of conversionJobs) {
    if (job.status !== "running" && job.createdAt < cutoff) {
      fsp.rm(job.tmpDir, { recursive: true, force: true }).catch(() => {});
      conversionJobs.delete(id);
    }
  }
}, 5 * 60 * 1000);

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

const EQ_FILTERS: Record<string, string> = {
  bass: "bass=g=6",
  vocal: "equalizer=f=1200:t=q:w=1:g=4",
  treble: "treble=g=5",
  instrumental: "acompressor=threshold=-18dB:ratio=2:attack=10:release=200",
  lofi: "lowpass=f=9000,highpass=f=120,acompressor=threshold=-16dB:ratio=3"
};

const MODE_FILTERS: Record<string, string> = {
  audio_mix: "highpass=f=30,acompressor=threshold=-18dB:ratio=2.2:attack=12:release=180:makeup=1.5",
  mastering: "acompressor=threshold=-16dB:ratio=3:attack=8:release=120:makeup=2",
  vocal_master: "highpass=f=80,equalizer=f=3500:t=q:w=1:g=3,acompressor=threshold=-20dB:ratio=3:attack=6:release=160:makeup=2",
  club_master: "bass=g=4,treble=g=2,acompressor=threshold=-14dB:ratio=3.5:attack=5:release=100:makeup=2"
};

const EQ_BAND_FREQS = [60, 250, 1000, 4000, 12000] as const;

function parseErrorMessage(raw: string): string {
  if (/video unavailable|this video is unavailable/i.test(raw)) return "This video is unavailable or private.";
  if (/sign in to confirm|confirm your age/i.test(raw)) return "YouTube requires sign-in (age-restricted or private video).";
  if (/http error 403|403 forbidden/i.test(raw)) return "Access denied (403) — the video may be geo-restricted.";
  if (/http error 429|429 too many requests/i.test(raw)) return "Rate-limited by YouTube — wait a moment and retry.";
  if (/no such file|enoent/i.test(raw)) return "System tool not found — ensure ffmpeg is installed and in PATH.";
  if (/enotfound|econnrefused|network/i.test(raw)) return "Network error — check your internet connection.";
  if (/timed out|etimedout/i.test(raw)) return "Download timed out. The video may be too long or your connection is slow.";
  return raw.slice(0, 300);
}

function buildReverbFilter(level: number): string {
  const outGain = Math.max(0.5, 0.9 - level * 0.003).toFixed(2);
  const d1 = Math.round(20 + level * 0.8);
  const d2 = Math.round(40 + level * 1.2);
  const dec1 = Math.min(0.8, 0.2 + level * 0.006).toFixed(2);
  const dec2 = Math.min(0.7, 0.15 + level * 0.005).toFixed(2);
  return `aecho=0.8:${outGain}:${d1}|${d2}:${dec1}|${dec2}`;
}

function runFfmpegWithProgress(
  ffmpegExec: string,
  ffmpegArgs: string[],
  options: { cwd: string; timeout: number; durationSeconds: number },
  onProgress: (pct: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegExec, ffmpegArgs, {
      cwd: options.cwd,
      windowsHide: true,
      env: { ...process.env }
    });
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      proc.kill("SIGKILL");
      reject(new Error("ffmpeg timed out"));
    }, options.timeout);
    proc.stdout.on("data", (data: Buffer) => {
      for (const line of data.toString().split("\n")) {
        const trimmed = line.trim();
        if (trimmed.startsWith("out_time_us=")) {
          const us = parseInt(trimmed.slice(12), 10);
          if (!isNaN(us) && options.durationSeconds > 0) {
            onProgress(Math.min(99, Math.round((us / 1e6 / options.durationSeconds) * 100)));
          }
        }
      }
    });
    proc.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
    proc.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) { onProgress(100); resolve(); }
      else reject(new Error(`ffmpeg exited with code ${code}: ${stderr.slice(-500)}`));
    });
    proc.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
  });
}

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

async function getFfmpegExecutable(): Promise<string> {
  if (process.env.FFMPEG_PATH) {
    try {
      const ffmpegStat = await fsp.stat(process.env.FFMPEG_PATH);
      if (ffmpegStat.isDirectory()) {
        return path.join(process.env.FFMPEG_PATH, process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
      }
    } catch (_) {}
    return process.env.FFMPEG_PATH;
  }

  const finderCommand = process.platform === "win32" ? "where.exe" : "which";
  try {
    const { stdout } = await execFileAsync(finderCommand, ["ffmpeg"], {
      timeout: 5000,
      windowsHide: true
    });
    return stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean) || "ffmpeg";
  } catch (_) {
    return "ffmpeg";
  }
}

function getOutputCodecArgs(format: SupportedFormat, bitrate: number): string[] {
  switch (format) {
    case "mp3":
      return ["-c:a", "libmp3lame", "-b:a", `${bitrate}k`];
    case "wav":
      return ["-c:a", "pcm_s16le"];
    case "flac":
      return ["-c:a", "flac", "-compression_level", "8"];
    case "ogg":
      return ["-c:a", "libvorbis", "-b:a", `${bitrate}k`];
    case "aac":
    case "m4a":
      return ["-c:a", "aac", "-b:a", `${bitrate}k`];
  }
}

async function startServer() {
  const app = express();
  const PORT = Math.round(clampNumber(process.env.PORT, 3000, 1, 65535));
  const startedAt = Date.now();
  // Path to bundled yt-dlp binary, with a local/root fallback for portable builds.
  const YTDLP_BIN = getBundledYtDlpPath(process.cwd());

  // Middleware
  app.use(express.json());

  app.get("/api/health", async (_req, res) => {
    const ffmpegLocationArgs = await getFfmpegLocationArgs();
    const ytdlpAvailable = YTDLP_BIN === "yt-dlp" || fs.existsSync(YTDLP_BIN);

    res.json({
      status: ytdlpAvailable ? "ready" : "degraded",
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
      ffmpeg: ffmpegLocationArgs.length > 0 ? "available" : "path",
      ytdlp: ytdlpAvailable ? "available" : "path",
      formats: SUPPORTED_FORMATS
    });
  });

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

  // 4a. Fetch chapter markers from a YouTube video via yt-dlp --dump-json.
  app.post("/api/chapters", async (req, res) => {
    try {
      const { url } = req.body;
      if (!url) return res.status(400).json({ error: "URL required" });
      if (!url.includes("youtube.com") && !url.includes("youtu.be")) {
        return res.status(400).json({ error: "Invalid YouTube URL" });
      }

      const { stdout } = await runCommand(YTDLP_BIN, [
        "--no-playlist", "--skip-download", "--dump-json", "--no-warnings", url
      ], { cwd: process.cwd(), timeout: 60000 });

      const info = JSON.parse(stdout.trim().split("\n")[0]);
      const chapters = (info.chapters || []).map((ch: any) => ({
        title: ch.title || `Chapter ${ch.section_number || 1}`,
        startTime: ch.start_time || 0,
        endTime: ch.end_time || info.duration || 0
      }));

      res.json({ chapters, duration: info.duration || 0, title: info.title || "" });
    } catch (e: any) {
      console.error("Chapters error:", e);
      res.status(500).json({ error: "Failed to fetch chapters: " + (e.message || "unknown error") });
    }
  });

  // 4b. MusicBrainz recording lookup (free, no API key).
  app.post("/api/musicbrainz", async (req, res) => {
    try {
      const { title, artist } = req.body;
      if (!title) return res.status(400).json({ error: "Title required" });

      const query = [title, artist].filter(Boolean).join(" AND artist:");
      const mbUrl = `https://musicbrainz.org/ws/2/recording/?query=recording:${encodeURIComponent(title)}${artist ? `%20AND%20artist:${encodeURIComponent(artist)}` : ""}&fmt=json&limit=3`;

      const response = await fetch(mbUrl, {
        headers: { "User-Agent": "SonicMP3/1.0 (local-tool)" }
      });
      if (!response.ok) throw new Error(`MusicBrainz returned ${response.status}`);

      const data: any = await response.json();
      const recording = data.recordings?.[0];
      if (!recording) return res.json(null);

      const release = recording.releases?.[0];
      const artistName = recording["artist-credit"]?.[0]?.artist?.name || artist || "";
      const yearRaw: string = release?.date || release?.["first-release-date"] || "";

      res.json({
        title: recording.title || title,
        artist: artistName,
        album: release?.title || "",
        year: yearRaw.slice(0, 4),
        genre: recording.tags?.[0]?.name || ""
      });
    } catch (e: any) {
      console.error("MusicBrainz error:", e);
      res.status(500).json({ error: "MusicBrainz lookup failed: " + (e.message || "unknown") });
    }
  });

  // 4c. Local audio file format conversion — accepts raw binary POST body.
  app.post("/api/convert-local",
    (req, res, next) => express.raw({ type: "*/*", limit: "250mb" })(req, res, next),
    async (req: express.Request, res: express.Response) => {
      const requestedFormat = String(req.query.format || "mp3").toLowerCase();
      const format = isSupportedFormat(requestedFormat) ? requestedFormat : "mp3";
      const bitrate = Math.round(clampNumber(req.query.bitrate, 320, 64, 320));
      const sampleRate = Math.round(clampNumber(req.query.sampleRate, 48000, 8000, 96000));
      const originalName = getSafeFilename(String(req.query.name || "audio"));
      const srcExt = String(req.query.ext || "mp3").replace(/[^a-z0-9]/gi, "").substring(0, 8);

      const tmpRoot = path.join(process.cwd(), ".tmp-audio");
      let jobDir = "";
      try {
        await fsp.mkdir(tmpRoot, { recursive: true });
        jobDir = await fsp.mkdtemp(path.join(tmpRoot, "local-"));

        const sourcePath = path.join(jobDir, `source.${srcExt}`);
        const outputPath = path.join(jobDir, `${originalName}.${format}`);
        await fsp.writeFile(sourcePath, req.body as Buffer);

        const ffmpegArgs = [
          "-hide_banner", "-y",
          "-i", sourcePath,
          "-vn",
          "-ar", String(sampleRate),
          ...getOutputCodecArgs(format, bitrate),
          outputPath
        ];

        console.log(`Local conversion: ${srcExt} → ${format} ${bitrate}k`);
        await runCommand(await getFfmpegExecutable(), ffmpegArgs, {
          cwd: process.cwd(),
          timeout: 5 * 60 * 1000
        });

        res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(originalName)}.${format}"; filename*=UTF-8''${encodeURIComponent(originalName)}.${format}`);
        res.setHeader("Content-Type", AUDIO_CONTENT_TYPES[format]);

        const stream = fs.createReadStream(outputPath);
        stream.pipe(res);
        res.on("finish", () => fsp.rm(jobDir, { recursive: true, force: true }).catch(() => {}));
        res.on("close", () => fsp.rm(jobDir, { recursive: true, force: true }).catch(() => {}));
      } catch (e: any) {
        console.error("Local convert error:", e);
        if (jobDir) fsp.rm(jobDir, { recursive: true, force: true }).catch(() => {});
        if (!res.headersSent) res.status(500).send("Conversion failed: " + e.message);
      }
    }
  );

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
    const stereoWidth = clampNumber(req.query.stereoWidth, 1, 0.7, 2);
    const compression = clampNumber(req.query.compression, 35, 0, 100);
    const limiterCeiling = clampNumber(req.query.limiterCeiling, 0.95, 0.85, 1);
    const normalizeLoudness = String(req.query.normalizeLoudness || "false") === "true";
    const loudnessTarget = clampNumber(req.query.loudnessTarget, -14, -24, -8);
    const noiseReduction = clampNumber(req.query.noiseReduction, 0, 0, 100);
    const highPass = Math.round(clampNumber(req.query.highPass, 20, 0, 1000));
    const lowPass = Math.round(clampNumber(req.query.lowPass, 20000, 1000, 22000));
    const tempo = clampNumber(req.query.tempo, 1, 0.75, 1.25);
    const pitchShift = clampNumber(req.query.pitchShift, 0, -12, 12);
    const fadeIn = clampNumber(req.query.fadeIn, 0, 0, 60);
    const fadeOut = clampNumber(req.query.fadeOut, 0, 0, 60);
    const conversionMode = String(req.query.conversionMode || "standard");
    const equalizer = String(req.query.equalizer || "flat");
    const channelMode = String(req.query.channelMode || "stereo");
    const embedThumbnail = String(req.query.embedThumbnail || "false") === "true";
    const previewMode = String(req.query.preview || "false") === "true";
    const thumbnailUrl = String(req.query.thumbnailUrl || "");
    const reverbLevel = clampNumber(req.query.reverb, 0, 0, 100);
    const eqBandsRaw = String(req.query.eqBands || "0,0,0,0,0");
    const eqBands = eqBandsRaw.split(",").map((v) => clampNumber(v, 0, -12, 12)).slice(0, 5);
    while (eqBands.length < 5) eqBands.push(0);

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
      if (!title || title === "audio") {
        const { Innertube } = await import("youtubei.js");
        const youtube = await Innertube.create();
        const info = await youtube.getBasicInfo(videoId);
        title = getSafeFilename(info.basic_info.title || "");
      }

      await fsp.mkdir(tmpRoot, { recursive: true });
      jobDir = await fsp.mkdtemp(path.join(tmpRoot, "job-"));
      const pitchFactor = Math.pow(2, pitchShift / 12);
      const filters = [
        highPass > 0 ? `highpass=f=${highPass}` : "",
        lowPass < 22000 ? `lowpass=f=${lowPass}` : "",
        noiseReduction > 0 ? `afftdn=nr=${Math.max(1, Math.round(noiseReduction / 4))}` : "",
        pitchShift !== 0 ? `asetrate=${Math.round(sampleRate * pitchFactor)},aresample=${sampleRate},atempo=${(1 / pitchFactor).toFixed(5)}` : "",
        tempo !== 1 ? `atempo=${tempo.toFixed(3)}` : "",
        volumeBoost !== 1 ? `volume=${volumeBoost.toFixed(2)}` : "",
        MODE_FILTERS[conversionMode] || "",
        EQ_FILTERS[equalizer] || "",
        reverbLevel > 0 ? buildReverbFilter(reverbLevel) : "",
        ...eqBands.map((g, i) => g !== 0 ? `equalizer=f=${EQ_BAND_FREQS[i]}:t=o:w=0.7:g=${g.toFixed(1)}` : ""),
        stereoWidth !== 1 && channelMode !== "mono" ? `aformat=channel_layouts=stereo,extrastereo=m=${stereoWidth.toFixed(2)}` : "",
        compression > 0 ? `acompressor=threshold=-18dB:ratio=${(1 + compression / 25).toFixed(2)}:attack=10:release=160:makeup=${Math.max(1, compression / 45).toFixed(2)}` : "",
        normalizeLoudness ? `loudnorm=I=${loudnessTarget.toFixed(1)}:TP=-1.5:LRA=9` : "",
        conversionMode !== "standard" || compression > 0 || limiterCeiling < 0.98 ? `alimiter=limit=${limiterCeiling.toFixed(2)}` : "",
        channelMode === "mono" ? "aformat=channel_layouts=stereo,pan=mono|c0=0.5*c0+0.5*c1" : "",
        fadeIn > 0 ? `afade=t=in:st=0:d=${fadeIn.toFixed(2)}` : "",
        fadeOut > 0 && trimEnd > trimStart
          ? `afade=t=out:st=${Math.max(0, trimEnd - trimStart - fadeOut).toFixed(2)}:d=${fadeOut.toFixed(2)}`
          : ""
      ].filter(Boolean);

      console.log(`Downloading source audio via yt-dlp: ${title}${previewMode ? " [preview]" : ""}`);

      const ytdlpArgs = [
        "--no-playlist",
        "--no-mtime",
        "--concurrent-fragments", "8",
        "--retries", "3",
        "--fragment-retries", "3",
        "--compat-options", "filename-sanitization",
        "-f", "bestaudio/best",
        ...(previewMode ? ["--download-sections", "*0-65"] : []),
        "-o", path.join(jobDir, "source.%(ext)s"),
        url
      ];

      await runCommand(YTDLP_BIN, ytdlpArgs, {
        cwd: process.cwd(),
        timeout: 10 * 60 * 1000
      });

      const sourceFiles = (await fsp.readdir(jobDir))
        .filter((file) => !file.endsWith(".part") && !file.endsWith(".ytdl"));
      const sourceFile = sourceFiles[0];
      if (!sourceFile) {
        throw new Error("No source audio file was downloaded.");
      }
      const sourcePath = path.join(jobDir, sourceFile);
      const baseOutputPath = path.join(jobDir, `${title || "audio"}_base.${format}`);
      const finalOutputPath = path.join(jobDir, `${title || "audio"}.${format}`);
      const effectiveBitrate = previewMode ? Math.min(bitrate, 128) : bitrate;
      const duration = previewMode ? 60 : (trimEnd > trimStart ? trimEnd - trimStart : 0);
      const ffmpegArgs = [
        "-hide_banner",
        "-y",
        ...(trimStart > 0 && !previewMode ? ["-ss", trimStart.toFixed(2)] : []),
        "-i", sourcePath,
        ...(duration > 0 ? ["-t", duration.toFixed(2)] : []),
        "-vn",
        "-ar", String(sampleRate),
        ...(filters.length > 0 && !previewMode ? ["-af", filters.join(",")] : []),
        ...getOutputCodecArgs(format, effectiveBitrate),
        "-metadata", `title=${title}`,
        ...(req.query.artist ? ["-metadata", `artist=${String(req.query.artist)}`] : []),
        ...(req.query.album ? ["-metadata", `album=${String(req.query.album)}`] : []),
        ...(req.query.genre ? ["-metadata", `genre=${String(req.query.genre)}`] : []),
        ...(req.query.year ? ["-metadata", `date=${String(req.query.year)}`] : []),
        embedThumbnail ? baseOutputPath : finalOutputPath
      ];

      console.log(`Transcoding source audio with ffmpeg: ${format} ${effectiveBitrate}K${previewMode ? " [preview]" : ""}`);
      const ffmpegExec = await getFfmpegExecutable();
      await runCommand(ffmpegExec, ffmpegArgs, {
        cwd: process.cwd(),
        timeout: 10 * 60 * 1000
      });

      // Embed thumbnail as album art if requested and format supports it
      if (embedThumbnail && thumbnailUrl && (format === "mp3" || format === "m4a" || format === "aac" || format === "flac")) {
        try {
          const thumbPath = path.join(jobDir, "cover.jpg");
          const thumbRes = await fetch(thumbnailUrl);
          if (thumbRes.ok) {
            const thumbBuf = Buffer.from(await thumbRes.arrayBuffer());
            await fsp.writeFile(thumbPath, thumbBuf);
            const embedArgs = [
              "-hide_banner", "-y",
              "-i", baseOutputPath,
              "-i", thumbPath,
              "-map", "0:a",
              "-map", "1:v",
              "-c:a", "copy",
              "-c:v", format === "flac" ? "copy" : "mjpeg",
              ...(format === "mp3" ? ["-id3v2_version", "3", "-metadata:s:v:0", "title=Album cover", "-metadata:s:v:0", "comment=Cover (front)"] : []),
              ...(format === "m4a" || format === "aac" ? ["-disposition:v:0", "attached_pic"] : []),
              finalOutputPath
            ];
            await runCommand(ffmpegExec, embedArgs, { cwd: process.cwd(), timeout: 2 * 60 * 1000 });
          } else {
            await fsp.rename(baseOutputPath, finalOutputPath);
          }
        } catch (thumbErr) {
          console.warn("Thumbnail embed failed, using audio without art:", thumbErr);
          try { await fsp.rename(baseOutputPath, finalOutputPath); } catch (_) {}
        }
      }

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

  // 5. SSE-based background conversion job: start
  app.post("/api/start-job", async (req, res) => {
    const body = req.body || {};
    const url = String(body.url || "");
    if (!url || (!url.includes("youtube.com") && !url.includes("youtu.be"))) {
      return res.status(400).json({ error: "Valid YouTube URL required." });
    }
    const requestedFormat = String(body.format || "mp3").toLowerCase();
    const format = isSupportedFormat(requestedFormat) ? requestedFormat : "mp3";
    const bitrate = Math.round(clampNumber(body.bitrate, 320, 64, 320));
    const sampleRate = Math.round(clampNumber(body.sampleRate, 48000, 8000, 96000));
    const trimStart = clampNumber(body.trimStart, 0, 0, 24 * 60 * 60);
    const trimEnd = clampNumber(body.trimEnd, 0, 0, 24 * 60 * 60);
    const volumeBoost = clampNumber(body.volumeBoost, 1, 0.1, 2.5);
    const stereoWidth = clampNumber(body.stereoWidth, 1, 0.7, 2);
    const compression = clampNumber(body.compression, 35, 0, 100);
    const limiterCeiling = clampNumber(body.limiterCeiling, 0.95, 0.85, 1);
    const normalizeLoudness = String(body.normalizeLoudness) === "true";
    const loudnessTarget = clampNumber(body.loudnessTarget, -14, -24, -8);
    const noiseReduction = clampNumber(body.noiseReduction, 0, 0, 100);
    const highPass = Math.round(clampNumber(body.highPass, 20, 0, 1000));
    const lowPass = Math.round(clampNumber(body.lowPass, 20000, 1000, 22000));
    const tempo = clampNumber(body.tempo, 1, 0.75, 1.25);
    const pitchShift = clampNumber(body.pitchShift, 0, -12, 12);
    const fadeIn = clampNumber(body.fadeIn, 0, 0, 60);
    const fadeOut = clampNumber(body.fadeOut, 0, 0, 60);
    const conversionMode = String(body.conversionMode || "standard");
    const equalizer = String(body.equalizer || "flat");
    const channelMode = String(body.channelMode || "stereo");
    const embedThumbnail = String(body.embedThumbnail) === "true";
    const thumbnailUrl = String(body.thumbnailUrl || "");
    const reverbLevel = clampNumber(body.reverb, 0, 0, 100);
    const eqBandsRaw = String(body.eqBands || "0,0,0,0,0");
    const eqBands = (Array.isArray(body.eqBands) ? body.eqBands : eqBandsRaw.split(","))
      .map((v: unknown) => clampNumber(v, 0, -12, 12)).slice(0, 5) as number[];
    while (eqBands.length < 5) eqBands.push(0);
    const titleRaw = getSafeFilename(String(body.title || ""));
    const artistRaw = String(body.artist || "");
    const albumRaw = String(body.album || "");
    const genreRaw = String(body.genre || "");
    const yearRaw = String(body.year || "");
    const durationSeconds = clampNumber(body.durationSeconds, 220, 1, 10 * 60 * 60);

    const videoId = getYouTubeVideoId(url);
    if (!videoId) return res.status(400).json({ error: "Could not parse video ID from URL." });

    const jobId = randomUUID();
    const job: ConversionJob = {
      status: "running", outputPath: "", tmpDir: "",
      progressPercent: 2, createdAt: Date.now(),
      filename: `${titleRaw || "audio"}.${format}`,
      contentType: AUDIO_CONTENT_TYPES[format]
    };
    conversionJobs.set(jobId, job);
    res.json({ jobId });

    // Background conversion
    (async () => {
      const cwd = process.cwd();
      const tmpRoot = path.join(cwd, ".tmp-audio");
      let jobDir = "";
      try {
        let title = titleRaw;
        if (!title || title === "audio") {
          const { Innertube } = await import("youtubei.js");
          const yt = await Innertube.create();
          const info = await yt.getBasicInfo(videoId);
          title = getSafeFilename(info.basic_info.title || "");
        }
        await fsp.mkdir(tmpRoot, { recursive: true });
        jobDir = await fsp.mkdtemp(path.join(tmpRoot, "job-"));
        job.tmpDir = jobDir;

        const pitchFactor = Math.pow(2, pitchShift / 12);
        const filters = [
          highPass > 0 ? `highpass=f=${highPass}` : "",
          lowPass < 22000 ? `lowpass=f=${lowPass}` : "",
          noiseReduction > 0 ? `afftdn=nr=${Math.max(1, Math.round(noiseReduction / 4))}` : "",
          pitchShift !== 0 ? `asetrate=${Math.round(sampleRate * pitchFactor)},aresample=${sampleRate},atempo=${(1 / pitchFactor).toFixed(5)}` : "",
          tempo !== 1 ? `atempo=${tempo.toFixed(3)}` : "",
          volumeBoost !== 1 ? `volume=${volumeBoost.toFixed(2)}` : "",
          MODE_FILTERS[conversionMode] || "",
          EQ_FILTERS[equalizer] || "",
          reverbLevel > 0 ? buildReverbFilter(reverbLevel) : "",
          ...eqBands.map((g, i) => g !== 0 ? `equalizer=f=${EQ_BAND_FREQS[i]}:t=o:w=0.7:g=${g.toFixed(1)}` : ""),
          stereoWidth !== 1 && channelMode !== "mono" ? `aformat=channel_layouts=stereo,extrastereo=m=${stereoWidth.toFixed(2)}` : "",
          compression > 0 ? `acompressor=threshold=-18dB:ratio=${(1 + compression / 25).toFixed(2)}:attack=10:release=160:makeup=${Math.max(1, compression / 45).toFixed(2)}` : "",
          normalizeLoudness ? `loudnorm=I=${loudnessTarget.toFixed(1)}:TP=-1.5:LRA=9` : "",
          conversionMode !== "standard" || compression > 0 || limiterCeiling < 0.98 ? `alimiter=limit=${limiterCeiling.toFixed(2)}` : "",
          channelMode === "mono" ? "aformat=channel_layouts=stereo,pan=mono|c0=0.5*c0+0.5*c1" : "",
          fadeIn > 0 ? `afade=t=in:st=0:d=${fadeIn.toFixed(2)}` : "",
          fadeOut > 0 && trimEnd > trimStart ? `afade=t=out:st=${Math.max(0, trimEnd - trimStart - fadeOut).toFixed(2)}:d=${fadeOut.toFixed(2)}` : ""
        ].filter(Boolean);

        const ytdlpArgs = [
          "--no-playlist", "--no-mtime", "--concurrent-fragments", "8",
          "--retries", "3", "--fragment-retries", "3",
          "--compat-options", "filename-sanitization",
          "-f", "bestaudio/best",
          "-o", path.join(jobDir, "source.%(ext)s"), url
        ];

        job.progressPercent = 5;
        await runCommand(YTDLP_BIN, ytdlpArgs, { cwd, timeout: 10 * 60 * 1000 });
        job.progressPercent = 30;

        const sourceFiles = (await fsp.readdir(jobDir)).filter((f) => !f.endsWith(".part") && !f.endsWith(".ytdl"));
        const sourceFile = sourceFiles[0];
        if (!sourceFile) throw new Error("No source audio downloaded.");
        const sourcePath = path.join(jobDir, sourceFile);
        const baseOutputPath = path.join(jobDir, `${title}_base.${format}`);
        const finalOutputPath = path.join(jobDir, `${title}.${format}`);
        const duration = trimEnd > trimStart ? trimEnd - trimStart : 0;

        const ffmpegArgs = [
          "-hide_banner", "-y", "-progress", "pipe:1", "-nostats",
          ...(trimStart > 0 ? ["-ss", trimStart.toFixed(2)] : []),
          "-i", sourcePath,
          ...(duration > 0 ? ["-t", duration.toFixed(2)] : []),
          "-vn", "-ar", String(sampleRate),
          ...(filters.length > 0 ? ["-af", filters.join(",")] : []),
          ...getOutputCodecArgs(format, bitrate),
          "-metadata", `title=${title}`,
          ...(artistRaw ? ["-metadata", `artist=${artistRaw}`] : []),
          ...(albumRaw ? ["-metadata", `album=${albumRaw}`] : []),
          ...(genreRaw ? ["-metadata", `genre=${genreRaw}`] : []),
          ...(yearRaw ? ["-metadata", `date=${yearRaw}`] : []),
          embedThumbnail ? baseOutputPath : finalOutputPath
        ];

        const ffmpegExec = await getFfmpegExecutable();
        await runFfmpegWithProgress(ffmpegExec, ffmpegArgs,
          { cwd, timeout: 10 * 60 * 1000, durationSeconds },
          (pct) => { job.progressPercent = 30 + Math.round(pct * 0.7); }
        );

        if (embedThumbnail && thumbnailUrl && ["mp3", "m4a", "aac", "flac"].includes(format)) {
          try {
            const thumbPath = path.join(jobDir, "cover.jpg");
            const thumbRes = await fetch(thumbnailUrl);
            if (thumbRes.ok) {
              await fsp.writeFile(thumbPath, Buffer.from(await thumbRes.arrayBuffer()));
              const embedArgs = [
                "-hide_banner", "-y", "-i", baseOutputPath, "-i", thumbPath,
                "-map", "0:a", "-map", "1:v", "-c:a", "copy",
                "-c:v", format === "flac" ? "copy" : "mjpeg",
                ...(format === "mp3" ? ["-id3v2_version", "3", "-metadata:s:v:0", "title=Album cover", "-metadata:s:v:0", "comment=Cover (front)"] : []),
                ...(format === "m4a" || format === "aac" ? ["-disposition:v:0", "attached_pic"] : []),
                finalOutputPath
              ];
              await runCommand(ffmpegExec, embedArgs, { cwd, timeout: 2 * 60 * 1000 });
            } else { await fsp.rename(baseOutputPath, finalOutputPath); }
          } catch { try { await fsp.rename(baseOutputPath, finalOutputPath); } catch (_) {} }
        }

        job.outputPath = finalOutputPath;
        job.filename = `${title}.${format}`;
        job.contentType = AUDIO_CONTENT_TYPES[format];
        job.status = "done";
        job.progressPercent = 100;
      } catch (e: any) {
        console.error("Background job error:", e);
        job.status = "error";
        job.error = parseErrorMessage(e.message || String(e));
        if (jobDir) fsp.rm(jobDir, { recursive: true, force: true }).catch(() => {});
      }
    })();
  });

  // 5b. SSE stream for job progress
  app.get("/api/job-progress/:jobId", (req, res) => {
    const { jobId } = req.params;
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    const send = (data: object) => {
      try { res.write(`data: ${JSON.stringify(data)}\n\n`); } catch (_) {}
    };

    let closed = false;
    const poll = setInterval(() => {
      if (closed) return;
      const job = conversionJobs.get(jobId);
      if (!job) { send({ type: "error", message: "Job not found or expired." }); clearInterval(poll); res.end(); return; }
      if (job.status === "running") { send({ type: "progress", progress: job.progressPercent }); }
      else if (job.status === "done") { send({ type: "done", progress: 100 }); clearInterval(poll); res.end(); }
      else { send({ type: "error", message: job.error || "Conversion failed." }); clearInterval(poll); res.end(); }
    }, 250);

    req.on("close", () => { closed = true; clearInterval(poll); });
  });

  // 5c. Download completed job output
  app.get("/api/job-download/:jobId", async (req, res) => {
    const { jobId } = req.params;
    const job = conversionJobs.get(jobId);
    if (!job) return res.status(404).send("Job not found or expired.");
    if (job.status === "running") return res.status(202).send("Still processing.");
    if (job.status === "error") return res.status(500).send(job.error || "Conversion failed.");
    try {
      const enc = encodeURIComponent(job.filename);
      res.setHeader("Content-Disposition", `attachment; filename="${enc}"; filename*=UTF-8''${enc}`);
      res.setHeader("Content-Type", job.contentType);
      const stream = fs.createReadStream(job.outputPath);
      stream.pipe(res);
      const cleanup = () => { fsp.rm(job.tmpDir, { recursive: true, force: true }).catch(() => {}); conversionJobs.delete(jobId); };
      res.on("finish", cleanup);
      res.on("close", cleanup);
    } catch (e: any) {
      if (!res.headersSent) res.status(500).send("Download failed: " + e.message);
    }
  });

  // 6. Related/watch-next videos via youtubei.js
  app.post("/api/related", async (req, res) => {
    try {
      const { url } = req.body;
      if (!url) return res.status(400).json({ error: "URL required" });
      const videoId = getYouTubeVideoId(url);
      if (!videoId) return res.status(400).json({ error: "Invalid YouTube URL" });

      const { Innertube } = await import("youtubei.js");
      const youtube = await Innertube.create();
      const info = await youtube.getInfo(videoId);
      const feed: any[] = info.watch_next_feed || [];
      const results = feed
        .filter((item: any) => item.type === "CompactVideo" || item.video_id)
        .slice(0, 8)
        .map((item: any) => ({
          title: item.title?.text || item.title || "Unknown",
          channel: item.author?.name || item.channel_name || "Unknown",
          url: `https://www.youtube.com/watch?v=${item.video_id || item.id}`
        }))
        .filter((item: any) => !item.url.endsWith("undefined"));
      res.json(results);
    } catch (e: any) {
      console.error("Related videos error:", e);
      res.status(500).json({ error: "Failed to fetch related videos." });
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
