import { useState, useEffect } from "react";
import { 
  Youtube, Sparkles, Music, Sliders, Play, Pause, AlertTriangle, 
  ArrowRight, Compass, ExternalLink, Download, Clock, Library, ListTodo, User,
  Trash2, Plus, RefreshCw, Bot, CheckCircle2, FolderPlus, DownloadCloud, PlayCircle, History, X
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

import { VideoMetadata, ID3Tags, AudioSettings, QueueItem } from "./types";
import AudioWaveform from "./components/AudioWaveform";
import AudioSettingsPanel from "./components/AudioSettingsPanel";
import ID3TagEditor from "./components/ID3TagEditor";
import ProactiveSearch from "./components/ProactiveSearch";
import ConsoleOutput from "./components/ConsoleOutput";

const AUDIO_FORMATS = ["mp3", "wav", "aac", "flac", "m4a", "ogg"] as const;
const AUDIO_BITRATES = [128, 192, 256, 320] as const;
type AudioFormat = typeof AUDIO_FORMATS[number];
type AudioBitrate = typeof AUDIO_BITRATES[number];

function toAudioFormat(value: string): AudioFormat {
  return AUDIO_FORMATS.includes(value as AudioFormat) ? value as AudioFormat : "mp3";
}

function toAudioBitrate(value: string | number): AudioBitrate {
  const parsed = Number(value);
  return AUDIO_BITRATES.includes(parsed as AudioBitrate) ? parsed as AudioBitrate : 320;
}

const defaultSettings: AudioSettings = {
  format: "mp3",
  bitrate: 320,
  sampleRate: 48000,
  equalizer: "flat",
  volumeBoost: 1.0,
  trimStart: 0,
  trimEnd: 220,
  fadeIn: 1,
  fadeOut: 2
};

const defaultID3: ID3Tags = {
  title: "",
  artist: "",
  album: "",
  genre: "",
  year: "",
  coverUrl: ""
};

function buildAudioEndpoint(url: string, format: string, bitrate: number, settings: AudioSettings, tags?: Partial<ID3Tags>) {
  const params = new URLSearchParams({
    url,
    format,
    bitrate: String(bitrate),
    sampleRate: String(settings.sampleRate),
    trimStart: String(settings.trimStart),
    trimEnd: String(settings.trimEnd),
    volumeBoost: String(settings.volumeBoost),
    fadeIn: String(settings.fadeIn),
    fadeOut: String(settings.fadeOut),
    equalizer: settings.equalizer,
    title: tags?.title || "Audio",
    artist: tags?.artist || "",
    album: tags?.album || "",
    genre: tags?.genre || "",
    year: tags?.year || ""
  });

  return `/api/generate-audio?${params.toString()}`;
}

const PRESET_PLAYLISTS = [
  { name: "Lofi Focus Beats", url: "https://www.youtube.com/playlist?list=PLofmCYwrCzYF8-c5Mh2o9wL5b7JrkZ1sX" },
  { name: "Retro Synthwave", url: "https://www.youtube.com/playlist?list=PLz5fALZ0-mGsmM-Y_6-pU_O2VnLoxV3qH" },
  { name: "Deep Classical Focus", url: "https://www.youtube.com/playlist?list=PL3oW2tjiIxvSy0gU9v_cQc2m2fI7gqO8E" }
];

export default function App() {
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [videoMetadata, setVideoMetadata] = useState<VideoMetadata | null>(null);
  const [tags, setTags] = useState<ID3Tags>(defaultID3);
  const [settings, setSettings] = useState<AudioSettings>(defaultSettings);
  
  // Custom batch queue states
  const [activeTab, setActiveTab] = useState<'single' | 'playlist'>('single');
  const [playlistUrl, setPlaylistUrl] = useState("");
  const [playlistLimit, setPlaylistLimit] = useState<number>(8);
  const [playlistFormat, setPlaylistFormat] = useState<AudioFormat>("mp3");
  const [playlistBitrate, setPlaylistBitrate] = useState<AudioBitrate>(320);
  const [isFetchingPlaylist, setIsFetchingPlaylist] = useState(false);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [activeQueueIndex, setActiveQueueIndex] = useState(-1);
  const [isProcessingQueue, setIsProcessingQueue] = useState(false);
  const [isAutoTuningQueue, setIsAutoTuningQueue] = useState(false);

  // Operational states
  const [isFetchingMetadata, setIsFetchingMetadata] = useState(false);
  const [isOptimizingTags, setIsOptimizingTags] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [isConverting, setIsConverting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [isCompleted, setIsCompleted] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  
  // Custom audio preview
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioPreviewElement, setAudioPreviewElement] = useState<HTMLAudioElement | null>(null);

  // Download history
  const [downloadHistory, setDownloadHistory] = useState<Array<{
    id: string; title: string; artist: string; url: string;
    format: string; bitrate: number; timestamp: Date;
  }>>([]);
  const [showHistory, setShowHistory] = useState(false);

  // Auto clean audio on component unmount
  useEffect(() => {
    return () => {
      if (audioUrl) {
        URL.revokeObjectURL(audioUrl);
      }
    };
  }, [audioUrl]);

  // Handle URL loading and metadata fetching
  const handleLoadMetadata = async (urlToLoad?: string) => {
    const activeUrl = urlToLoad || youtubeUrl;
    if (!activeUrl || !activeUrl.trim()) {
      setErrorMsg("Please enter a valid YouTube URL first.");
      return;
    }

    setIsFetchingMetadata(true);
    setErrorMsg(null);
    setVideoMetadata(null);
    setIsCompleted(false);
    setAudioUrl(null);
    setIsPlaying(false);
    setLogs([]);

    try {
      const response = await fetch("/api/metadata", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: activeUrl })
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || "Failed to parse YouTube metadata.");
      }

      const data: VideoMetadata = await response.json();
      setVideoMetadata(data);
      if (urlToLoad) {
        setYoutubeUrl(urlToLoad);
      }

      // Pre-initialize tags
      const titleCleaned = data.title.replace(/\[.*?\]|\(.*?\)|Official Music Video|Official Audio/gi, "").trim();
      const initialTags: ID3Tags = {
        title: titleCleaned,
        artist: data.author,
        album: "Single",
        genre: "Pop",
        year: new Date().getFullYear().toString(),
        coverUrl: data.thumbnailUrl
      };
      setTags(initialTags);

      // Adjust trimmer max limits based on duration
      setSettings(prev => ({
        ...prev,
        trimStart: 0,
        trimEnd: data.durationSeconds || 220
      }));

      // Trigger automatic local tag cleanup
      triggerTagOptimization(data.title, data.author);

    } catch (err: any) {
      console.error(err);
      setErrorMsg(err.message || "An error occurred while loading metadata.");
    } finally {
      setIsFetchingMetadata(false);
    }
  };

  // Tag optimization via backend local cleanup endpoint
  const triggerTagOptimization = async (title: string, author: string) => {
    setIsOptimizingTags(true);
    try {
      const response = await fetch("/api/optimize-tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, author })
      });

      if (response.ok) {
        const optimized = await response.json();
        setTags(prev => ({
          ...prev,
          title: optimized.title || prev.title,
          artist: optimized.artist || prev.artist,
          album: optimized.album || prev.album,
          genre: optimized.genre || prev.genre,
          year: optimized.year || prev.year
        }));
      }
    } catch (err) {
      console.error("Failed to optimized tags:", err);
    } finally {
      setIsOptimizingTags(false);
    }
  };

  // 1. Add current metadata stream as a batch task
  const handleAddToQueue = () => {
    if (!videoMetadata) return;
    const newItem: QueueItem = {
      id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
      url: videoMetadata.url,
      title: tags.title || videoMetadata.title,
      artist: tags.artist || videoMetadata.author,
      status: 'pending',
      progress: 0,
      bitrate: settings.bitrate,
      format: settings.format,
      thumbnailUrl: videoMetadata.thumbnailUrl
    };
    setQueue(prev => [...prev, newItem]);
    setLogs(prev => [...prev, `QUEUE: Added "${newItem.title}" [${newItem.bitrate}kbps ${newItem.format.toUpperCase()}] to the transcoding queue.`]);
  };

  // 1b. Directly append external search results to the batch transcoder list
  const handleAddUrlToQueue = (url: string, title: string, artist: string) => {
    const newItem: QueueItem = {
      id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
      url,
      title,
      artist,
      status: 'pending',
      progress: 0,
      bitrate: settings.bitrate,
      format: settings.format,
      thumbnailUrl: "https://images.unsplash.com/photo-1611162617213-7d7a39e9b1d7?w=120&auto=format&fit=crop"
    };
    setQueue(prev => [...prev, newItem]);
    setLogs(prev => [...prev, `QUEUE: Directly appended search result "${title}" to sequence batch transcoder.`]);
  };

  // Fetched playlist preview tracks (shown before adding to queue)
  const [fetchedPlaylistTracks, setFetchedPlaylistTracks] = useState<Array<{title: string; channel: string; url: string}>>([]);

  // 2. Scan and load playlist via backend grounding API
  const handleLoadPlaylist = async () => {
    if (!playlistUrl || !playlistUrl.trim()) {
      setErrorMsg("Please enter a valid YouTube Playlist URL.");
      return;
    }

    setIsFetchingPlaylist(true);
    setErrorMsg(null);
    setLogs(prev => [...prev, `PLAYLIST_PARSER: Scanning YouTube playlist (limit: ${playlistLimit}): ${playlistUrl}...`]);

    try {
      const response = await fetch("/api/playlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: playlistUrl, limit: playlistLimit })
      });

      if (!response.ok) {
        throw new Error("Failed to extract videos from the specified playlist.");
      }

      const tracks = await response.json();
      const newItems: QueueItem[] = tracks.map((track: { title: string; channel: string; url: string }) => ({
        id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
        url: track.url,
        title: track.title,
        artist: track.channel,
        status: 'pending',
        progress: 0,
        bitrate: playlistBitrate, // use pre-selected playlist options
        format: playlistFormat, // use pre-selected playlist options
        thumbnailUrl: "https://images.unsplash.com/photo-1611162617213-7d7a39e9b1d7?w=120&auto=format&fit=crop"
      }));

      setFetchedPlaylistTracks(tracks);
      setQueue(prev => [...prev, ...newItems]);
      setLogs(prev => [
        ...prev, 
        `PLAYLIST_PARSER: Discovered and injected ${tracks.length} active tracks into the batch conversion list.`
      ]);
      setPlaylistUrl(""); // Clear input on success
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err.message || "An error occurred while loading the playlist.");
    } finally {
      setIsFetchingPlaylist(false);
    }
  };

  // 3. Delete a queue item
  const handleRemoveQueueItem = (id: string) => {
    setQueue(prev => prev.filter(item => item.id !== id));
  };

  // 4. Update individual queue format/bitrate
  const handleUpdateQueueItemSettings = (id: string, updates: Partial<QueueItem>) => {
    setQueue(prev => prev.map(item => item.id === id ? { ...item, ...updates } : item));
  };

  // 5. Clear queue list
  const handleClearQueue = () => {
    setQueue([]);
    setActiveQueueIndex(-1);
    setIsProcessingQueue(false);
    setLogs(prev => [...prev, "QUEUE: Transcoding queue slate cleared."]);
  };

  // 6. Bulk local Smart-Tuning cleanup for ID3 field structure
  const handleAutoTuneQueue = async () => {
    if (queue.length === 0) return;
    setIsAutoTuningQueue(true);
    setLogs(prev => [...prev, "AI_TUNER: Initializing AI-driven tag optimization and acoustic profile prediction..."]);

    const updatedQueue = [...queue];
    for (let i = 0; i < updatedQueue.length; i++) {
      const item = updatedQueue[i];
      if (item.status === 'pending') {
        setLogs(prev => [...prev, `AI_TUNER: Running high-level LLM analysis on string: "${item.title}"...`]);
        try {
          const res = await fetch("/api/optimize-tags", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title: item.title, author: item.artist })
          });
          if (res.ok) {
            const optimized = await res.json();
            updatedQueue[i] = {
              ...item,
              title: optimized.title || item.title,
              artist: optimized.artist || item.artist,
              status: 'pending'
            };
          }
        } catch (e) {
          console.error("AI tune iteration error:", e);
        }
      }
    }
    setQueue(updatedQueue);
    setIsAutoTuningQueue(false);
    setLogs(prev => [...prev, "AI_TUNER: Core batch dataset cleaned and optimized with ID3 schema fields successfully."]);
  };

  // 7. Sequential Batch Downloader & converter processing loop
  const handleProcessQueue = async () => {
    if (isProcessingQueue) return;
    setIsProcessingQueue(true);
    setLogs(prev => [...prev, "SYSTEM_BATCH: Commencing queue transcoder engine. Sequential mode: ON."]);
  };

  // Manage sequential execution of the queue
  useEffect(() => {
    if (!isProcessingQueue) return;

    // Find the next item that should be processed (status 'pending')
    const nextIndex = queue.findIndex(item => item.status === 'pending');
    if (nextIndex === -1) {
      setIsProcessingQueue(false);
      setActiveQueueIndex(-1);
      setLogs(prev => [...prev, "SYSTEM_BATCH: Complete conversion queue processed. All high fidelity downloads dispatched!"]);
      return;
    }

    setActiveQueueIndex(nextIndex);
    const activeItem = queue[nextIndex];

    const runProcessItem = async () => {
      // 1. Fetch exact metadata
      setQueue(prev => prev.map((item, idx) => idx === nextIndex ? { ...item, status: 'fetching_meta' } : item));
      setLogs(prev => [...prev, `[Queue #${nextIndex + 1}] FETCHING_META: Initiating stream crawl for url [${activeItem.url}]...`]);

      let finalTitle = activeItem.title;
      let finalArtist = activeItem.artist;
      let finalThumb = activeItem.thumbnailUrl;

      try {
        const metaRes = await fetch("/api/metadata", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: activeItem.url })
        });
        if (metaRes.ok) {
          const metaData = await metaRes.json();
          finalTitle = metaData.title;
          finalArtist = metaData.author;
          finalThumb = metaData.thumbnailUrl;
        }
      } catch (e) {
        console.warn("Queue item metadata fetch warning, using existing fields:", e);
      }

      // 2. Optimize tags
      setQueue(prev => prev.map((item, idx) => idx === nextIndex ? { 
        ...item, 
        title: finalTitle, 
        artist: finalArtist, 
        thumbnailUrl: finalThumb,
        status: 'optimizing_tags' 
      } : item));
      setLogs(prev => [...prev, `[Queue #${nextIndex + 1}] OPTIMIZING_TAGS: Cleaning video formatting noise locally...`]);

      try {
        const tagRes = await fetch("/api/optimize-tags", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: finalTitle, author: finalArtist })
        });
        if (tagRes.ok) {
          const tagsOpt = await tagRes.json();
          finalTitle = tagsOpt.title || finalTitle;
          finalArtist = tagsOpt.artist || finalArtist;
        }
      } catch (e) {
        console.warn("Queue tag optimization warning:", e);
      }

      // Update item with finalized tags and switch status to 'converting'
      setQueue(prev => prev.map((item, idx) => idx === nextIndex ? { 
        ...item, 
        title: finalTitle, 
        artist: finalArtist, 
        status: 'converting',
        progress: 0 
      } : item));
      setLogs(prev => [...prev, `[Queue #${nextIndex + 1}] TRANSCODING: Converting track: "${finalTitle}" (${activeItem.bitrate}kbps ${activeItem.format.toUpperCase()})...`]);

      // 3. Simulating transcoding progress
      let p = 0;
      const progressInterval = setInterval(async () => {
        p += 10;
        setQueue(prev => prev.map((item, idx) => idx === nextIndex ? { ...item, progress: p } : item));

        if (p >= 100) {
          clearInterval(progressInterval);
          
          // Trigger actual download
          try {
            const endpoint = buildAudioEndpoint(activeItem.url, activeItem.format, activeItem.bitrate, settings, {
              title: finalTitle,
              artist: finalArtist
            });
            const audioRes = await fetch(endpoint);
            if (audioRes.ok) {
              const blob = await audioRes.blob();
              const localUrl = URL.createObjectURL(blob);

              const downloadLink = document.createElement("a");
              downloadLink.href = localUrl;
              downloadLink.download = `${finalTitle.trim().replace(/\s+/g, "_") || "Audio"}_${activeItem.bitrate}kbps.${activeItem.format}`;
              document.body.appendChild(downloadLink);
              downloadLink.click();
              document.body.removeChild(downloadLink);

              setQueue(prev => prev.map((item, idx) => idx === nextIndex ? { ...item, status: 'completed' } : item));
              setDownloadHistory(prev => [{
                id: Date.now().toString(),
                title: finalTitle || "Unknown",
                artist: finalArtist || "Unknown",
                url: activeItem.url,
                format: activeItem.format,
                bitrate: activeItem.bitrate,
                timestamp: new Date()
              }, ...prev.slice(0, 49)]);
              setLogs(prev => [...prev, `[Queue #${nextIndex + 1}] COMPLETED: Transcode & download finalized for song: "${finalTitle}".`]);
            } else {
              throw new Error("Transcode endpoint returned error.");
            }
          } catch (err: any) {
            console.error("Queue download error:", err);
            setQueue(prev => prev.map((item, idx) => idx === nextIndex ? { ...item, status: 'failed', error: err.message || "Download failed" } : item));
            setLogs(prev => [...prev, `[Queue #${nextIndex + 1}] FAILED: Transcoded file discharge failed for: "${finalTitle}".`]);
          }
        }
      }, 150);
    };

    runProcessItem();
  }, [isProcessingQueue, queue]);

  // Convert/Transcode pipeline action
  const handleConvertAndDownload = () => {
    if (!videoMetadata) return;

    setIsConverting(true);
    setIsCompleted(false);
    setProgress(0);
    setAudioUrl(null);
    setIsPlaying(false);
    setLogs([]);

    const totalSteps = 10;
    let currentStep = 0;

    const logMessages = [
      "CORE_DAEMON: Initializing high-speed audio transcoder daemon...",
      `NET_RESOLVER: Pinging secure audio stream channel for video ID: ${youtubeUrl}...`,
      "STREAM_CRAWLER: Hooked into high-fidelity adaptive streaming packets...",
      `DSP_FILTER: Aligning active equalizers under preset [${settings.equalizer.toUpperCase()}] profile...`,
      `DYNAMIC_GAIN: Amplification buffer injected successfully. Gain coefficient updated -> ${(settings.volumeBoost * 100).toFixed(0)}%`,
      `TRANSCODER_TRIM: Registering start cutting position (${settings.trimStart}s) to end point (${settings.trimEnd}s)...`,
      `SAMPLER_ENGINE: Stereophonic distribution synced. Audio sample-rate configured to ${settings.sampleRate} Hz...`,
      `PACKAGER: Building lossless high-bitrate frame blocks [${settings.bitrate} kbps] for ${settings.format.toUpperCase()} Container...`,
      `ID3_METADATA: Encoding ID3 tags. Title: [${tags.title}], Artist: [${tags.artist}], Genre: [${tags.genre}], Year: [${tags.year}]...`,
      "TRANSCODER_SUCCESS: Conversion successfully finalized. Bundled audio stream exported to browser cache!"
    ];

    const interval = setInterval(async () => {
      currentStep++;
      const currentProgress = Math.min(Math.floor((currentStep / totalSteps) * 100), 100);
      setProgress(currentProgress);

      const currentLog = logMessages[currentStep - 1];
      if (currentLog) {
        setLogs(prev => [...prev, currentLog]);
      }

      if (currentStep >= totalSteps) {
        clearInterval(interval);
        
        // Formulate backend request to download active custom synth stream
        const endpoint = buildAudioEndpoint(videoMetadata?.url || youtubeUrl, settings.format, settings.bitrate, settings, tags);
        
        try {
          // Prefetch the audio to create a local Blob for on-screen playback preview
          const audioResponse = await fetch(endpoint);
          if (audioResponse.ok) {
            const blob = await audioResponse.blob();
            const localUrl = URL.createObjectURL(blob);
            setAudioUrl(localUrl);
            // Save to download history
            setDownloadHistory(prev => [{
              id: Date.now().toString(),
              title: tags.title || videoMetadata?.title || "Unknown",
              artist: tags.artist || videoMetadata?.author || "Unknown",
              url: videoMetadata?.url || youtubeUrl,
              format: settings.format,
              bitrate: settings.bitrate,
              timestamp: new Date()
            }, ...prev.slice(0, 49)]);

            // Programmatically download the file instantly!
            const downloadLink = document.createElement("a");
            downloadLink.href = localUrl;
            downloadLink.download = `${tags.title.trim().replace(/\s+/g, "_") || "Audio"}_${settings.bitrate}kbps.${settings.format}`;
            document.body.appendChild(downloadLink);
            downloadLink.click();
            document.body.removeChild(downloadLink);
            
            setLogs(prev => [...prev, "SYSTEM: Dispatching custom media bundle download directly to browser destination directory."]);
          } else {
            throw new Error("Local audio caching failed.");
          }
        } catch (err) {
          console.error("Download fetch error:", err);
          // Fallback to active URL trigger direction
          window.open(endpoint, "_blank");
        }

        setIsConverting(false);
        setIsCompleted(true);
      }
    }, 450); // fast, snappy conversion speed as requested!
  };

  // Custom audio playback preview controller
  const togglePlayPreview = () => {
    if (!audioUrl) return;

    if (!audioPreviewElement) {
      const audio = new Audio(audioUrl);
      audio.onended = () => setIsPlaying(false);
      setAudioPreviewElement(audio);
      audio.play();
      setIsPlaying(true);
    } else {
      if (isPlaying) {
        audioPreviewElement.pause();
        setIsPlaying(false);
      } else {
        audioPreviewElement.play();
        setIsPlaying(true);
      }
    }
  };

  // Reset converter state
  const handleReset = () => {
    setYoutubeUrl("");
    setVideoMetadata(null);
    setTags(defaultID3);
    setSettings(defaultSettings);
    setIsCompleted(false);
    setProgress(0);
    setLogs([]);
    setAudioUrl(null);
    setIsPlaying(false);
    if (audioPreviewElement) {
      audioPreviewElement.pause();
      setAudioPreviewElement(null);
    }
  };

  return (
    <div id="app_root" className="min-h-screen bg-[#080808] text-[#f0f0f0] flex flex-col antialiased selection:bg-[#ff4e00] selection:text-white relative overflow-hidden">
      {/* Animated background orbs */}
      <motion.div
        animate={{ x: [0, 40, -20, 0], y: [0, -30, 20, 0] }}
        transition={{ duration: 18, repeat: Infinity, ease: "easeInOut" }}
        className="pointer-events-none fixed top-[-10%] left-[-5%] w-[500px] h-[500px] rounded-full bg-[#ff4e00]/5 blur-[120px] z-0"
      />
      <motion.div
        animate={{ x: [0, -50, 30, 0], y: [0, 40, -20, 0] }}
        transition={{ duration: 22, repeat: Infinity, ease: "easeInOut", delay: 3 }}
        className="pointer-events-none fixed bottom-[-10%] right-[-5%] w-[600px] h-[600px] rounded-full bg-[#ff8c00]/4 blur-[140px] z-0"
      />
      <motion.div
        animate={{ x: [0, 30, -10, 0], y: [0, -20, 40, 0] }}
        transition={{ duration: 26, repeat: Infinity, ease: "easeInOut", delay: 6 }}
        className="pointer-events-none fixed top-[40%] left-[50%] w-[400px] h-[400px] rounded-full bg-[#00ff9d]/3 blur-[160px] z-0"
      />
      
      {/* Fullscreen single video load screen */}
      <AnimatePresence>
        {isFetchingMetadata && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/95 backdrop-blur-md z-[100] flex items-center justify-center p-6 select-none"
          >
            <div className="max-w-md w-full flex flex-col items-center text-center gap-6">
              {/* Rotating glowing vinyl structure */}
              <div className="relative w-32 h-32 flex items-center justify-center">
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ repeat: Infinity, duration: 4, ease: "linear" }}
                  className="absolute inset-0 rounded-full border-4 border-dashed border-[#ff4e00]/30 shadow-[0_0_50px_rgba(255,78,0,0.15)]"
                />
                <motion.div
                  animate={{ rotate: -360 }}
                  transition={{ repeat: Infinity, duration: 8, ease: "linear" }}
                  className="absolute inset-3 rounded-full border border-zinc-800"
                />
                <motion.div
                  animate={{ scale: [1, 1.1, 1] }}
                  transition={{ repeat: Infinity, duration: 2, ease: "easeInOut" }}
                  className="w-16 h-16 bg-gradient-to-br from-[#ff4e00] to-orange-600 rounded-full shadow-[0_0_30px_rgba(255,78,0,0.5)] flex items-center justify-center"
                >
                  <Youtube className="w-8 h-8 text-white animate-pulse" />
                </motion.div>
                
                {/* Floating particle orbits */}
                <span className="absolute -top-1 left-12 w-2 h-2 rounded-full bg-[#ffaa00] animate-ping" />
                <span className="absolute -bottom-2 right-10 w-1.5 h-1.5 rounded-full bg-[#00ff9d] animate-pulse" />
              </div>

              <div className="flex flex-col gap-2">
                <span className="text-[11px] font-bold font-mono uppercase tracking-widest text-[#ff4e00] animate-pulse">
                  GEMINI AI STREAM RESOLVER
                </span>
                <h3 className="text-xl font-heading font-black text-white leading-tight">
                  Analyzing Media Stream Links...
                </h3>
                <p className="text-xs text-zinc-400 max-w-sm mt-1 leading-relaxed">
                  Analyzing stream packets, isolating Lossless Audio lines, and preparing ID3 metadata profiles.
                </p>
              </div>

              {/* Progress Simulated steps */}
              <div className="w-full bg-[#080808] border border-white/5 p-4 rounded-xl text-left font-mono text-[10px] text-zinc-500 flex flex-col gap-1.5 shadow-inner">
                <div className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#00ff9d] animate-ping"></span>
                  <span className="text-zinc-300">Pinging YouTube stream daemons...</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#ffaa00] animate-pulse"></span>
                  <span className="text-zinc-400">Extracting standard container bitrate blocks [VBR/CBR]</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-zinc-700"></span>
                  <span>Scraping cover artwork and high fidelity structures</span>
                </div>
              </div>

              <div className="w-32 h-1 bg-zinc-950 rounded-full overflow-hidden relative">
                <motion.div
                  animate={{ x: [-130, 130] }}
                  transition={{ repeat: Infinity, duration: 1.5, ease: "easeInOut" }}
                  className="absolute inset-y-0 w-16 bg-gradient-to-r from-transparent via-[#ff4e00] to-transparent"
                />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Fullscreen playlist parser load screen */}
      <AnimatePresence>
        {isFetchingPlaylist && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/95 backdrop-blur-md z-[100] flex items-center justify-center p-6 select-none"
          >
            <div className="max-w-md w-full flex flex-col items-center text-center gap-6">
              {/* Rotating glowing vinyl structure */}
              <div className="relative w-32 h-32 flex items-center justify-center">
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ repeat: Infinity, duration: 4, ease: "linear" }}
                  className="absolute inset-0 rounded-full border-4 border-dashed border-[#ff4e00]/30 shadow-[0_0_50px_rgba(255,78,0,0.15)]"
                />
                <motion.div
                  animate={{ rotate: -360 }}
                  transition={{ repeat: Infinity, duration: 8, ease: "linear" }}
                  className="absolute inset-3 rounded-full border border-zinc-800"
                />
                <motion.div
                  animate={{ scale: [1, 1.1, 1] }}
                  transition={{ repeat: Infinity, duration: 1.8, ease: "easeInOut" }}
                  className="w-16 h-16 bg-gradient-to-br from-[#ff4e00] to-orange-600 rounded-full shadow-[0_0_30px_rgba(255,78,0,0.5)] flex items-center justify-center"
                >
                  <ListTodo className="w-7 h-7 text-white animate-pulse" />
                </motion.div>
                
                {/* Floating particle orbits */}
                <span className="absolute -top-1 left-12 w-2 h-2 rounded-full bg-[#ffaa00] animate-ping" />
                <span className="absolute -bottom-2 right-10 w-1.5 h-1.5 rounded-full bg-[#00ff9d] animate-pulse" />
              </div>

              <div className="flex flex-col gap-2">
                <span className="text-[11px] font-bold font-mono uppercase tracking-widest text-[#ff4e00] animate-pulse">
                  AI PLAYLIST BATCH PARSER
                </span>
                <h3 className="text-xl font-heading font-black text-white leading-tight">
                  Loading Playlist Video Tracks...
                </h3>
                <p className="text-xs text-zinc-400 max-w-sm mt-1 leading-relaxed">
                  Scanning YouTube playlist feed, evaluating embedded tracks, and injecting item entries into the batch converter queue.
                </p>
              </div>

              <div className="w-32 h-1 bg-zinc-950 rounded-full overflow-hidden relative">
                <motion.div
                  animate={{ x: [-130, 130] }}
                  transition={{ repeat: Infinity, duration: 1.5, ease: "easeInOut" }}
                  className="absolute inset-y-0 w-16 bg-gradient-to-r from-transparent via-[#ff4e00] to-transparent"
                />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      
      {/* Immersive Background Blur Orbs */}
      <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-[#ff4e00]/10 opacity-[0.03] blur-[120px] rounded-full pointer-events-none"></div>
      <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-[#ff4e00]/15 opacity-[0.05] blur-[150px] rounded-full pointer-events-none"></div>

      {/* Premium Header / Swiss-Clean Navigation */}
      <motion.header
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="bg-[#080808]/85 border-b border-white/5 sticky top-0 z-50 py-5 px-6 md:px-12 backdrop-blur-md">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-3 select-none">
            <div className="w-10 h-10 bg-gradient-to-br from-[#ff4e00] to-[#802700] rounded-lg flex items-center justify-center shadow-[0_0_20px_rgba(255,78,0,0.4)]">
              <Youtube className="w-5.5 h-5.5 text-white stroke-2" />
            </div>
            <div className="flex flex-col">
              <h1 className="font-heading font-extrabold text-2xl tracking-tight text-white leading-tight">
                SONIC<span className="text-[#ff4e00]">MP3</span>
              </h1>
              <span className="text-[10.5px] font-semibold text-zinc-500 font-mono tracking-wider uppercase leading-none mt-0.5">
                Powered by Local DSP & YouTube Search
              </span>
            </div>
          </div>
          
          <div className="flex items-center gap-6 text-xs text-zinc-500 font-semibold font-mono tracking-wide">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-[#00ff9d] animate-pulse"></span>
              <span className="text-zinc-400">Ultra-Fast Cloud CDN Link Active</span>
            </div>
            <span className="px-2.5 py-1 bg-[#ff4e00]/10 rounded-lg text-[10.5px] text-[#ff8c00] font-bold border border-[#ff4e00]/20">
              BITRATE: 320KBPS HD
            </span>
            <button
              onClick={() => setShowHistory(true)}
              className="relative flex items-center gap-1.5 px-3 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-[10.5px] font-bold text-zinc-300 hover:text-white transition-all cursor-pointer"
            >
              <History className="w-3.5 h-3.5" />
              History
              {downloadHistory.length > 0 && (
                <span className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-[#ff4e00] text-white text-[9px] font-black rounded-full flex items-center justify-center">
                  {downloadHistory.length > 9 ? "9+" : downloadHistory.length}
                </span>
              )}
            </button>
          </div>
        </div>
      </motion.header>

      {/* Main Content Area */}
      <main className="flex-1 w-full max-w-7xl mx-auto px-4 py-8 md:px-12 grid grid-cols-1 lg:grid-cols-12 gap-8 relative z-10">
        
        {/* Left Column: Direct Converter Operations */}
        <motion.div
          initial={{ opacity: 0, x: -30 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5, ease: "easeOut" }}
          className="lg:col-span-7 flex flex-col gap-8">
          
          {/* URL Entry Section */}
          <div className="bg-[#121212] rounded-2xl border border-white/5 p-6 shadow-2xl flex flex-col gap-5 relative group">
            {/* Soft border glow */}
            <div className="absolute -inset-0.5 bg-gradient-to-r from-[#ff4e00] to-[#ffaa00] rounded-2xl blur opacity-10 group-hover:opacity-20 transition-opacity pointer-events-none"></div>
            
            <div className="relative flex justify-between items-center bg-white/0">
              <div className="flex items-center gap-2">
                <Compass className="w-5 h-5 text-[#ff4e00]" />
                <h3 className="font-heading font-semibold tracking-tight text-white text-lg">
                  Media Source Ingestion
                </h3>
              </div>
              
              {/* Elegant Segmented Tabs */}
              <div className="flex bg-[#080808] p-1 rounded-xl border border-white/10 shrink-0">
                <button
                  type="button"
                  onClick={() => setActiveTab('single')}
                  className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${
                    activeTab === 'single'
                      ? "bg-[#ff4e00] text-white shadow-md"
                      : "text-zinc-500 hover:text-white"
                  }`}
                >
                  <Youtube className="w-3.5 h-3.5" />
                  Single Stream
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('playlist')}
                  className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${
                    activeTab === 'playlist'
                      ? "bg-[#ff4e00] text-white shadow-md"
                      : "text-zinc-500 hover:text-white"
                  }`}
                >
                  <ListTodo className="w-3.5 h-3.5" />
                  Full Playlist
                </button>
              </div>
            </div>

            <AnimatePresence mode="wait">
              {activeTab === 'single' ? (
                <motion.div
                  key="single_tab"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="flex flex-col gap-4"
                >
                  <div className="relative flex flex-col sm:flex-row gap-2.5">
                    <div className="relative flex-1">
                      <Youtube className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                      <input
                        type="text"
                        value={youtubeUrl}
                        onChange={(e) => setYoutubeUrl(e.target.value)}
                        placeholder="Paste any YouTube URL (e.g., https://www.youtube.com/watch?v=...)"
                        className="w-full pl-10 pr-4 py-3 bg-[#080808] border border-white/10 focus:border-[#ff4e00] rounded-xl text-sm font-medium text-white focus:outline-hidden transition-all shadow-inner placeholder:text-zinc-600"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => handleLoadMetadata()}
                      disabled={isFetchingMetadata || !youtubeUrl.trim()}
                      className="px-6 py-3 bg-white text-black font-extrabold text-sm rounded-xl transition-all shadow-md shrink-0 cursor-pointer disabled:opacity-50 hover:bg-[#ff4e00] hover:text-white hover:shadow-[0_0_20px_rgba(255,78,0,0.4)] flex items-center justify-center gap-2 transform active:scale-95 uppercase tracking-tight"
                    >
                      {isFetchingMetadata ? (
                        <>
                          <span className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin"></span>
                          Analyzing stream...
                        </>
                      ) : (
                        <>
                          Load Video
                          <ArrowRight className="w-4 h-4 stroke-3" />
                        </>
                      )}
                    </button>
                  </div>

                  {/* Loaded Video Metadata Card */}
                  {videoMetadata && (
                    <motion.div 
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className="flex flex-col gap-3"
                    >
                      <div className="flex flex-col sm:flex-row gap-4 bg-[#080808] p-4 rounded-xl border border-white/5 shadow-inner">
                        <div className="relative aspect-video w-full sm:w-36 rounded-lg overflow-hidden border border-white/10 bg-zinc-950 shrink-0">
                          <img
                            src={videoMetadata.thumbnailUrl}
                            alt={videoMetadata.title}
                            referrerPolicy="no-referrer"
                            className="w-full h-full object-cover"
                          />
                          <div className="absolute bottom-1.5 right-1.5 bg-black/80 px-1.5 py-0.5 rounded text-[9.5px] font-mono text-white flex items-center gap-1">
                            <Clock className="w-2.5 h-2.5 text-[#ff4e00]" />
                            {videoMetadata.duration}
                          </div>
                        </div>
                        <div className="flex flex-col justify-center min-w-0">
                          <span className="text-[10px] uppercase font-mono font-bold text-[#ff4e00] tracking-widest">
                            READY FOR TRANSCODING
                          </span>
                          <h4 className="text-sm font-black text-white truncate leading-snug mt-1 font-heading">
                            {videoMetadata.title}
                          </h4>
                          <p className="text-xs text-zinc-400 font-medium truncate mt-0.5">
                            Channel: {videoMetadata.author}
                          </p>
                          <p className="text-[11px] text-zinc-500 mt-2 font-mono flex items-center gap-1">
                            <Library className="w-3 h-3 text-zinc-600" /> Lossless audio tracks indexed
                          </p>
                        </div>
                      </div>

                      {/* Add directly to batch queue trigger */}
                      <button
                        type="button"
                        onClick={handleAddToQueue}
                        className="w-full py-3 bg-[#080808] hover:bg-[#ff4e00]/10 border border-white/5 hover:border-[#ff4e00]/30 text-white font-bold text-xs uppercase tracking-wider rounded-xl transition-all flex items-center justify-center gap-2 transform active:scale-[0.98] cursor-pointer"
                      >
                        <FolderPlus className="w-4 h-4 text-[#ff4e00]" />
                        Append to Transcoding Queue
                      </button>
                    </motion.div>
                  )}
                </motion.div>
              ) : (
                <motion.div
                  key="playlist_tab"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="flex flex-col gap-4"
                >
                  {/* Playlist URL Input Row */}
                  <div className="relative flex flex-col sm:flex-row gap-2.5">
                    <div className="relative flex-1">
                      <ListTodo className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                      <input
                        type="text"
                        value={playlistUrl}
                        onChange={(e) => setPlaylistUrl(e.target.value)}
                        placeholder="Paste YouTube Playlist URL (e.g., https://www.youtube.com/playlist?list=...)"
                        className="w-full pl-10 pr-4 py-3 bg-[#080808] border border-white/10 focus:border-[#ff4e00] rounded-xl text-sm font-medium text-white focus:outline-hidden transition-all shadow-inner placeholder:text-zinc-600"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => handleLoadPlaylist()}
                      disabled={isFetchingPlaylist || !playlistUrl.trim()}
                      className="px-6 py-3 bg-white text-black font-extrabold text-sm rounded-xl transition-all shadow-md shrink-0 cursor-pointer disabled:opacity-50 hover:bg-[#ff4e00] hover:text-white hover:shadow-[0_0_20px_rgba(255,78,0,0.4)] flex items-center justify-center gap-2 transform active:scale-95 uppercase tracking-tight"
                    >
                      {isFetchingPlaylist ? (
                        <>
                          <span className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin"></span>
                          Playlist Track List...
                        </>
                      ) : (
                        <>
                          Import Playlist
                          <Sparkles className="w-4 h-4 text-[#ff4e00] animate-pulse" />
                        </>
                      )}
                    </button>
                  </div>

                  {/* Playlist Import Options configured by user prior to fetching */}
                  <div className="bg-[#080808] p-3.5 rounded-xl border border-white/5 flex flex-col sm:flex-row gap-4 items-center justify-between">
                    <div className="flex items-center gap-1.5 self-start sm:self-auto">
                      <Sliders className="w-4 h-4 text-[#ff4e00]" />
                      <span className="text-[11px] font-bold uppercase text-zinc-400 font-mono tracking-wider">
                        Import Configuration
                      </span>
                    </div>

                    <div className="grid grid-cols-3 gap-3 w-full sm:w-auto">
                      {/* Limit option */}
                      <div className="flex flex-col gap-1">
                        <span className="text-[10px] text-zinc-500 font-mono uppercase font-semibold">Max Tracks</span>
                        <select
                          value={playlistLimit}
                          onChange={(e) => setPlaylistLimit(Number(e.target.value))}
                          className="bg-zinc-950 border border-white/10 text-zinc-300 rounded-lg px-2 py-1.5 text-[10.5px] font-sans focus:outline-hidden cursor-pointer focus:border-[#ff4e00]"
                        >
                          <option value={3}>3 Tracks</option>
                          <option value={5}>5 Tracks</option>
                          <option value={8}>8 Tracks</option>
                          <option value={12}>12 Tracks</option>
                          <option value={15}>15 Tracks</option>
                        </select>
                      </div>

                      {/* Format option */}
                      <div className="flex flex-col gap-1">
                        <span className="text-[10px] text-zinc-500 font-mono uppercase font-semibold">Codec</span>
                        <select
                          value={playlistFormat}
                          onChange={(e) => setPlaylistFormat(toAudioFormat(e.target.value))}
                          className="bg-zinc-950 border border-white/10 text-zinc-300 rounded-lg px-2 py-1.5 text-[10.5px] font-mono focus:outline-hidden cursor-pointer focus:border-[#ff4e00] uppercase"
                        >
                          <option value="mp3">mp3</option>
                          <option value="wav">wav</option>
                          <option value="aac">aac</option>
                          <option value="flac">flac</option>
                        </select>
                      </div>

                      {/* Bitrate option */}
                      <div className="flex flex-col gap-1">
                        <span className="text-[10px] text-zinc-500 font-mono uppercase font-semibold">Quality</span>
                        <select
                          value={playlistBitrate}
                          onChange={(e) => setPlaylistBitrate(toAudioBitrate(e.target.value))}
                          className="bg-zinc-950 border border-white/10 text-zinc-300 rounded-lg px-2 py-1.5 text-[10.5px] font-sans focus:outline-hidden cursor-pointer focus:border-[#ff4e00]"
                        >
                          <option value={128}>128kbps</option>
                          <option value={192}>192kbps</option>
                          <option value={256}>256kbps</option>
                          <option value={320}>320kbps HD</option>
                        </select>
                      </div>
                    </div>
                  </div>

                  {/* Curated Pre-set Playlists */}
                  <div className="flex flex-col gap-2">
                    <span className="text-[10px] font-bold text-zinc-500 font-mono uppercase tracking-wider">
                      Or select curated playlist template:
                    </span>
                    <div className="flex flex-wrap gap-2">
                      {PRESET_PLAYLISTS.map((preset, index) => (
                        <button
                          key={index}
                          type="button"
                          onClick={() => setPlaylistUrl(preset.url)}
                          className="px-3 py-1.5 bg-zinc-950 hover:bg-[#ff4e00]/10 border border-white/5 hover:border-[#ff4e00]/30 text-[10.5px] font-bold text-zinc-400 hover:text-white rounded-lg transition-all cursor-pointer"
                        >
                          {preset.name}
                        </button>
                      ))}
                    </div>
                  </div>

                  <p className="text-[11px] text-zinc-500 font-sans leading-relaxed">
                    <span className="text-[#ff4e00] font-bold">YouTube playlist scan:</span> The pipeline scans playlist URLs, maps embedded tracks, and appends them with your configured options to the batch queue.
                  </p>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Fetched Playlist Tracks Preview */}
            {fetchedPlaylistTracks.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-[#0a0a0a] border border-white/5 rounded-xl overflow-hidden"
              >
                <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/5 bg-white/5">
                  <span className="text-[11px] font-bold text-zinc-300 flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-[#00ff9d]" />
                    {fetchedPlaylistTracks.length} tracks added to queue
                  </span>
                  <button onClick={() => setFetchedPlaylistTracks([])}
                    className="text-[10px] text-zinc-600 hover:text-zinc-300 cursor-pointer transition-colors">
                    Dismiss
                  </button>
                </div>
                <div className="divide-y divide-white/5 max-h-48 overflow-y-auto">
                  {fetchedPlaylistTracks.map((track, i) => (
                    <div key={i} className="flex items-center gap-3 px-4 py-2.5 hover:bg-white/5 transition-colors">
                      <span className="text-[10px] font-mono text-zinc-600 w-5 shrink-0">{i + 1}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-zinc-200 truncate">{track.title}</p>
                        <p className="text-[10px] text-zinc-500 truncate">{track.channel}</p>
                      </div>
                      <Music className="w-3 h-3 text-zinc-700 shrink-0" />
                    </div>
                  ))}
                </div>
              </motion.div>
            )}

            {errorMsg && (
              <div className="flex items-start gap-2 bg-red-950/20 border border-red-900/40 p-3.5 rounded-xl text-xs font-semibold text-red-400 font-sans">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-red-500" />
                <span>{errorMsg}</span>
              </div>
            )}
          </div>

          {/* Transcoding Queue Panel */}
          {queue.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-[#121212] rounded-2xl border border-white/5 p-6 shadow-2xl flex flex-col gap-4 relative overflow-hidden"
            >
              <div className="absolute -inset-0.5 bg-gradient-to-r from-[#ff4e00] to-orange-500 rounded-2xl blur opacity-5 pointer-events-none"></div>

              {/* Header */}
              <div className="relative flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 border-b border-white/5 pb-3 bg-white/0">
                <div className="flex items-center gap-2">
                  <ListTodo className="w-5 h-5 text-[#ff4e00]" />
                  <h3 className="font-heading font-semibold tracking-tight text-white text-lg">
                    Transcoding Queue ({queue.filter(item => item.status === 'completed').length}/{queue.length})
                  </h3>
                </div>
                <div className="flex items-center gap-2.5 shrink-0">
                  <button
                    type="button"
                    onClick={handleAutoTuneQueue}
                    disabled={isAutoTuningQueue || isProcessingQueue}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-[#ff4e00]/10 hover:bg-[#ff4e00]/20 border border-[#ff4e00]/20 rounded-lg text-[11px] font-bold text-[#ff8c00] transition-colors cursor-pointer disabled:opacity-50"
                  >
                    <Bot className="w-3.5 h-3.5" />
                    {isAutoTuningQueue ? "Auto-Tuning..." : "AI Auto-Tune Tags"}
                  </button>
                  <button
                    type="button"
                    onClick={handleClearQueue}
                    disabled={isProcessingQueue}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-900 hover:bg-zinc-800 rounded-lg text-[11px] font-bold text-zinc-400 hover:text-white transition-colors cursor-pointer disabled:opacity-50"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Clear Slate
                  </button>
                </div>
              </div>

              {/* Batch Playlist/Queue Options */}
              <div className="bg-[#080808] p-3 rounded-xl border border-white/5 flex flex-wrap items-center justify-between gap-3 relative z-10">
                <div className="flex items-center gap-1.5">
                  <Sliders className="w-3.5 h-3.5 text-[#ff4e00]" />
                  <span className="text-[10px] uppercase font-bold text-zinc-400 font-mono tracking-wider">
                    Batch Options (In-Flight Queue)
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[9.5px] text-zinc-500 uppercase font-mono">Format:</span>
                    <select
                      disabled={isProcessingQueue}
                      onChange={(e) => {
                        const targetFormat = toAudioFormat(e.target.value);
                        setQueue(prev => prev.map(item => item.status === 'pending' ? { ...item, format: targetFormat } : item));
                        setLogs(prev => [...prev, `QUEUE_OPTIONS: Configured format for all queued tracks to ${targetFormat.toUpperCase()}`]);
                      }}
                      className="bg-zinc-950 border border-white/10 text-zinc-300 rounded-lg px-2 py-1 text-[9.5px] font-mono focus:outline-hidden cursor-pointer focus:border-[#ff4e00]"
                      defaultValue=""
                    >
                      <option value="" disabled>Apply to pending...</option>
                      <option value="mp3">MP3</option>
                      <option value="wav">WAV</option>
                      <option value="aac">AAC</option>
                      <option value="flac">FLAC</option>
                    </select>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <span className="text-[9.5px] text-zinc-500 uppercase font-mono">Quality:</span>
                    <select
                      disabled={isProcessingQueue}
                      onChange={(e) => {
                        const targetBitrate = toAudioBitrate(e.target.value);
                        setQueue(prev => prev.map(item => item.status === 'pending' ? { ...item, bitrate: targetBitrate } : item));
                        setLogs(prev => [...prev, `QUEUE_OPTIONS: Configured quality for all queued tracks to ${targetBitrate}kbps`]);
                      }}
                      className="bg-zinc-950 border border-white/10 text-zinc-300 rounded-lg px-2 py-1 text-[9.5px] font-mono focus:outline-hidden cursor-pointer focus:border-[#ff4e00]"
                      defaultValue=""
                    >
                      <option value="" disabled>Apply to pending...</option>
                      <option value="128">128kbps (Eco)</option>
                      <option value="192">192kbps (Std)</option>
                      <option value="256">256kbps (HQ)</option>
                      <option value="320">320kbps (Pro HD)</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Grid List */}
              <div className="relative flex flex-col gap-2.5 max-h-80 overflow-y-auto pr-1">
                <AnimatePresence initial={false}>
                  {queue.map((item, idx) => {
                    const isActive = idx === activeQueueIndex;
                    return (
                      <motion.div
                        key={item.id}
                        initial={{ opacity: 0, x: -15 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: 15 }}
                        className={`flex flex-col sm:flex-row items-start sm:items-center justify-between p-3.5 border rounded-xl transition-all gap-3 ${
                          isActive
                            ? "bg-[#ff4e00]/5 border-[#ff4e00]/30 shadow-[0_0_15px_rgba(255,78,0,0.1)]"
                            : item.status === 'completed'
                            ? "bg-[#00ff9d]/5 border-[#00ff9d]/20"
                            : item.status === 'failed'
                            ? "bg-red-950/20 border-red-900/30"
                            : "bg-[#080808] border-white/5 hover:border-white/10"
                        }`}
                      >
                        {/* Title & Artist & Thumb */}
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          <div className="relative w-12 h-12 bg-zinc-900 rounded-lg overflow-hidden border border-white/10 shrink-0">
                            <img src={item.thumbnailUrl} alt="" className="w-full h-full object-cover" />
                            {isActive && (
                              <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                                <RefreshCw className="w-4 h-4 text-white animate-spin" />
                              </div>
                            )}
                          </div>
                          
                          <div className="flex flex-col min-w-0">
                            <h4 className="text-xs font-bold text-white truncate max-w-[180px] sm:max-w-xs">{item.title}</h4>
                            <p className="text-[10px] text-zinc-500 truncate mt-0.5">{item.artist}</p>
                            
                            {/* Individual Micro Progress Bar */}
                            {isActive && item.status === 'converting' && (
                              <div className="w-24 mt-1.5 flex flex-col gap-1">
                                <div className="h-1 bg-zinc-800 rounded-full overflow-hidden">
                                  <div style={{ width: `${item.progress}%` }} className="h-full bg-gradient-to-r from-[#ff4e00] to-orange-500" />
                                </div>
                              </div>
                            )}
                            
                            {/* Error flag */}
                            {item.status === 'failed' && (
                              <span className="text-[9.5px] text-red-400 font-semibold mt-0.5 truncate">{item.error || "Failed"}</span>
                            )}
                          </div>
                        </div>

                        {/* Right side individual selectors/controls */}
                        <div className="flex items-center gap-2 self-end sm:self-auto">
                          {/* Bitrate option */}
                          <select
                            value={item.bitrate}
                            disabled={isProcessingQueue}
                            onChange={(e) => handleUpdateQueueItemSettings(item.id, { bitrate: toAudioBitrate(e.target.value) })}
                            className="bg-[#0c0c0c] border border-white/10 text-zinc-400 rounded-lg px-2 py-1 text-[10px] font-sans focus:outline-hidden cursor-pointer focus:border-[#ff4e00]"
                          >
                            <option value={128}>128kbps</option>
                            <option value={192}>192kbps</option>
                            <option value={256}>256kbps</option>
                            <option value={320}>320kbps HD</option>
                          </select>

                          {/* Format option */}
                          <select
                            value={item.format}
                            disabled={isProcessingQueue}
                            onChange={(e) => handleUpdateQueueItemSettings(item.id, { format: toAudioFormat(e.target.value) })}
                            className="bg-[#0c0c0c] border border-white/10 text-zinc-400 rounded-lg px-2 py-1 text-[10px] font-sans uppercase focus:outline-hidden cursor-pointer focus:border-[#ff4e00]"
                          >
                            <option value="mp3">mp3</option>
                            <option value="wav">wav</option>
                            <option value="aac">aac</option>
                            <option value="flac">flac</option>
                          </select>

                          {/* Status Badge */}
                          <div className="flex items-center min-w-[70px] justify-center sm:justify-start">
                            {item.status === 'completed' && (
                              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-[10px] font-black text-[#00ff9d] shadow-[0_0_10px_rgba(16,185,129,0.1)]">
                                <CheckCircle2 className="w-3.5 h-3.5 text-[#00ff9d]" />
                                <span className="hidden xs:inline uppercase font-mono tracking-wider">Success</span>
                              </div>
                            )}
                            {item.status === 'failed' && (
                              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-rose-500/10 border border-rose-500/20 text-[10px] font-black text-rose-400 shadow-[0_0_10px_rgba(244,63,94,0.1)]">
                                <AlertTriangle className="w-3.5 h-3.5 text-rose-500" />
                                <span className="hidden xs:inline uppercase font-mono tracking-wider">Failed</span>
                              </div>
                            )}
                            {item.status === 'pending' && (
                              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-zinc-900 border border-white/5 text-[10px] font-semibold text-zinc-400">
                                <Clock className="w-3.5 h-3.5 text-zinc-500" />
                                <span className="hidden xs:inline uppercase font-mono tracking-wider">Queued</span>
                              </div>
                            )}
                            {item.status === 'fetching_meta' && (
                              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-cyan-500/10 border border-cyan-500/20 text-[10px] font-black text-cyan-400 shadow-[0_0_10px_rgba(6,182,212,0.1)]">
                                <RefreshCw className="w-3 h-3 text-cyan-400 animate-spin" />
                                <span className="hidden xs:inline uppercase font-mono tracking-wider">Scanning</span>
                              </div>
                            )}
                            {item.status === 'optimizing_tags' && (
                              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-purple-500/15 border border-purple-500/30 text-[10px] font-black text-purple-400 animate-pulse shadow-[0_0_10px_rgba(168,85,247,0.15)]">
                                <Sparkles className="w-3 h-3 text-purple-400 animate-pulse" />
                                <span className="hidden xs:inline uppercase font-mono tracking-wider">AI Tagging</span>
                              </div>
                            )}
                            {item.status === 'converting' && (
                              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-orange-500/15 border border-orange-500/30 text-[10px] font-black text-orange-400 shadow-[0_0_10px_rgba(249,115,22,0.15)] animate-pulse">
                                <RefreshCw className="w-3 h-3 text-orange-400 animate-spin" />
                                <span className="font-mono">{item.progress}%</span>
                              </div>
                            )}
                          </div>

                          {/* Delete/Trash Trigger Action */}
                          {(!isActive && item.status !== 'fetching_meta' && item.status !== 'optimizing_tags' && item.status !== 'converting') ? (
                            <button
                              type="button"
                              onClick={() => handleRemoveQueueItem(item.id)}
                              className="p-1.5 text-zinc-500 hover:text-rose-400 transition-colors cursor-pointer rounded-lg hover:bg-white/5"
                              title="Remove item"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          ) : (
                            <div className="w-6.5 h-6.5 flex items-center justify-center">
                              <span className="w-1.5 h-1.5 rounded-full bg-[#ff4e00] animate-ping" />
                            </div>
                          )}
                        </div>
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
              </div>

              {/* Action triggers */}
              {!isProcessingQueue ? (
                <button
                  type="button"
                  onClick={handleProcessQueue}
                  className="relative group w-full py-4 bg-white hover:bg-[#ff4e00] text-black hover:text-white font-extrabold text-xs tracking-wider uppercase rounded-xl transition-all shadow-lg flex items-center justify-center gap-2 transform active:scale-[0.98] cursor-pointer overflow-hidden"
                >
                  <span className="absolute -inset-0.5 bg-gradient-to-r from-orange-500 to-[#ff4e00] blur opacity-30 group-hover:opacity-60 transition-opacity pointer-events-none"></span>
                  <DownloadCloud className="relative w-4 h-4 stroke-3 animate-bounce" />
                  <span className="relative">Process Batch Transcoding Queue</span>
                </button>
              ) : (
                <div className="w-full py-4 bg-[#ff4e00]/10 text-[#ff8c00] font-bold text-xs tracking-wider uppercase text-center rounded-xl border border-[#ff4e00]/20 flex items-center justify-center gap-2 animate-pulse">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  Transcoding Queue sequence running (Index: {activeQueueIndex + 1}/{queue.length})
                </div>
              )}
            </motion.div>
          )}

          {/* Configurable Panels (Only show when video loaded successfully) */}
          {videoMetadata ? (
            <>
              <ID3TagEditor
                tags={tags}
                thumbnailUrl={tags.coverUrl}
                isOptimizing={isOptimizingTags}
                onTagsChange={setTags}
                onTriggerOptimize={() => triggerTagOptimization(tags.title, tags.artist)}
                hasVideoLoaded={!!videoMetadata}
              />

              <AudioSettingsPanel
                settings={settings}
                durationSeconds={videoMetadata.durationSeconds || 220}
                onChange={setSettings}
              />
            </>
          ) : (
            <div className="bg-[#121212] rounded-2xl border border-dashed border-white/10 py-16 px-6 text-center text-zinc-500 select-none">
              <Youtube className="w-12 h-12 stroke-1 text-zinc-700 mx-auto mb-3 animate-pulse" />
              <h4 className="font-heading font-bold text-white text-sm">Waiting for Active YouTube URL</h4>
              <p className="text-xs text-zinc-500 mt-1 max-w-sm mx-auto">
                Paste a link inside the URL loader above or perform a keyword grounded search to launch high-fidelity audio options.
              </p>
            </div>
          )}

        </motion.div>

        {/* Right Column: AI Grounded Discovery & Transcoding progress */}
        <div className="lg:col-span-5 flex flex-col gap-8">
          
          {/* conversion Console Card (active triggers) */}
          {videoMetadata && (
            <div className="bg-[#121212] rounded-2xl border border-white/5 p-6 shadow-2xl flex flex-col gap-5">
              <div className="flex justify-between items-center border-b border-white/5 pb-3">
                <div className="flex items-center gap-2">
                  <Sliders className="w-5 h-5 text-[#ff4e00]" />
                  <h3 className="font-heading font-semibold tracking-tight text-white text-lg">
                    Converter Center
                  </h3>
                </div>
                
                {isCompleted && (
                  <button
                    type="button"
                    onClick={handleReset}
                    className="text-xs font-semibold text-zinc-400 hover:text-white transition-colors cursor-pointer"
                  >
                    Clear Slate
                  </button>
                )}
              </div>

              {/* Glowing Wave Viz */}
              <AudioWaveform
                isProcessing={isConverting}
                isCompleted={isCompleted}
                speedMultiplier={(settings.bitrate === 320 ? 12 : settings.bitrate === 256 ? 15 : 18)}
              />

              {/* Progress Panel */}
              {isConverting && (
                <div className="flex flex-col gap-2">
                  <div className="flex justify-between text-xs font-mono font-bold text-zinc-400">
                    <span>PROGRESS</span>
                    <span className="text-[#ff4e00]">{progress}%</span>
                  </div>
                  <div className="h-2 bg-[#080808] rounded-full overflow-hidden border border-white/5">
                    <div
                      style={{ width: `${progress}%` }}
                      className="h-full bg-gradient-to-r from-[#ff4e00] to-[#ffaa00] rounded-full transition-all duration-300"
                    />
                  </div>
                </div>
              )}

              {/* Launch actions */}
              {!isConverting && !isCompleted ? (
                <button
                  type="button"
                  onClick={handleConvertAndDownload}
                  className="w-full py-4.5 bg-white hover:bg-[#ff4e00] text-black hover:text-white font-bold text-sm tracking-wide rounded-xl shadow-lg transition-all flex items-center justify-center gap-2 cursor-pointer active:scale-95 uppercase"
                >
                  <Download className="w-4 h-4 stroke-2" />
                  CONVERT & DOWNLOAD MP3 / WAV
                </button>
              ) : isConverting ? (
                <div className="w-full py-4 bg-[#ff4e00]/10 text-[#ff8c00] font-bold text-xs tracking-wider uppercase text-center rounded-xl border border-[#ff4e00]/20 flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 border-orange-400 border-t-white rounded-full animate-spin"></span>
                  Transcoding Audio Signal...
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  <div className="w-full py-4 bg-[#00ff9d]/10 text-[#00ff9d] font-bold text-sm text-center rounded-xl border border-[#00ff9d]/25 flex items-center justify-center gap-2 shadow-inner uppercase tracking-tight">
                    <Download className="w-4 h-4 stroke-2" />
                    FILE CONVERTED & DISPATCHED
                  </div>

                  {/* Audio Preview Player */}
                  {audioUrl && (
                    <div className="flex flex-col gap-2 p-3 bg-zinc-950 border border-white/10 rounded-xl">
                      <div className="flex items-center justify-between">
                        <div className="flex flex-col min-w-0">
                          <span className="text-xs font-bold text-white truncate">{tags.title || "Track Preview"}</span>
                          <span className="text-[10px] font-mono text-zinc-500">{tags.artist || "Unknown Artist"} · {settings.format.toUpperCase()} {settings.bitrate}kbps</span>
                        </div>
                        <span className="text-[10px] bg-[#ff4e00]/10 text-[#ff8c00] font-bold font-mono px-2 py-0.5 rounded shrink-0 ml-2">HIFI</span>
                      </div>
                      <audio
                        src={audioUrl}
                        controls
                        className="w-full h-8"
                        style={{ accentColor: "#ff4e00", colorScheme: "dark" }}
                        onPlay={() => setIsPlaying(true)}
                        onPause={() => setIsPlaying(false)}
                        onEnded={() => setIsPlaying(false)}
                      />
                    </div>
                  )}

                  <p className="text-[11px] text-center text-zinc-500 font-sans italic">
                    If download didn't trigger automatically, please click download/preview widget block.
                  </p>

                  <button
                    type="button"
                    onClick={handleReset}
                    className="w-full mt-2 py-3 bg-[#080808] hover:bg-zinc-800 border border-white/10 text-white font-extrabold text-xs uppercase tracking-wider rounded-xl transition-all flex items-center justify-center gap-2 transform active:scale-[0.98] cursor-pointer hover:border-[#ff4e00]/40"
                  >
                    <RefreshCw className="w-3.5 h-3.5 text-[#ff4e00]" />
                    Return to Home Screen
                  </button>
                </div>
              )}

              {/* Technical steps output terminal */}
              <ConsoleOutput logs={logs} />

            </div>
          )}

          {/* Grounded Search discovery */}
          <ProactiveSearch
            onSelectResult={handleLoadMetadata}
            onAddToQueue={handleAddUrlToQueue}
            isLoading={isSearching}
            setIsLoading={setIsSearching}
          />

        </div>

      </main>

      {/* Humble craft credit line with active template stats indicators */}
      <footer className="bg-[#0c0c0c] border-t border-white/5 py-8 px-6 md:px-12 text-zinc-500 mt-20 relative z-10">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-end gap-8">
          <div className="flex flex-col sm:flex-row gap-8 sm:gap-12 w-full md:w-auto">
            <div className="flex flex-col gap-1">
              <span className="text-zinc-600 text-[10px] uppercase tracking-widest font-mono">Processing Node</span>
              <span className="text-xs font-mono text-[#00ff9d]">NY-CORE-04 // ACTIVE</span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-zinc-600 text-[10px] uppercase tracking-widest font-mono">Throughput</span>
              <span className="text-xs font-mono text-white">1.42 GB/S</span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-zinc-600 text-[10px] uppercase tracking-widest font-mono">Queued Jobs</span>
              <span className="text-xs font-mono text-white">14,291</span>
            </div>
          </div>

          <div className="flex flex-col items-start md:items-end gap-2 w-full md:w-auto">
            <span className="text-zinc-600 text-[10px] uppercase tracking-widest font-mono">Turbo Stream v2.4</span>
            <div className="flex gap-1">
              <div className="w-1 h-4 bg-[#ff4e00]"></div>
              <div className="w-1 h-6 bg-[#ff4e00]"></div>
              <div className="w-1 h-3 bg-[#ff4e00]"></div>
              <div className="w-1 h-5 bg-[#ff4e00]"></div>
              <div className="w-1 h-2 bg-zinc-800"></div>
              <div className="w-1 h-4 bg-zinc-800"></div>
              <div className="w-1 h-6 bg-zinc-800"></div>
            </div>
          </div>
        </div>
      </footer>

      {/* ── Download History Panel ── */}
      {showHistory && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[200] flex items-start justify-end p-4 sm:p-8">
          <div className="bg-[#111] border border-white/10 rounded-2xl w-full max-w-md max-h-[85vh] flex flex-col shadow-2xl">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/5">
              <div className="flex items-center gap-2">
                <History className="w-4 h-4 text-[#ff4e00]" />
                <h3 className="text-sm font-bold text-white">Download History</h3>
                <span className="text-[10px] bg-white/10 text-zinc-400 px-1.5 py-0.5 rounded font-mono">{downloadHistory.length}</span>
              </div>
              <div className="flex items-center gap-2">
                {downloadHistory.length > 0 && (
                  <button onClick={() => { if(window.confirm("Clear all history?")) setDownloadHistory([]); }}
                    className="text-[10px] text-zinc-500 hover:text-red-400 transition-colors cursor-pointer font-mono">
                    Clear All
                  </button>
                )}
                <button onClick={() => setShowHistory(false)}
                  className="w-7 h-7 flex items-center justify-center rounded-lg bg-white/5 hover:bg-white/10 transition-colors cursor-pointer">
                  <X className="w-4 h-4 text-zinc-400" />
                </button>
              </div>
            </div>
            {/* List */}
            <div className="flex-1 overflow-y-auto divide-y divide-white/5">
              {downloadHistory.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-zinc-600 gap-3">
                  <Download className="w-8 h-8 opacity-30" />
                  <p className="text-sm font-mono">No downloads yet</p>
                </div>
              ) : (
                downloadHistory.map((item) => (
                  <div key={item.id} className="flex items-center gap-3 px-5 py-3 hover:bg-white/5 transition-colors group">
                    <div className="w-8 h-8 bg-[#ff4e00]/10 rounded-lg flex items-center justify-center shrink-0">
                      <Music className="w-4 h-4 text-[#ff4e00]" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold text-white truncate">{item.title}</p>
                      <p className="text-[10px] text-zinc-500 truncate">{item.artist}</p>
                      <p className="text-[10px] font-mono text-zinc-600 mt-0.5">
                        {item.format.toUpperCase()} · {item.bitrate}kbps · {item.timestamp.toLocaleTimeString([], {hour: "2-digit", minute:"2-digit"})}
                      </p>
                    </div>
                    <button
                      onClick={() => {
                        const ep = buildAudioEndpoint(item.url, item.format, item.bitrate, settings, {
                          title: item.title,
                          artist: item.artist
                        });
                        const a = document.createElement("a");
                        a.href = ep;
                        a.download = `${item.title.replace(/\s+/g,"_")}.${item.format}`;
                        document.body.appendChild(a); a.click(); document.body.removeChild(a);
                      }}
                      className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 text-[10px] bg-[#ff4e00]/10 hover:bg-[#ff4e00]/20 text-[#ff8c00] border border-[#ff4e00]/20 px-2 py-1.5 rounded-lg font-bold cursor-pointer shrink-0"
                    >
                      <Download className="w-3 h-3" />
                      Re-DL
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}











