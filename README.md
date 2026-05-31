# SonicMP3

SonicMP3 is a local YouTube audio converter built with React, Vite, Express, yt-dlp, and ffmpeg. It supports single-track conversion, playlist queueing, YouTube search, DSP presets, trimming, fades, preview playback, download history, and local ID3 tag cleanup.

## Requirements

- Node.js
- ffmpeg available on your PATH, or set `FFMPEG_PATH` to the ffmpeg executable or containing folder

The project uses the bundled `youtube-dl-exec` yt-dlp binary when available.

## Run Locally

```bash
npm install
npm run dev
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000).

## Scripts

```bash
npm run lint
npm run build
npm start
```

`npm run build` creates the Vite frontend and bundles the Express server to `dist/server.cjs`.

## Deploy

Use the included `Dockerfile` for hosts that support container deployments. The container installs `ffmpeg`, builds the React app, and starts the bundled Express server.

For Render:

1. Push this repository to GitHub.
2. Create a new Render Blueprint or Web Service from the repo.
3. Use the included `render.yaml`, or choose Docker runtime manually.
4. Health check path: `/api/health`.

The server reads `PORT` from the hosting environment and falls back to `3000` locally.
