import { execFile, spawn } from "child_process";
import { promisify } from "util";
const execFileAsync = promisify(execFile);
const ytdlpPath = "./node_modules/youtube-dl-exec/bin/yt-dlp.exe";
// Get the direct stream URL using yt-dlp
try {
  const { stdout } = await execFileAsync(ytdlpPath, [
    "--get-url", "-f", "bestaudio",
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
  ], { timeout: 20000 });
  const url = stdout.trim();
  console.log("GOT_URL:", url ? "YES (first 80 chars): " + url.substring(0,80) : "NO");
} catch(e) {
  console.log("URL_ERROR:", e.message.substring(0,200));
}
