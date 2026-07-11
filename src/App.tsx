import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  Youtube, Sparkles, Music, Sliders, Play, Pause, AlertTriangle,
  ArrowRight, Compass, ExternalLink, Download, Clock, Library, ListTodo, User,
  Trash2, Plus, RefreshCw, Bot, CheckCircle2, FolderPlus, DownloadCloud, PlayCircle, History, X,
  FileDown, FileUp, Search, Filter, RotateCcw, Layers,
  Sun, Moon, GripVertical, Settings2, BookOpen, Save, FileMusic, ChevronDown, ChevronRight, Eye,
  Archive, Zap, Users, Activity, ChevronUp, Keyboard, ClipboardCheck, ShieldCheck
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

import { VideoMetadata, ID3Tags, AudioSettings, QueueItem, Chapter, SettingsPreset } from "./types";
import AudioWaveform from "./components/AudioWaveform";
import AudioSettingsPanel from "./components/AudioSettingsPanel";
import ID3TagEditor from "./components/ID3TagEditor";
import ProactiveSearch from "./components/ProactiveSearch";
import ConsoleOutput from "./components/ConsoleOutput";
import ToastContainer, { Toast } from "./components/Toast";
import { createZip } from "./utils/zip";

const AUDIO_FORMATS = ["mp3", "wav", "aac", "flac", "m4a", "ogg"] as const;
const AUDIO_BITRATES = [128, 192, 256, 320] as const;
const CONVERSION_STEP_MS = 90;
const QUEUE_PROGRESS_STEP_MS = 70;
const QUEUE_PROGRESS_INCREMENT = 20;
type AudioFormat = typeof AUDIO_FORMATS[number];
type AudioBitrate = typeof AUDIO_BITRATES[number];
type QueueStatusFilter = QueueItem["status"] | "all";
type FilenameTemplate = "title_bitrate" | "artist_title" | "title_mode" | "artist_title_mode";

interface BackendHealth {
  status: "ready" | "degraded" | "offline";
  uptimeSeconds: number;
  ffmpeg: string;
  ytdlp: string;
  formats: string[];
}

interface DownloadHistoryItem {
  id: string;
  title: string;
  artist: string;
  url: string;
  format: string;
  bitrate: number;
  timestamp: Date;
}

interface SonicWorkspace {
  settings?: AudioSettings;
  tags?: ID3Tags;
  queue?: QueueItem[];
  downloadHistory?: Array<Omit<DownloadHistoryItem, "timestamp"> & { timestamp: string }>;
  recentUrls?: string[];
  filenameTemplate?: FilenameTemplate;
  lightMode?: boolean;
  savedPresets?: SettingsPreset[];
}

const WORKSPACE_STORAGE_KEY = "sonicmp3.workspace.v1";

function toAudioFormat(value: string): AudioFormat {
  return AUDIO_FORMATS.includes(value as AudioFormat) ? value as AudioFormat : "mp3";
}

function toAudioBitrate(value: string | number): AudioBitrate {
  const parsed = Number(value);
  return AUDIO_BITRATES.includes(parsed as AudioBitrate) ? parsed as AudioBitrate : 320;
}

function formatUptime(seconds: number) {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function normalizeQueueItem(item: QueueItem): QueueItem {
  return {
    ...item,
    status: item.status === "completed" || item.status === "failed" ? "pending" : item.status,
    progress: item.status === "completed" || item.status === "failed" ? 0 : item.progress,
    bitrate: toAudioBitrate(item.bitrate),
    format: toAudioFormat(item.format)
  };
}

function safeFilenamePart(value: string, fallback = "Audio"): string {
  return (value || fallback)
    .replace(/[<>:"/\\|?*\r\n]/g, "")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 90) || fallback;
}

function toFilenameTemplate(value: string | undefined): FilenameTemplate {
  return value === "artist_title" || value === "title_mode" || value === "artist_title_mode"
    ? value
    : "title_bitrate";
}

function buildDownloadFilename(
  template: FilenameTemplate,
  details: { title: string; artist?: string; bitrate: number; format: string; mode?: string }
) {
  const title = safeFilenamePart(details.title, "Audio");
  const artist = safeFilenamePart(details.artist || "Unknown_Artist", "Unknown_Artist");
  const mode = safeFilenamePart((details.mode || "standard").replace(/_/g, " "), "standard");
  const base =
    template === "artist_title" ? `${artist}_${title}` :
    template === "title_mode" ? `${title}_${mode}` :
    template === "artist_title_mode" ? `${artist}_${title}_${mode}` :
    `${title}_${details.bitrate}kbps`;
  return `${base}.${details.format}`;
}

const defaultSettings: AudioSettings = {
  format: "mp3",
  bitrate: 320,
  sampleRate: 48000,
  conversionMode: "standard",
  equalizer: "flat",
  channelMode: "stereo",
  volumeBoost: 1.0,
  stereoWidth: 1.0,
  compression: 35,
  limiterCeiling: 0.95,
  normalizeLoudness: false,
  loudnessTarget: -14,
  noiseReduction: 0,
  highPass: 20,
  lowPass: 20000,
  tempo: 1,
  pitchShift: 0,
  trimStart: 0,
  trimEnd: 220,
  fadeIn: 1,
  fadeOut: 2,
  embedThumbnail: false,
  reverb: 0,
  eqBands: [0, 0, 0, 0, 0]
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
    conversionMode: settings.conversionMode,
    equalizer: settings.equalizer,
    channelMode: settings.channelMode,
    stereoWidth: String(settings.stereoWidth),
    compression: String(settings.compression),
    limiterCeiling: String(settings.limiterCeiling),
    normalizeLoudness: String(settings.normalizeLoudness),
    loudnessTarget: String(settings.loudnessTarget),
    noiseReduction: String(settings.noiseReduction),
    highPass: String(settings.highPass),
    lowPass: String(settings.lowPass),
    tempo: String(settings.tempo),
    pitchShift: String(settings.pitchShift),
    title: tags?.title || "Audio",
    artist: tags?.artist || "",
    album: tags?.album || "",
    genre: tags?.genre || "",
    year: tags?.year || "",
    embedThumbnail: String(settings.embedThumbnail),
    thumbnailUrl: tags?.coverUrl || "",
    reverb: String(settings.reverb ?? 0),
    eqBands: (settings.eqBands ?? [0,0,0,0,0]).join(",")
  });

  return `/api/generate-audio?${params.toString()}`;
}

const PRESET_PLAYLISTS = [
  { name: "Lofi Focus Beats", url: "https://www.youtube.com/playlist?list=PLofmCYwrCzYF8-c5Mh2o9wL5b7JrkZ1sX" },
  { name: "Retro Synthwave", url: "https://www.youtube.com/playlist?list=PLz5fALZ0-mGsmM-Y_6-pU_O2VnLoxV3qH" },
  { name: "Deep Classical Focus", url: "https://www.youtube.com/playlist?list=PL3oW2tjiIxvSy0gU9v_cQc2m2fI7gqO8E" }
];

const AUDIO_PROFILES: Array<{ label: string; description: string; settings: Partial<AudioSettings> }> = [
  {
    label: "Studio Master",
    description: "High-bitrate music archive",
    settings: { format: "mp3", bitrate: 320, sampleRate: 48000, conversionMode: "mastering", equalizer: "flat", channelMode: "stereo", volumeBoost: 1, stereoWidth: 1.15, compression: 45, limiterCeiling: 0.94, normalizeLoudness: true, loudnessTarget: -14, noiseReduction: 0, highPass: 25, lowPass: 19000, tempo: 1, pitchShift: 0, fadeIn: 1, fadeOut: 2 }
  },
  {
    label: "Podcast Voice",
    description: "Clear speech with vocal focus",
    settings: { format: "mp3", bitrate: 192, sampleRate: 44100, conversionMode: "vocal_master", equalizer: "vocal", channelMode: "mono", volumeBoost: 1.2, stereoWidth: 0.9, compression: 60, limiterCeiling: 0.93, normalizeLoudness: true, loudnessTarget: -16, noiseReduction: 30, highPass: 80, lowPass: 12000, tempo: 1, pitchShift: 0, fadeIn: 0, fadeOut: 1 }
  },
  {
    label: "Lossless Vault",
    description: "FLAC archival capture",
    settings: { format: "flac", bitrate: 320, sampleRate: 48000, conversionMode: "standard", equalizer: "flat", channelMode: "stereo", volumeBoost: 1, stereoWidth: 1, compression: 0, limiterCeiling: 0.98, normalizeLoudness: false, loudnessTarget: -14, noiseReduction: 0, highPass: 20, lowPass: 20000, tempo: 1, pitchShift: 0, fadeIn: 0, fadeOut: 0 }
  },
  {
    label: "Lo-Fi Cut",
    description: "Warm, compressed playlist feel",
    settings: { format: "mp3", bitrate: 256, sampleRate: 44100, conversionMode: "audio_mix", equalizer: "lofi", channelMode: "stereo", volumeBoost: 1.1, stereoWidth: 1.25, compression: 55, limiterCeiling: 0.92, normalizeLoudness: false, loudnessTarget: -14, noiseReduction: 10, highPass: 120, lowPass: 9000, tempo: 0.98, pitchShift: -1, fadeIn: 2, fadeOut: 3 }
  },
  {
    label: "Club Master",
    description: "Loud, wide DJ-ready export",
    settings: { format: "mp3", bitrate: 320, sampleRate: 48000, conversionMode: "club_master", equalizer: "bass", channelMode: "stereo", volumeBoost: 1.15, stereoWidth: 1.45, compression: 70, limiterCeiling: 0.9, normalizeLoudness: true, loudnessTarget: -10, noiseReduction: 0, highPass: 30, lowPass: 18000, tempo: 1, pitchShift: 0, fadeIn: 0, fadeOut: 2 }
  }
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
  const [queueSearchTerm, setQueueSearchTerm] = useState("");
  const [queueStatusFilter, setQueueStatusFilter] = useState<QueueStatusFilter>("all");
  const [filenameTemplate, setFilenameTemplate] = useState<FilenameTemplate>("title_bitrate");

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
  const [downloadHistory, setDownloadHistory] = useState<DownloadHistoryItem[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [recentUrls, setRecentUrls] = useState<string[]>([]);
  const [backendHealth, setBackendHealth] = useState<BackendHealth>({
    status: "offline",
    uptimeSeconds: 0,
    ffmpeg: "unknown",
    ytdlp: "unknown",
    formats: []
  });
  const [isWorkspaceReady, setIsWorkspaceReady] = useState(false);
  const queueFileInputRef = useRef<HTMLInputElement | null>(null);
  const localFileInputRef = useRef<HTMLInputElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Theme
  const [lightMode, setLightMode] = useState(false);

  // Drag-to-reorder
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

  // Per-item settings expansion
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);

  // Chapters
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [isFetchingChapters, setIsFetchingChapters] = useState(false);
  const [showChapters, setShowChapters] = useState(false);

  // Preview before download
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);

  // Audio time tracking (for waveform seek)
  const [audioCurrentTime, setAudioCurrentTime] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);

  // Settings presets
  const [savedPresets, setSavedPresets] = useState<SettingsPreset[]>([]);
  const [showPresetModal, setShowPresetModal] = useState(false);
  const [presetName, setPresetName] = useState("");

  // MusicBrainz loading
  const [isMusicBrainzLoading, setIsMusicBrainzLoading] = useState(false);

  // Local file conversion
  const [localFileTab, setLocalFileTab] = useState(false);
  const [localConvertFile, setLocalConvertFile] = useState<File | null>(null);
  const [localConvertFormat, setLocalConvertFormat] = useState<typeof AUDIO_FORMATS[number]>("mp3");
  const [localConvertBitrate, setLocalConvertBitrate] = useState<typeof AUDIO_BITRATES[number]>(320);
  const [isConvertingLocal, setIsConvertingLocal] = useState(false);

  // Toast notifications
  const [toasts, setToasts] = useState<Toast[]>([]);

  // Collapsible UI panels
  const [collapsedPanels, setCollapsedPanels] = useState<Set<string>>(new Set(["id3", "dsp", "console"]));

  // Related videos & artist discography
  const [relatedVideos, setRelatedVideos] = useState<Array<{title:string;channel:string;url:string}>>([]);
  const [isLoadingRelated, setIsLoadingRelated] = useState(false);
  const [showRelated, setShowRelated] = useState(false);
  const [artistVideos, setArtistVideos] = useState<Array<{title:string;channel:string;url:string}>>([]);
  const [isLoadingArtist, setIsLoadingArtist] = useState(false);
  const [showArtistVideos, setShowArtistVideos] = useState(false);

  // BPM detection
  const [detectedBpm, setDetectedBpm] = useState<number | null>(null);

  // Concurrent queue processing
  const [concurrentLimit, setConcurrentLimit] = useState(1);
  const [isQueuePaused, setIsQueuePaused] = useState(false);

  // Completed blobs for ZIP download
  const completedBlobsRef = useRef<Map<string, { data: Uint8Array; filename: string }>>(new Map());
  const [completedZipCacheSize, setCompletedZipCacheSize] = useState(0);

  // SSE cleanup
  const sseCleanupRef = useRef<(() => void) | null>(null);

  // Keyboard shortcut hint visibility
  const [showShortcuts, setShowShortcuts] = useState(false);

  const smartRecommendation = useMemo(() => {
    const source = `${tags.title} ${tags.artist} ${videoMetadata?.title || ""} ${videoMetadata?.author || ""}`.toLowerCase();
    const isPodcast = source.includes("podcast") || source.includes("interview") || source.includes("speech") || source.includes("lecture");
    const isLofi = source.includes("lofi") || source.includes("lo-fi") || source.includes("chill") || source.includes("study");
    const isClub = source.includes("club") || source.includes("edm") || source.includes("dance") || source.includes("remix") || (detectedBpm !== null && detectedBpm >= 118);
    const isArchive = settings.format === "flac" || source.includes("live") || source.includes("concert");

    if (isPodcast) {
      return {
        label: "Podcast Voice",
        reason: "Speech-first source detected. Mono, vocal EQ, denoise, and LUFS normalization will improve clarity.",
        settings: { conversionMode: "vocal_master", equalizer: "vocal", channelMode: "mono", bitrate: 192, compression: 62, normalizeLoudness: true, loudnessTarget: -16, noiseReduction: 30, stereoWidth: 0.9, reverb: 0 } as Partial<AudioSettings>
      };
    }
    if (isLofi) {
      return {
        label: "Lo-Fi Warmth",
        reason: "Chill/lo-fi cues found. Soft compression, a low-pass edge, and mild width fit playlist listening.",
        settings: { conversionMode: "audio_mix", equalizer: "lofi", bitrate: 256, compression: 52, normalizeLoudness: false, highPass: 120, lowPass: 9000, stereoWidth: 1.22, reverb: 8 } as Partial<AudioSettings>
      };
    }
    if (isClub) {
      return {
        label: "Club Master",
        reason: "Dance tempo or remix cues found. Louder target, wide stereo, bass EQ, and limiter headroom fit DJ playback.",
        settings: { conversionMode: "club_master", equalizer: "bass", bitrate: 320, compression: 72, normalizeLoudness: true, loudnessTarget: -10, stereoWidth: 1.45, reverb: 4 } as Partial<AudioSettings>
      };
    }
    if (isArchive) {
      return {
        label: "Archive Capture",
        reason: "Archive-style source detected. FLAC, minimal DSP, and high sample rate preserve the original signal.",
        settings: { format: "flac", bitrate: 320, sampleRate: 48000, conversionMode: "standard", equalizer: "flat", compression: 0, normalizeLoudness: false, stereoWidth: 1, reverb: 0 } as Partial<AudioSettings>
      };
    }
    return {
      label: "Studio Master",
      reason: "Balanced music profile. Clean mastering, moderate compression, and -14 LUFS suit general listening.",
      settings: { conversionMode: "mastering", equalizer: "flat", bitrate: 320, compression: 45, normalizeLoudness: true, loudnessTarget: -14, stereoWidth: 1.15, reverb: 0 } as Partial<AudioSettings>
    };
  }, [detectedBpm, settings.format, tags.artist, tags.title, videoMetadata?.author, videoMetadata?.title]);

  const queueStats = {
    pending: queue.filter(item => item.status === "pending").length,
    active: queue.filter(item => ["fetching_meta", "optimizing_tags", "converting"].includes(item.status)).length,
    completed: queue.filter(item => item.status === "completed").length,
    failed: queue.filter(item => item.status === "failed").length
  };
  const sessionHealth = useMemo(() => {
    const hasBackend = backendHealth.status === "ready";
    const queueLoad = queueStats.pending + queueStats.active;
    const status = !hasBackend ? "Needs backend" : queueStats.failed > 0 ? "Review failed jobs" : queueLoad > 0 ? "Ready for batch" : "Ready";
    return { cacheFiles: completedZipCacheSize, hasBackend, queueLoad, status };
  }, [backendHealth.status, completedZipCacheSize, queueStats.active, queueStats.failed, queueStats.pending]);
  const filteredQueueEntries = queue
    .map((item, idx) => ({ item, idx }))
    .filter(({ item }) => queueStatusFilter === "all" || item.status === queueStatusFilter)
    .filter(({ item }) => {
      const query = queueSearchTerm.trim().toLowerCase();
      if (!query) return true;
      return `${item.title} ${item.artist} ${item.url}`.toLowerCase().includes(query);
    });

  // Revoke blob URLs on cleanup
  useEffect(() => {
    return () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [audioUrl, previewUrl]);

  useEffect(() => {
    return () => {
      sseCleanupRef.current?.();
      sseCleanupRef.current = null;
    };
  }, []);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(WORKSPACE_STORAGE_KEY);
      if (raw) {
        const workspace = JSON.parse(raw) as SonicWorkspace;
        if (workspace.settings) setSettings({ ...defaultSettings, ...workspace.settings });
        if (workspace.tags) setTags({ ...defaultID3, ...workspace.tags });
        if (workspace.queue) setQueue(workspace.queue.map(normalizeQueueItem));
        if (workspace.recentUrls) setRecentUrls(workspace.recentUrls.slice(0, 8));
        setFilenameTemplate(toFilenameTemplate(workspace.filenameTemplate));
        if (typeof workspace.lightMode === "boolean") setLightMode(workspace.lightMode);
        if (workspace.savedPresets) setSavedPresets(workspace.savedPresets);
        if (workspace.downloadHistory) {
          setDownloadHistory(workspace.downloadHistory.map(item => ({
            ...item,
            timestamp: new Date(item.timestamp)
          })).filter(item => !Number.isNaN(item.timestamp.getTime())));
        }
      }
    } catch (err) {
      console.warn("Failed to restore Sonic workspace:", err);
    } finally {
      setIsWorkspaceReady(true);
    }
  }, []);

  useEffect(() => {
    if (!isWorkspaceReady) return;
    try {
      const workspace: SonicWorkspace = {
        settings,
        tags,
        queue,
        recentUrls,
        filenameTemplate,
        lightMode,
        savedPresets,
        downloadHistory: downloadHistory.map(item => ({
          ...item,
          timestamp: item.timestamp.toISOString()
        }))
      };
      window.localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(workspace));
    } catch (err) {
      console.warn("Failed to save Sonic workspace:", err);
    }
  }, [isWorkspaceReady, settings, tags, queue, recentUrls, filenameTemplate, lightMode, savedPresets, downloadHistory]);

  useEffect(() => {
    let isMounted = true;

    const loadHealth = async () => {
      try {
        const response = await fetch("/api/health");
        if (!response.ok) throw new Error("Health check failed");
        const data: BackendHealth = await response.json();
        if (isMounted) setBackendHealth(data);
      } catch (_) {
        if (isMounted) {
          setBackendHealth(prev => ({ ...prev, status: "offline" }));
        }
      }
    };

    loadHealth();
    const interval = window.setInterval(loadHealth, 30000);
    return () => {
      isMounted = false;
      window.clearInterval(interval);
    };
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const inInput = target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;

      if (e.code === "Space" && !inInput) {
        e.preventDefault();
        if (audioRef.current) { audioRef.current.paused ? audioRef.current.play() : audioRef.current.pause(); }
      }
      if (e.code === "Escape") {
        if (showPresetModal) setShowPresetModal(false);
        if (showHistory) setShowHistory(false);
        if (showShortcuts) setShowShortcuts(false);
      }
      if (e.code === "Enter" && e.ctrlKey && !e.shiftKey && videoMetadata && !isConverting) {
        e.preventDefault();
        handleConvertAndDownload();
      }
      if (e.code === "Enter" && e.ctrlKey && e.shiftKey && !isProcessingQueue && queue.filter(i => i.status === "pending").length > 0) {
        e.preventDefault();
        handleProcessQueue();
      }
      if (e.code === "KeyP" && e.ctrlKey && isProcessingQueue) {
        e.preventDefault();
        setIsQueuePaused(prev => !prev);
      }
      if (e.code === "Slash" && e.ctrlKey) { e.preventDefault(); setShowShortcuts(prev => !prev); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [showPresetModal, showHistory, showShortcuts, videoMetadata, isConverting, isProcessingQueue, queue]);

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
      setRecentUrls(prev => [activeUrl, ...prev.filter(item => item !== activeUrl)].slice(0, 8));
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
    if (queue.some(item => item.url === videoMetadata.url)) {
      setLogs(prev => [...prev, `QUEUE: Skipped duplicate source "${tags.title || videoMetadata.title}".`]);
      return;
    }

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
    if (queue.some(item => item.url === url)) {
      setLogs(prev => [...prev, `QUEUE: Skipped duplicate search result "${title}".`]);
      return;
    }

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
      const seenUrls = new Set(queue.map(item => item.url));
      const uniqueTracks = (tracks as Array<{ title: string; channel: string; url: string }>).filter(track => {
        if (seenUrls.has(track.url)) return false;
        seenUrls.add(track.url);
        return true;
      });
      const newItems: QueueItem[] = uniqueTracks.map((track: { title: string; channel: string; url: string }) => ({
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

      setFetchedPlaylistTracks(uniqueTracks);
      setQueue(prev => [...prev, ...newItems]);
      setLogs(prev => [
        ...prev, 
        `PLAYLIST_PARSER: Discovered ${tracks.length} tracks and injected ${newItems.length} unique tracks into the batch conversion list.`
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
    setIsQueuePaused(false);
    completedBlobsRef.current.clear();
    setCompletedZipCacheSize(0);
    setLogs(prev => [...prev, "QUEUE: Transcoding queue slate cleared."]);
  };

  const handleRetryFinishedQueueItems = () => {
    const retryCount = queue.filter(item => item.status === "failed" || item.status === "completed").length;
    if (retryCount === 0) return;
    setQueue(prev => prev.map(item => (
      item.status === "failed" || item.status === "completed"
        ? { ...item, status: "pending", progress: 0, error: undefined }
        : item
    )));
    completedBlobsRef.current.clear();
    setCompletedZipCacheSize(0);
    setLogs(prev => [...prev, `QUEUE: Reset ${retryCount} finished item${retryCount === 1 ? "" : "s"} back to pending.`]);
  };

  const handleRemoveCompletedQueueItems = () => {
    const completedCount = queue.filter(item => item.status === "completed").length;
    if (completedCount === 0) return;
    queue.filter(item => item.status === "completed").forEach(item => completedBlobsRef.current.delete(item.id));
    setCompletedZipCacheSize(completedBlobsRef.current.size);
    setQueue(prev => prev.filter(item => item.status !== "completed"));
    setLogs(prev => [...prev, `QUEUE: Removed ${completedCount} completed item${completedCount === 1 ? "" : "s"} from the queue.`]);
  };

  const handleDeduplicateQueue = () => {
    const seenUrls = new Set<string>();
    const dedupedQueue = queue.filter(item => {
      if (seenUrls.has(item.url)) {
        return false;
      }
      seenUrls.add(item.url);
      return true;
    });
    const removedCount = queue.length - dedupedQueue.length;
    if (removedCount === 0) return;
    setQueue(dedupedQueue);
    setLogs(prev => [...prev, `QUEUE: Removed ${removedCount} duplicate item${removedCount === 1 ? "" : "s"}.`]);
  };

  const handleExportQueue = () => {
    if (queue.length === 0) return;

    const payload = {
      exportedAt: new Date().toISOString(),
      app: "BAD N3WS TUBE DOWNLOADER",
      queue: queue.map(item => normalizeQueueItem(item))
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const localUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = localUrl;
    link.download = `sonicmp3-queue-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(localUrl);
    setLogs(prev => [...prev, `QUEUE_BACKUP: Exported ${queue.length} queue item${queue.length === 1 ? "" : "s"} to JSON.`]);
  };

  const handleExportM3U = () => {
    if (queue.length === 0) return;

    const playlistText = [
      "#EXTM3U",
      ...queue.flatMap(item => [
        `#EXTINF:-1,${item.artist} - ${item.title}`,
        item.url
      ])
    ].join("\n");
    const blob = new Blob([playlistText], { type: "audio/x-mpegurl" });
    const localUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = localUrl;
    link.download = `sonicmp3-playlist-${new Date().toISOString().slice(0, 10)}.m3u`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(localUrl);
    setLogs(prev => [...prev, `PLAYLIST_EXPORT: Exported ${queue.length} source link${queue.length === 1 ? "" : "s"} as M3U.`]);
  };

  const handleImportQueueFile = async (file: File | null) => {
    if (!file) return;

    try {
      const raw = await file.text();
      const parsed = JSON.parse(raw) as { queue?: QueueItem[] } | QueueItem[];
      const importedQueue = Array.isArray(parsed) ? parsed : parsed.queue;
      if (!Array.isArray(importedQueue)) {
        throw new Error("This file does not contain a BAD N3WS queue.");
      }

      const safeQueue = importedQueue
        .filter(item => item && item.url && item.title)
        .map(item => normalizeQueueItem({
          ...item,
          id: Date.now().toString() + Math.random().toString(36).slice(2, 7),
          artist: item.artist || "Unknown Artist",
          status: "pending",
          progress: 0
        }));

      if (safeQueue.length === 0) {
        throw new Error("No usable queue items were found.");
      }

      setQueue(prev => [...prev, ...safeQueue]);
      setLogs(prev => [...prev, `QUEUE_BACKUP: Imported ${safeQueue.length} item${safeQueue.length === 1 ? "" : "s"} from ${file.name}.`]);
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to import queue backup.");
    } finally {
      if (queueFileInputRef.current) {
        queueFileInputRef.current.value = "";
      }
    }
  };

  const handleApplyAudioProfile = (profile: typeof AUDIO_PROFILES[number]) => {
    setSettings(prev => ({
      ...prev,
      ...profile.settings,
      trimStart: prev.trimStart,
      trimEnd: prev.trimEnd
    }));
    setLogs(prev => [...prev, `AUDIO_PROFILE: Applied ${profile.label} profile.`]);
  };

  // Drag-to-reorder queue
  const handleDragStart = (idx: number) => setDraggedIndex(idx);
  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === idx) return;
    const newQueue = [...queue];
    const [moved] = newQueue.splice(draggedIndex, 1);
    newQueue.splice(idx, 0, moved);
    setQueue(newQueue);
    setDraggedIndex(idx);
  };
  const handleDragEnd = () => setDraggedIndex(null);

  // Per-item settings toggle
  const handleToggleItemExpand = (id: string) =>
    setExpandedItemId(prev => (prev === id ? null : id));

  const handleUpdateItemSettings = (id: string, patch: NonNullable<QueueItem["itemSettings"]>) => {
    setQueue(prev => prev.map(item =>
      item.id === id ? { ...item, itemSettings: { ...item.itemSettings, ...patch } } : item
    ));
  };

  // Fetch YouTube chapter markers
  const handleFetchChapters = async () => {
    if (!videoMetadata) return;
    setIsFetchingChapters(true);
    setChapters([]);
    try {
      const res = await fetch("/api/chapters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: videoMetadata.url })
      });
      if (!res.ok) throw new Error("Chapter fetch failed");
      const data = await res.json();
      setChapters(data.chapters || []);
      setShowChapters(true);
      setLogs(prev => [...prev, `CHAPTERS: Found ${data.chapters?.length || 0} chapter markers.`]);
    } catch (e: any) {
      setLogs(prev => [...prev, `CHAPTERS: ${e.message || "No chapters found."}`]);
    } finally {
      setIsFetchingChapters(false);
    }
  };

  // Add a single chapter as a trimmed queue item
  const handleAddChapterToQueue = (chapter: Chapter) => {
    if (!videoMetadata) return;
    const id = Date.now().toString() + Math.random().toString(36).slice(2, 7);
    const newItem: QueueItem = {
      id,
      url: videoMetadata.url,
      title: chapter.title,
      artist: tags.artist || videoMetadata.author,
      status: "pending",
      progress: 0,
      bitrate: settings.bitrate,
      format: settings.format,
      thumbnailUrl: videoMetadata.thumbnailUrl,
      itemSettings: { conversionMode: settings.conversionMode, equalizer: settings.equalizer }
    };
    setQueue(prev => [...prev, newItem]);
    setLogs(prev => [...prev, `QUEUE: Added chapter "${chapter.title}" (${Math.floor(chapter.startTime)}s–${Math.floor(chapter.endTime)}s).`]);
  };

  // Quick 60-second preview download
  const handlePreview = async () => {
    if (!videoMetadata) return;
    setIsLoadingPreview(true);
    setPreviewUrl(null);
    setLogs(prev => [...prev, "PREVIEW: Fetching 60s preview clip..."]);
    try {
      const params = new URLSearchParams({
        url: videoMetadata.url,
        format: "mp3",
        bitrate: "128",
        sampleRate: "44100",
        trimStart: "0",
        trimEnd: "60",
        volumeBoost: "1",
        fadeIn: "0",
        fadeOut: "2",
        conversionMode: "standard",
        equalizer: "flat",
        channelMode: "stereo",
        stereoWidth: "1",
        compression: "0",
        limiterCeiling: "1",
        normalizeLoudness: "false",
        loudnessTarget: "-14",
        noiseReduction: "0",
        highPass: "20",
        lowPass: "20000",
        tempo: "1",
        pitchShift: "0",
        title: tags.title || videoMetadata.title,
        preview: "true"
      });
      const res = await fetch(`/api/generate-audio?${params}`);
      if (!res.ok) throw new Error("Preview fetch failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      setPreviewUrl(url);
      setLogs(prev => [...prev, "PREVIEW: Preview ready — click play to listen."]);
    } catch (e: any) {
      setLogs(prev => [...prev, `PREVIEW: Failed — ${e.message}`]);
    } finally {
      setIsLoadingPreview(false);
    }
  };

  // MusicBrainz tag lookup
  const handleMusicBrainzLookup = async () => {
    if (!tags.title) return;
    setIsMusicBrainzLoading(true);
    try {
      const res = await fetch("/api/musicbrainz", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: tags.title, artist: tags.artist })
      });
      if (!res.ok) throw new Error("MusicBrainz request failed");
      const data = await res.json();
      if (!data) {
        setLogs(prev => [...prev, "MUSICBRAINZ: No match found — try refining the title."]);
        return;
      }
      setTags(prev => ({
        ...prev,
        title: data.title || prev.title,
        artist: data.artist || prev.artist,
        album: data.album || prev.album,
        year: data.year || prev.year,
        genre: data.genre || prev.genre
      }));
      setLogs(prev => [...prev, `MUSICBRAINZ: Tags updated — "${data.title}" by ${data.artist} (${data.year}).`]);
    } catch (e: any) {
      setLogs(prev => [...prev, `MUSICBRAINZ: ${e.message}`]);
    } finally {
      setIsMusicBrainzLoading(false);
    }
  };

  // Save current settings as a named preset
  const handleSavePreset = () => {
    const name = presetName.trim();
    if (!name) return;
    const newPreset: SettingsPreset = {
      id: Date.now().toString() + Math.random().toString(36).slice(2, 6),
      name,
      settings: { ...settings },
      createdAt: new Date().toISOString()
    };
    setSavedPresets(prev => [newPreset, ...prev]);
    setPresetName("");
    setShowPresetModal(false);
    setLogs(prev => [...prev, `PRESET: Saved settings preset "${name}".`]);
  };

  const handleApplySavedPreset = (preset: SettingsPreset) => {
    setSettings(prev => ({
      ...prev,
      ...preset.settings,
      trimStart: prev.trimStart,
      trimEnd: prev.trimEnd
    }));
    setLogs(prev => [...prev, `PRESET: Applied preset "${preset.name}".`]);
  };

  const handleDeleteSavedPreset = (id: string) => {
    setSavedPresets(prev => prev.filter(p => p.id !== id));
  };

  // Local file conversion
  const handleLocalFileConvert = async () => {
    if (!localConvertFile) return;
    setIsConvertingLocal(true);
    setLogs(prev => [...prev, `LOCAL: Converting "${localConvertFile.name}" → ${localConvertFormat.toUpperCase()} ${localConvertBitrate}kbps...`]);
    try {
      const ext = localConvertFile.name.split(".").pop()?.toLowerCase() || "mp3";
      const baseName = localConvertFile.name.replace(/\.[^.]+$/, "");
      const params = new URLSearchParams({
        format: localConvertFormat,
        bitrate: String(localConvertBitrate),
        sampleRate: "48000",
        name: baseName,
        ext
      });
      const res = await fetch(`/api/convert-local?${params}`, {
        method: "POST",
        body: localConvertFile,
        headers: { "Content-Type": localConvertFile.type || "application/octet-stream" }
      });
      if (!res.ok) throw new Error(await res.text());
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${baseName}.${localConvertFormat}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setLogs(prev => [...prev, `LOCAL: Converted "${localConvertFile.name}" — download dispatched.`]);
    } catch (e: any) {
      setLogs(prev => [...prev, `LOCAL ERROR: ${e.message}`]);
    } finally {
      setIsConvertingLocal(false);
    }
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

  // 7. Batch Downloader & converter processing loop
  const handleProcessQueue = async () => {
    if (isProcessingQueue) return;
    setIsQueuePaused(false);
    setIsProcessingQueue(true);
    setLogs(prev => [...prev, `SYSTEM_BATCH: Commencing queue transcoder engine. Concurrency: ${concurrentLimit}.`]);
  };

  // Manage execution of the queue (sequential or concurrent via SSE)
  useEffect(() => {
    if (!isProcessingQueue) return;
    if (isQueuePaused) return;

    const activeStatuses = ["fetching_meta", "optimizing_tags", "converting"] as const;
    const activeCount = queue.filter(item => activeStatuses.includes(item.status as typeof activeStatuses[number])).length;

    // Check if all done
    const pendingCount = queue.filter(item => item.status === "pending").length;
    if (pendingCount === 0 && activeCount === 0) {
      setIsProcessingQueue(false);
      setActiveQueueIndex(-1);
      const completed = queue.filter(item => item.status === "completed").length;
      setLogs(prev => [...prev, `SYSTEM_BATCH: All ${completed} downloads dispatched!`]);
      if (completed > 0) addToast(`Queue complete — ${completed} file${completed > 1 ? "s" : ""} downloaded!`, "success");
      return;
    }

    // Don't start more than concurrentLimit at once
    if (activeCount >= concurrentLimit) return;

    // Find next pending item
    const nextIndex = queue.findIndex(item => item.status === "pending");
    if (nextIndex === -1) return;

    setActiveQueueIndex(nextIndex);
    const activeItem = queue[nextIndex];

    const runProcessItem = async () => {
      // 1. Fetch metadata
      setQueue(prev => prev.map((item, idx) => idx === nextIndex ? { ...item, status: "fetching_meta" } : item));
      setLogs(prev => [...prev, `[Queue #${nextIndex + 1}] FETCHING_META: Resolving stream for ${activeItem.url}...`]);

      let finalTitle = activeItem.title;
      let finalArtist = activeItem.artist;
      let finalThumb = activeItem.thumbnailUrl;

      try {
        const metaRes = await fetch("/api/metadata", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: activeItem.url })
        });
        if (metaRes.ok) { const d = await metaRes.json(); finalTitle = d.title; finalArtist = d.author; finalThumb = d.thumbnailUrl; }
      } catch { /* use existing */ }

      // 2. Optimize tags
      setQueue(prev => prev.map((item, idx) => idx === nextIndex ? { ...item, title: finalTitle, artist: finalArtist, thumbnailUrl: finalThumb, status: "optimizing_tags" } : item));
      try {
        const tagRes = await fetch("/api/optimize-tags", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: finalTitle, author: finalArtist })
        });
        if (tagRes.ok) { const t = await tagRes.json(); finalTitle = t.title || finalTitle; finalArtist = t.artist || finalArtist; }
      } catch { /* use existing */ }

      // 3. Start SSE job
      setQueue(prev => prev.map((item, idx) => idx === nextIndex ? { ...item, title: finalTitle, artist: finalArtist, status: "converting", progress: 0 } : item));
      setLogs(prev => [...prev, `[Queue #${nextIndex + 1}] TRANSCODING: "${finalTitle}" (${activeItem.bitrate}kbps ${activeItem.format.toUpperCase()})...`]);

      try {
        const mergedSettings = { ...settings, ...activeItem.itemSettings };
        const jobBody = {
          url: activeItem.url, format: activeItem.format, bitrate: activeItem.bitrate,
          sampleRate: mergedSettings.sampleRate ?? settings.sampleRate,
          trimStart: 0, trimEnd: 0,
          volumeBoost: mergedSettings.volumeBoost ?? settings.volumeBoost,
          stereoWidth: settings.stereoWidth, compression: settings.compression,
          limiterCeiling: settings.limiterCeiling, normalizeLoudness: settings.normalizeLoudness,
          loudnessTarget: settings.loudnessTarget, noiseReduction: settings.noiseReduction,
          highPass: settings.highPass, lowPass: settings.lowPass,
          tempo: settings.tempo, pitchShift: settings.pitchShift,
          fadeIn: settings.fadeIn, fadeOut: settings.fadeOut,
          conversionMode: mergedSettings.conversionMode ?? settings.conversionMode,
          equalizer: mergedSettings.equalizer ?? settings.equalizer,
          channelMode: settings.channelMode,
          embedThumbnail: mergedSettings.embedThumbnail ?? settings.embedThumbnail,
          thumbnailUrl: finalThumb || "",
          reverb: settings.reverb, eqBands: (settings.eqBands ?? [0,0,0,0,0]).join(","),
          title: finalTitle, artist: finalArtist,
          durationSeconds: 220
        };

        const startRes = await fetch("/api/start-job", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(jobBody)
        });
        if (!startRes.ok) { const e = await startRes.json(); throw new Error(e.error || "Job start failed"); }
        const { jobId } = await startRes.json();

        // Subscribe to SSE progress
        await new Promise<void>((resolve, reject) => {
          const es = new EventSource(`/api/job-progress/${jobId}`);
          es.onmessage = (event) => {
            const data = JSON.parse(event.data);
            if (data.type === "progress") {
              setQueue(prev => prev.map((item, idx) => idx === nextIndex ? { ...item, progress: data.progress } : item));
            } else if (data.type === "done") { es.close(); resolve(); }
            else { es.close(); reject(new Error(data.message)); }
          };
          es.onerror = () => { es.close(); reject(new Error("SSE connection lost")); };
        });

        // Download
        const dlRes = await fetch(`/api/job-download/${jobId}`);
        if (!dlRes.ok) throw new Error(await dlRes.text() || "Download failed");

        const blob = await dlRes.blob();
        const fname = buildDownloadFilename(filenameTemplate, {
          title: finalTitle, artist: finalArtist,
          bitrate: activeItem.bitrate, format: activeItem.format, mode: settings.conversionMode
        });

        // Save blob for ZIP
        const blobData = new Uint8Array(await blob.arrayBuffer());
        completedBlobsRef.current.set(activeItem.id, { data: blobData, filename: fname });
        setCompletedZipCacheSize(completedBlobsRef.current.size);

        const localUrl = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = localUrl; a.download = fname;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        URL.revokeObjectURL(localUrl);

        setQueue(prev => prev.map((item, idx) => idx === nextIndex ? { ...item, status: "completed", progress: 100 } : item));
        setDownloadHistory(prev => [{
          id: Date.now().toString(), title: finalTitle || "Unknown", artist: finalArtist || "Unknown",
          url: activeItem.url, format: activeItem.format, bitrate: activeItem.bitrate, timestamp: new Date()
        }, ...prev.slice(0, 49)]);
        setLogs(prev => [...prev, `[Queue #${nextIndex + 1}] COMPLETED: "${finalTitle}" downloaded.`]);

      } catch (err: any) {
        const retries = (activeItem.retryCount || 0) + 1;
        if (retries <= 3) {
          const delay = Math.pow(2, retries - 1) * 1500;
          setLogs(prev => [...prev, `[Queue #${nextIndex + 1}] RETRY ${retries}/3: "${err.message}" — retrying in ${delay/1000}s...`]);
          setTimeout(() => {
            setQueue(prev => prev.map((item, idx) => idx === nextIndex
              ? { ...item, status: "pending", progress: 0, error: undefined, retryCount: retries }
              : item));
          }, delay);
        } else {
          setQueue(prev => prev.map((item, idx) => idx === nextIndex ? { ...item, status: "failed", error: err.message } : item));
          setLogs(prev => [...prev, `[Queue #${nextIndex + 1}] FAILED: ${err.message}`]);
        }
      }
    };

    runProcessItem();
  }, [isProcessingQueue, isQueuePaused, queue, concurrentLimit]);

  // Convert/Transcode pipeline action — uses SSE job system for real progress
  const handleConvertAndDownload = async () => {
    if (!videoMetadata) return;

    setIsConverting(true);
    setIsCompleted(false);
    setProgress(0);
    setAudioUrl(null);
    setIsPlaying(false);
    setLogs([]);
    setErrorMsg(null);

    setLogs(prev => [...prev,
      "CORE_DAEMON: Initializing high-speed audio transcoder daemon...",
      `MODE_ROUTER: Conversion mode [${settings.conversionMode.replace(/_/g, " ").toUpperCase()}], EQ [${settings.equalizer.toUpperCase()}]...`,
      `DSP: Stereo ${(settings.stereoWidth * 100).toFixed(0)}%, compression ${settings.compression}%, limiter ${(settings.limiterCeiling * 100).toFixed(0)}%...`,
      `PACKAGER: ${settings.bitrate}kbps ${settings.format.toUpperCase()} · ${settings.sampleRate}Hz · ${settings.channelMode}...`
    ]);

    try {
      const jobBody = {
        url: videoMetadata.url, format: settings.format, bitrate: settings.bitrate,
        sampleRate: settings.sampleRate, trimStart: settings.trimStart, trimEnd: settings.trimEnd,
        volumeBoost: settings.volumeBoost, stereoWidth: settings.stereoWidth,
        compression: settings.compression, limiterCeiling: settings.limiterCeiling,
        normalizeLoudness: settings.normalizeLoudness, loudnessTarget: settings.loudnessTarget,
        noiseReduction: settings.noiseReduction, highPass: settings.highPass, lowPass: settings.lowPass,
        tempo: settings.tempo, pitchShift: settings.pitchShift,
        fadeIn: settings.fadeIn, fadeOut: settings.fadeOut,
        conversionMode: settings.conversionMode, equalizer: settings.equalizer,
        channelMode: settings.channelMode, embedThumbnail: settings.embedThumbnail,
        thumbnailUrl: tags.coverUrl || "", reverb: settings.reverb,
        eqBands: (settings.eqBands ?? [0,0,0,0,0]).join(","),
        title: tags.title || videoMetadata.title, artist: tags.artist || "",
        album: tags.album || "", genre: tags.genre || "", year: tags.year || "",
        durationSeconds: videoMetadata.durationSeconds || 220
      };

      const startRes = await fetch("/api/start-job", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(jobBody)
      });
      if (!startRes.ok) { const e = await startRes.json(); throw new Error(e.error || "Failed to start job"); }
      const { jobId } = await startRes.json();

      setLogs(prev => [...prev, `NET_RESOLVER: Job ${jobId.slice(0, 8)} started — streaming yt-dlp + ffmpeg progress...`]);

      await new Promise<void>((resolve, reject) => {
        const es = new EventSource(`/api/job-progress/${jobId}`);
        sseCleanupRef.current = () => es.close();
        es.onmessage = (event) => {
          const data = JSON.parse(event.data);
          if (data.type === "progress") {
            setProgress(data.progress);
            if (data.progress === 5) setLogs(prev => [...prev, "STREAM_CRAWLER: yt-dlp downloading source audio stream..."]);
            if (data.progress === 30) setLogs(prev => [...prev, "TRANSCODER: ffmpeg encoding with DSP filter chain..."]);
          } else if (data.type === "done") {
            setProgress(100);
            es.close();
            resolve();
          } else {
            es.close();
            reject(new Error(data.message || "Conversion failed"));
          }
        };
        es.onerror = () => { es.close(); reject(new Error("Connection lost during conversion")); };
      });

      setLogs(prev => [...prev, "PACKAGER: Downloading converted audio to browser..."]);
      const dlRes = await fetch(`/api/job-download/${jobId}`);
      if (!dlRes.ok) throw new Error(await dlRes.text() || "Download failed");

      const blob = await dlRes.blob();
      const localUrl = URL.createObjectURL(blob);
      setAudioUrl(localUrl);

      setDownloadHistory(prev => [{
        id: Date.now().toString(),
        title: tags.title || videoMetadata?.title || "Unknown",
        artist: tags.artist || videoMetadata?.author || "Unknown",
        url: videoMetadata?.url || youtubeUrl,
        format: settings.format, bitrate: settings.bitrate, timestamp: new Date()
      }, ...prev.slice(0, 49)]);

      const fname = buildDownloadFilename(filenameTemplate, {
        title: tags.title || videoMetadata?.title || "Audio",
        artist: tags.artist || videoMetadata?.author,
        bitrate: settings.bitrate, format: settings.format, mode: settings.conversionMode
      });
      const a = document.createElement("a");
      a.href = localUrl; a.download = fname;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);

      setLogs(prev => [...prev, "SYSTEM: Download dispatched to browser destination."]);
      setIsCompleted(true);
      addToast(`"${tags.title || videoMetadata.title}" converted!`, "success");

    } catch (err: any) {
      console.error("Conversion error:", err);
      const msg = err.message || "Conversion failed";
      setErrorMsg(msg);
      setLogs(prev => [...prev, `ERROR: ${msg}`]);
      addToast(msg, "error");
    } finally {
      setIsConverting(false);
      sseCleanupRef.current = null;
    }
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

  // Toast helpers
  const addToast = useCallback((message: string, type: Toast["type"] = "info") => {
    const id = Date.now().toString() + Math.random().toString(36).slice(2, 5);
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4500);
  }, []);

  const dismissToast = useCallback((id: string) => setToasts(prev => prev.filter(t => t.id !== id)), []);

  // Collapsible panel toggle
  const togglePanel = (id: string) => {
    setCollapsedPanels(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };

  const handleApplySmartRecommendation = () => {
    setSettings(prev => ({
      ...prev,
      ...smartRecommendation.settings,
      trimStart: prev.trimStart,
      trimEnd: prev.trimEnd
    }));
    addToast(`Applied ${smartRecommendation.label}`, "success");
    setLogs(prev => [...prev, `SMART_MASTER: ${smartRecommendation.label} applied — ${smartRecommendation.reason}`]);
  };

  const handleCopySessionReport = async () => {
    const report = [
      "BAD N3WS TUBE DOWNLOADER Session Report",
      `Generated: ${new Date().toLocaleString()}`,
      "",
      `Backend: ${backendHealth.status} (ffmpeg ${backendHealth.ffmpeg}, yt-dlp ${backendHealth.ytdlp})`,
      `Current track: ${tags.artist || "Unknown"} - ${tags.title || videoMetadata?.title || "None"}`,
      `Format: ${settings.format.toUpperCase()} ${settings.bitrate}kbps @ ${settings.sampleRate}Hz`,
      `Mode: ${settings.conversionMode} / EQ: ${settings.equalizer}`,
      `Smart recommendation: ${smartRecommendation.label}`,
      `Queue: ${queueStats.pending} pending, ${queueStats.active} active, ${queueStats.completed} completed, ${queueStats.failed} failed`,
      `ZIP cache: ${completedZipCacheSize} completed file(s) available`,
      "",
      "Recent log tail:",
      ...logs.slice(-8).map(line => `- ${line}`)
    ].join("\n");

    try {
      await navigator.clipboard.writeText(report);
      addToast("Session report copied to clipboard", "success");
    } catch {
      addToast("Clipboard blocked by browser permissions", "error");
    }
  };

  // Fetch related videos
  const handleFetchRelated = async () => {
    if (!videoMetadata) return;
    setIsLoadingRelated(true);
    try {
      const res = await fetch("/api/related", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: videoMetadata.url })
      });
      if (res.ok) { setRelatedVideos(await res.json()); setShowRelated(true); }
    } catch { /* silent */ }
    finally { setIsLoadingRelated(false); }
  };

  // Fetch artist discography via search
  const handleFetchArtistDiscography = async () => {
    if (!tags.artist && !videoMetadata?.author) return;
    const artist = tags.artist || videoMetadata?.author || "";
    setIsLoadingArtist(true);
    setArtistVideos([]);
    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: artist + " official" })
      });
      if (res.ok) {
        const data = await res.json();
        setArtistVideos(data.slice(0, 6));
        setShowArtistVideos(true);
      }
    } catch { /* silent */ }
    finally { setIsLoadingArtist(false); }
  };

  // BPM detection via Web Audio API
  const handleDetectBpm = async () => {
    const src = previewUrl || audioUrl;
    if (!src) { addToast("Load a preview first to detect BPM", "info"); return; }
    try {
      const ctx = new AudioContext();
      const arrBuf = await (await fetch(src)).arrayBuffer();
      const audioBuf = await ctx.decodeAudioData(arrBuf);
      const data = audioBuf.getChannelData(0);
      const sampleRate = audioBuf.sampleRate;
      const windowSize = Math.round(sampleRate * 0.02);
      const energies: number[] = [];
      for (let i = 0; i < data.length - windowSize; i += windowSize) {
        let e = 0;
        for (let j = i; j < i + windowSize; j++) e += data[j] * data[j];
        energies.push(e);
      }
      const mean = energies.reduce((a, b) => a + b, 0) / energies.length;
      let peaks = 0;
      let lastPeak = -10;
      for (let i = 1; i < energies.length - 1; i++) {
        if (energies[i] > mean * 1.5 && energies[i] > energies[i-1] && energies[i] > energies[i+1] && (i - lastPeak) > 15) {
          peaks++;
          lastPeak = i;
        }
      }
      const durationSecs = audioBuf.duration;
      const bpm = Math.round((peaks / durationSecs) * 60);
      const clamped = Math.min(220, Math.max(40, bpm));
      setDetectedBpm(clamped);
      addToast(`Detected BPM: ~${clamped}`, "success");
      ctx.close();
    } catch (e: any) {
      addToast("BPM detection failed: " + (e.message || "unknown error"), "error");
    }
  };

  // Download all completed queue items as a ZIP
  const handleDownloadZip = async () => {
    const entries = [...completedBlobsRef.current.values()];
    if (entries.length === 0) { addToast("No completed downloads to ZIP yet.", "info"); return; }
    addToast(`Packing ${entries.length} file(s) into ZIP…`, "info");
    try {
      const zip = await createZip(entries.map(e => ({ name: e.filename, data: e.data })));
      const url = URL.createObjectURL(zip);
      const a = document.createElement("a");
      a.href = url;
      a.download = `sonicmp3-batch-${new Date().toISOString().slice(0, 10)}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      addToast(`ZIP downloaded (${entries.length} tracks)`, "success");
    } catch (e: any) {
      addToast("ZIP creation failed: " + e.message, "error");
    }
  };

  // Reset converter state
  const handleReset = () => {
    sseCleanupRef.current?.();
    sseCleanupRef.current = null;
    setYoutubeUrl("");
    setVideoMetadata(null);
    setTags(defaultID3);
    setSettings(defaultSettings);
    setIsCompleted(false);
    setProgress(0);
    setLogs([]);
    setAudioUrl(null);
    setPreviewUrl(null);
    setIsPlaying(false);
    setChapters([]);
    setShowChapters(false);
    setAudioCurrentTime(0);
    setAudioDuration(0);
    if (audioPreviewElement) {
      audioPreviewElement.pause();
      setAudioPreviewElement(null);
    }
  };

  return (
    <div id="app_root" className={`min-h-screen bg-[#080808] text-[#f0f0f0] flex flex-col antialiased selection:bg-[#ff4e00] selection:text-white relative overflow-hidden${lightMode ? " light-mode" : ""}`}>
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

              <motion.div
                animate={{ opacity: [0.45, 1, 0.45], scale: [0.98, 1.03, 0.98] }}
                transition={{ repeat: Infinity, duration: 1.2, ease: "easeInOut" }}
                className="bad-news-ent-badge"
              >
                .BAD N3WS ENT.
              </motion.div>

              <div className="flex flex-col gap-2">
                <span className="text-[11px] font-bold font-mono uppercase tracking-widest text-[#ff4e00] animate-pulse">
                  BAD N3WS STREAM RESOLVER
                </span>
                <h3 className="text-xl font-heading font-black text-white leading-tight">
                  Loading Song URL Search...
                </h3>
                <p className="text-xs text-zinc-400 max-w-sm mt-1 leading-relaxed">
                  BAD N3WS is finding the source stream, artwork, title data, and clean audio path.
                </p>
              </div>

              {/* Progress Simulated steps */}
              <div className="w-full bg-[#080808] border border-white/5 p-4 rounded-xl text-left font-mono text-[10px] text-zinc-500 flex flex-col gap-1.5 shadow-inner">
                <div className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#00ff9d] animate-ping"></span>
                  <span className="text-zinc-300">Contacting BAD N3WS URL search relay...</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#ffaa00] animate-pulse"></span>
                  <span className="text-zinc-400">Checking stream container bitrate blocks [VBR/CBR]</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-zinc-700"></span>
                  <span>Preparing artwork, metadata, and high fidelity structures</span>
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
        className="bg-[#080808]/85 border-b border-white/5 sticky top-0 z-50 py-4 px-4 md:px-8 backdrop-blur-md">
        <div className="max-w-[1500px] mx-auto flex flex-col xl:flex-row justify-between items-start xl:items-center gap-4">
          <div className="flex items-center gap-3 select-none">
            <div className="w-10 h-10 bg-gradient-to-br from-[#ff4e00] to-[#802700] rounded-lg flex items-center justify-center shadow-[0_0_20px_rgba(255,78,0,0.4)]">
              <Youtube className="w-5.5 h-5.5 text-white stroke-2" />
            </div>
            <div className="flex flex-col">
              <h1 className="font-heading font-extrabold text-xl sm:text-2xl tracking-tight text-white leading-tight">
                BAD N3WS <span className="text-[#ff4e00]">TUBE DOWNLOADER</span>
              </h1>
              <span className="text-[10.5px] font-semibold text-zinc-500 font-mono tracking-wider uppercase leading-none mt-0.5">
                BAD N3WS ENT. // Local DSP & Tube Search
              </span>
            </div>
          </div>
          
          <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500 font-semibold font-mono tracking-wide">
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${backendHealth.status === "ready" ? "bg-[#00ff9d]" : backendHealth.status === "degraded" ? "bg-[#ffaa00]" : "bg-rose-500"} animate-pulse`}></span>
              <span className="text-zinc-400">
                Backend {backendHealth.status === "ready" ? "Ready" : backendHealth.status === "degraded" ? "Degraded" : "Offline"}
              </span>
            </div>
            <span className="px-2.5 py-1 bg-[#ff4e00]/10 rounded-lg text-[10.5px] text-[#ff8c00] font-bold border border-[#ff4e00]/20">
              {backendHealth.formats.length || AUDIO_FORMATS.length} FORMATS
            </span>
            <button
              type="button"
              onClick={() => setLightMode(m => !m)}
              title={lightMode ? "Switch to dark mode" : "Switch to light mode"}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-[10.5px] font-bold text-zinc-300 hover:text-white transition-all cursor-pointer"
            >
              {lightMode ? <Moon className="w-3.5 h-3.5" /> : <Sun className="w-3.5 h-3.5" />}
              {lightMode ? "Dark" : "Light"}
            </button>
            <button
              type="button"
              onClick={() => setShowShortcuts(true)}
              title="Show keyboard shortcuts"
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-[10.5px] font-bold text-zinc-300 hover:text-white transition-all cursor-pointer"
            >
              <Keyboard className="w-3.5 h-3.5" />
              Keys
            </button>
            <button
              type="button"
              onClick={handleCopySessionReport}
              title="Copy current session report"
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-[10.5px] font-bold text-zinc-300 hover:text-white transition-all cursor-pointer"
            >
              <ClipboardCheck className="w-3.5 h-3.5" />
              Report
            </button>
            <input
              ref={queueFileInputRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(event) => handleImportQueueFile(event.target.files?.[0] || null)}
            />
            <button
              type="button"
              onClick={() => queueFileInputRef.current?.click()}
              disabled={isProcessingQueue}
              className="relative flex items-center gap-1.5 px-3 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-[10.5px] font-bold text-zinc-300 hover:text-white transition-all cursor-pointer disabled:opacity-50"
            >
              <FileUp className="w-3.5 h-3.5" />
              Import Queue
            </button>
            <button
              type="button"
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

      <section className="w-full max-w-[1500px] mx-auto px-4 pt-6 md:px-8 relative z-10">
        <div className="bg-[#121212] border border-white/5 rounded-2xl p-4 sm:p-5 shadow-2xl overflow-hidden relative">
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#ff4e00]/70 to-transparent" />
          <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4">
            <div className="flex items-start gap-3 min-w-0">
              <div className="w-10 h-10 rounded-lg bg-[#ff4e00]/10 border border-[#ff4e00]/20 flex items-center justify-center shrink-0">
                <Sparkles className="w-5 h-5 text-[#ff4e00]" />
              </div>
              <div className="flex flex-col gap-1 min-w-0">
                <span className="text-[10px] font-mono font-black uppercase text-[#ff8c00] tracking-wider">
                  A message from BAD N3WS ENT.
                </span>
                <h2 className="font-heading text-lg sm:text-xl font-black text-white leading-tight">
                  Welcome to BAD N3WS TUBE DOWNLOADER.
                </h2>
                <p className="text-xs sm:text-sm text-zinc-400 leading-relaxed max-w-4xl">
                  Drop in a song URL, search YouTube, scan playlists, or convert a local audio file. This workstation can preview tracks,
                  split chapters, clean ID3 tags, fetch MusicBrainz metadata, embed cover art, tune audio with EQ/reverb/tempo/pitch/trim/fades,
                  recommend a smart master, run batch queues with retries and parallel threads, export ZIP bundles, save presets, track history,
                  and surface related videos or more from the artist.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-2 gap-2 xl:w-[360px] shrink-0">
              {([
                ["Input", "URL, search, playlist, local file"],
                ["Audio", "DSP, EQ, reverb, smart master"],
                ["Metadata", "ID3, cover art, MusicBrainz"],
                ["Batch", "Queue, retry, ZIP, history"]
              ] as const).map(([label, value]) => (
                <div key={label} className="bg-[#080808] border border-white/5 rounded-xl px-3 py-2 min-w-0">
                  <span className="block text-[9px] uppercase font-mono font-bold text-zinc-600">{label}</span>
                  <span className="block text-[10.5px] text-zinc-300 font-semibold truncate">{value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Main Content Area */}
      <main className="flex-1 w-full max-w-[1500px] mx-auto px-4 py-6 md:px-8 grid grid-cols-1 lg:grid-cols-12 gap-6 relative z-10">
        
        {/* Left Column: Direct Converter Operations */}
        <motion.div
          initial={{ opacity: 0, x: -30 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5, ease: "easeOut" }}
          className="lg:col-span-8 flex flex-col gap-6">
          
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
                  onClick={() => { setActiveTab('single'); setLocalFileTab(false); }}
                  className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${
                    activeTab === 'single' && !localFileTab
                      ? "bg-[#ff4e00] text-white shadow-md"
                      : "text-zinc-500 hover:text-white"
                  }`}
                >
                  <Youtube className="w-3.5 h-3.5" />
                  Single
                </button>
                <button
                  type="button"
                  onClick={() => { setActiveTab('playlist'); setLocalFileTab(false); }}
                  className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${
                    activeTab === 'playlist' && !localFileTab
                      ? "bg-[#ff4e00] text-white shadow-md"
                      : "text-zinc-500 hover:text-white"
                  }`}
                >
                  <ListTodo className="w-3.5 h-3.5" />
                  Playlist
                </button>
                <button
                  type="button"
                  onClick={() => setLocalFileTab(true)}
                  className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${
                    localFileTab
                      ? "bg-[#ff4e00] text-white shadow-md"
                      : "text-zinc-500 hover:text-white"
                  }`}
                >
                  <FileMusic className="w-3.5 h-3.5" />
                  Local File
                </button>
              </div>
            </div>

            <AnimatePresence mode="wait">
              {localFileTab ? (
                <motion.div
                  key="local_tab"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="flex flex-col gap-4"
                >
                  <input
                    ref={localFileInputRef}
                    type="file"
                    accept="audio/*,.mp3,.wav,.flac,.aac,.m4a,.ogg,.opus,.wma"
                    className="hidden"
                    onChange={e => setLocalConvertFile(e.target.files?.[0] || null)}
                  />
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => localFileInputRef.current?.click()}
                    onKeyDown={e => e.key === "Enter" && localFileInputRef.current?.click()}
                    onDragOver={e => e.preventDefault()}
                    onDrop={e => { e.preventDefault(); setLocalConvertFile(e.dataTransfer.files?.[0] || null); }}
                    className="border-2 border-dashed border-white/10 hover:border-[#ff4e00]/50 rounded-xl p-8 text-center cursor-pointer transition-colors flex flex-col items-center gap-3"
                  >
                    <FileMusic className="w-10 h-10 text-zinc-600" />
                    {localConvertFile ? (
                      <div>
                        <p className="text-sm font-bold text-white">{localConvertFile.name}</p>
                        <p className="text-xs text-zinc-500">{(localConvertFile.size / 1024 / 1024).toFixed(1)} MB</p>
                      </div>
                    ) : (
                      <div>
                        <p className="text-sm font-semibold text-zinc-300">Drop an audio file here or click to browse</p>
                        <p className="text-xs text-zinc-500 mt-1">MP3, WAV, FLAC, AAC, M4A, OGG, OPUS, WMA</p>
                      </div>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-3 items-end">
                    <div className="flex flex-col gap-1">
                      <span className="text-[10px] text-zinc-500 uppercase font-mono font-bold">Output Format</span>
                      <select
                        value={localConvertFormat}
                        onChange={e => setLocalConvertFormat(toAudioFormat(e.target.value))}
                        title="Output format"
                        className="bg-zinc-950 border border-white/10 text-zinc-300 rounded-lg px-2 py-1.5 text-xs font-mono focus:outline-hidden cursor-pointer focus:border-[#ff4e00] uppercase"
                      >
                        {AUDIO_FORMATS.map(f => <option key={f} value={f}>{f.toUpperCase()}</option>)}
                      </select>
                    </div>
                    <div className="flex flex-col gap-1">
                      <span className="text-[10px] text-zinc-500 uppercase font-mono font-bold">Bitrate</span>
                      <select
                        value={localConvertBitrate}
                        onChange={e => setLocalConvertBitrate(toAudioBitrate(e.target.value))}
                        title="Output bitrate"
                        className="bg-zinc-950 border border-white/10 text-zinc-300 rounded-lg px-2 py-1.5 text-xs font-mono focus:outline-hidden cursor-pointer focus:border-[#ff4e00]"
                      >
                        <option value={128}>128 kbps</option>
                        <option value={192}>192 kbps</option>
                        <option value={256}>256 kbps</option>
                        <option value={320}>320 kbps HD</option>
                      </select>
                    </div>
                    <button
                      type="button"
                      onClick={handleLocalFileConvert}
                      disabled={!localConvertFile || isConvertingLocal}
                      className="px-6 py-2 bg-white hover:bg-[#ff4e00] text-black hover:text-white font-extrabold text-xs rounded-xl transition-all cursor-pointer disabled:opacity-50 flex items-center gap-2 uppercase"
                    >
                      {isConvertingLocal ? (
                        <><span className="w-3.5 h-3.5 border-2 border-black/30 border-t-black rounded-full animate-spin" />Converting...</>
                      ) : (
                        <><Download className="w-3.5 h-3.5" />Convert &amp; Download</>
                      )}
                    </button>
                  </div>
                </motion.div>
              ) : activeTab === 'single' ? (
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

                  {recentUrls.length > 0 && (
                    <div className="flex flex-col gap-2">
                      <span className="text-[10px] font-bold text-zinc-500 font-mono uppercase tracking-wider">
                        Recent sources:
                      </span>
                      <div className="flex flex-wrap gap-2">
                        {recentUrls.map((url) => (
                          <button
                            key={url}
                            type="button"
                            onClick={() => setYoutubeUrl(url)}
                            className="max-w-full truncate px-3 py-1.5 bg-zinc-950 hover:bg-[#ff4e00]/10 border border-white/5 hover:border-[#ff4e00]/30 text-[10.5px] font-semibold text-zinc-400 hover:text-white rounded-lg transition-all cursor-pointer"
                            title={url}
                          >
                            {url.replace(/^https?:\/\/(www\.)?/, "").slice(0, 52)}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

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
                          {detectedBpm && (
                            <p className="text-[11px] text-amber-400 font-mono flex items-center gap-1 mt-0.5">
                              <Activity className="w-3 h-3" /> {detectedBpm} BPM detected
                            </p>
                          )}
                        </div>
                      </div>

                      {/* BPM / Related / Artist row */}
                      <div className="flex gap-2">
                        <button type="button" onClick={handleDetectBpm}
                          className="flex-1 py-2 bg-[#0c0c0c] border border-white/5 hover:border-amber-500/30 text-zinc-400 hover:text-amber-400 font-bold text-[10px] uppercase tracking-wider rounded-xl transition-all flex items-center justify-center gap-1.5 cursor-pointer">
                          <Activity className="w-3.5 h-3.5" /> BPM
                        </button>
                        <button type="button" onClick={handleFetchRelated} disabled={isLoadingRelated}
                          className="flex-1 py-2 bg-[#0c0c0c] border border-white/5 hover:border-sky-500/30 text-zinc-400 hover:text-sky-400 font-bold text-[10px] uppercase tracking-wider rounded-xl transition-all flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50">
                          {isLoadingRelated ? <span className="w-3 h-3 border border-sky-400/40 border-t-sky-400 rounded-full animate-spin" /> : <><Activity className="w-3.5 h-3.5" />Related</>}
                        </button>
                        <button type="button" onClick={handleFetchArtistDiscography} disabled={isLoadingArtist}
                          className="flex-1 py-2 bg-[#0c0c0c] border border-white/5 hover:border-violet-500/30 text-zinc-400 hover:text-violet-400 font-bold text-[10px] uppercase tracking-wider rounded-xl transition-all flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50">
                          {isLoadingArtist ? <span className="w-3 h-3 border border-violet-400/40 border-t-violet-400 rounded-full animate-spin" /> : <><Users className="w-3.5 h-3.5" />Artist</>}
                        </button>
                      </div>

                      <div className="bg-[#0c0c0c] border border-white/5 rounded-xl p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="flex items-start gap-2 min-w-0">
                          <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                          <div className="flex flex-col min-w-0">
                            <span className="text-[10px] uppercase font-mono tracking-widest text-emerald-400 font-bold">
                              Smart Master Suggests: {smartRecommendation.label}
                            </span>
                            <span className="text-[11px] text-zinc-500 leading-snug">
                              {smartRecommendation.reason}
                            </span>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={handleApplySmartRecommendation}
                          className="shrink-0 flex items-center justify-center gap-1.5 px-3 py-2 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/20 rounded-lg text-[10px] font-black uppercase tracking-wider text-emerald-300 transition-all cursor-pointer"
                        >
                          <Zap className="w-3.5 h-3.5" />
                          Apply
                        </button>
                      </div>

                      {/* Action row: preview + chapters + queue */}
                      <div className="flex flex-col gap-2">
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={handlePreview}
                            disabled={isLoadingPreview}
                            className="flex-1 py-2.5 bg-[#080808] hover:bg-purple-500/10 border border-white/5 hover:border-purple-500/30 text-white font-bold text-xs uppercase tracking-wider rounded-xl transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                          >
                            {isLoadingPreview
                              ? <><span className="w-3.5 h-3.5 border-2 border-white/20 border-t-white rounded-full animate-spin" />Fetching Preview...</>
                              : <><Eye className="w-3.5 h-3.5 text-purple-400" />Preview 60s</>}
                          </button>
                          <button
                            type="button"
                            onClick={handleFetchChapters}
                            disabled={isFetchingChapters}
                            className="flex-1 py-2.5 bg-[#080808] hover:bg-cyan-500/10 border border-white/5 hover:border-cyan-500/30 text-white font-bold text-xs uppercase tracking-wider rounded-xl transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                          >
                            {isFetchingChapters
                              ? <><span className="w-3.5 h-3.5 border-2 border-white/20 border-t-cyan-400 rounded-full animate-spin" />Fetching...</>
                              : <><BookOpen className="w-3.5 h-3.5 text-cyan-400" />Chapters ({chapters.length})</>}
                          </button>
                        </div>

                        {previewUrl && (
                          <div className="flex flex-col gap-1 p-3 bg-purple-950/20 border border-purple-500/20 rounded-xl">
                            <span className="text-[10px] font-bold text-purple-400 uppercase tracking-wider font-mono">60s Preview</span>
                            <audio
                              src={previewUrl}
                              controls
                              className="w-full h-8"
                              style={{ accentColor: "#a855f7", colorScheme: "dark" }}
                            />
                          </div>
                        )}

                        {showChapters && chapters.length > 0 && (
                          <div className="bg-[#080808] border border-white/5 rounded-xl overflow-hidden">
                            <div className="flex items-center justify-between px-3 py-2 border-b border-white/5 bg-white/5">
                              <span className="text-[10px] font-bold text-cyan-400 uppercase tracking-wider font-mono flex items-center gap-1.5">
                                <BookOpen className="w-3 h-3" />{chapters.length} Chapters
                              </span>
                              <button type="button" onClick={() => setShowChapters(false)} className="text-zinc-600 hover:text-zinc-300 cursor-pointer transition-colors text-[10px]">Hide</button>
                            </div>
                            <div className="max-h-40 overflow-y-auto divide-y divide-white/5">
                              {chapters.map((ch, i) => (
                                <div key={i} className="flex items-center justify-between px-3 py-2 hover:bg-white/5 transition-colors">
                                  <div className="flex-1 min-w-0">
                                    <p className="text-xs font-semibold text-zinc-200 truncate">{ch.title}</p>
                                    <p className="text-[10px] text-zinc-500 font-mono">{Math.floor(ch.startTime / 60)}:{String(Math.floor(ch.startTime % 60)).padStart(2,"0")} – {Math.floor(ch.endTime / 60)}:{String(Math.floor(ch.endTime % 60)).padStart(2,"0")}</p>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => handleAddChapterToQueue(ch)}
                                    className="ml-2 px-2 py-1 text-[9.5px] font-bold bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 rounded-lg hover:bg-cyan-500/20 transition-colors cursor-pointer uppercase shrink-0"
                                  >
                                    + Queue
                                  </button>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        <button
                          type="button"
                          onClick={handleAddToQueue}
                          className="w-full py-3 bg-[#080808] hover:bg-[#ff4e00]/10 border border-white/5 hover:border-[#ff4e00]/30 text-white font-bold text-xs uppercase tracking-wider rounded-xl transition-all flex items-center justify-center gap-2 transform active:scale-[0.98] cursor-pointer"
                        >
                          <FolderPlus className="w-4 h-4 text-[#ff4e00]" />
                          Append to Transcoding Queue
                        </button>
                      </div>
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
                    onClick={handleExportQueue}
                    disabled={isProcessingQueue || queue.length === 0}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-900 hover:bg-zinc-800 rounded-lg text-[11px] font-bold text-zinc-400 hover:text-white transition-colors cursor-pointer disabled:opacity-50"
                  >
                    <FileDown className="w-3.5 h-3.5" />
                    Export
                  </button>
                  <button
                    type="button"
                    onClick={handleExportM3U}
                    disabled={isProcessingQueue || queue.length === 0}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-900 hover:bg-zinc-800 rounded-lg text-[11px] font-bold text-zinc-400 hover:text-white transition-colors cursor-pointer disabled:opacity-50"
                  >
                    <Music className="w-3.5 h-3.5" />
                    M3U
                  </button>
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

              {/* Queue Overview & Search */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 relative z-10">
                {([
                  ["Pending", queueStats.pending, "text-zinc-300"],
                  ["Active", queueStats.active, "text-[#ffaa00]"],
                  ["Done", queueStats.completed, "text-[#00ff9d]"],
                  ["Failed", queueStats.failed, "text-rose-400"]
                ] as const).map(([label, value, color]) => (
                  <div key={label} className="bg-[#080808] border border-white/5 rounded-xl px-3 py-2">
                    <span className="block text-[9px] uppercase tracking-widest font-mono text-zinc-600">{label}</span>
                    <span className={`text-lg font-heading font-black ${color}`}>{value}</span>
                  </div>
                ))}
              </div>

              <div className="bg-[#080808] p-3 rounded-xl border border-white/5 flex flex-col lg:flex-row gap-3 relative z-10">
                <div className="relative flex-1 min-w-0">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-600" />
                  <input
                    type="text"
                    value={queueSearchTerm}
                    onChange={(e) => setQueueSearchTerm(e.target.value)}
                    placeholder="Search queue by track, artist, or URL"
                    className="w-full pl-9 pr-3 py-2 bg-zinc-950 border border-white/10 rounded-lg text-xs text-white placeholder:text-zinc-600 focus:outline-hidden focus:border-[#ff4e00]"
                  />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex items-center gap-1.5">
                    <Filter className="w-3.5 h-3.5 text-zinc-600" />
                    <select
                      value={queueStatusFilter}
                      onChange={(e) => setQueueStatusFilter(e.target.value as QueueStatusFilter)}
                      className="bg-zinc-950 border border-white/10 text-zinc-300 rounded-lg px-2 py-2 text-[10px] font-mono focus:outline-hidden cursor-pointer focus:border-[#ff4e00]"
                    >
                      <option value="all">All Status</option>
                      <option value="pending">Pending</option>
                      <option value="fetching_meta">Scanning</option>
                      <option value="optimizing_tags">Tagging</option>
                      <option value="converting">Converting</option>
                      <option value="completed">Completed</option>
                      <option value="failed">Failed</option>
                    </select>
                  </div>
                  <button
                    type="button"
                    onClick={handleRetryFinishedQueueItems}
                    disabled={isProcessingQueue || (queueStats.completed + queueStats.failed) === 0}
                    className="flex items-center gap-1.5 px-2.5 py-2 bg-zinc-950 hover:bg-zinc-900 border border-white/10 rounded-lg text-[10px] font-bold text-zinc-400 hover:text-white transition-colors cursor-pointer disabled:opacity-40"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    Retry Finished
                  </button>
                  <button
                    type="button"
                    onClick={handleRemoveCompletedQueueItems}
                    disabled={isProcessingQueue || queueStats.completed === 0}
                    className="flex items-center gap-1.5 px-2.5 py-2 bg-zinc-950 hover:bg-zinc-900 border border-white/10 rounded-lg text-[10px] font-bold text-zinc-400 hover:text-white transition-colors cursor-pointer disabled:opacity-40"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Remove Done
                  </button>
                  <button
                    type="button"
                    onClick={handleDeduplicateQueue}
                    disabled={isProcessingQueue || queue.length < 2}
                    className="flex items-center gap-1.5 px-2.5 py-2 bg-zinc-950 hover:bg-zinc-900 border border-white/10 rounded-lg text-[10px] font-bold text-zinc-400 hover:text-white transition-colors cursor-pointer disabled:opacity-40"
                  >
                    <Layers className="w-3.5 h-3.5" />
                    Dedupe
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
                  {filteredQueueEntries.map(({ item, idx }) => {
                    const isActive = idx === activeQueueIndex;
                    return (
                      <motion.div
                        key={item.id}
                        initial={{ opacity: 0, x: -15 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: 15 }}
                        draggable={!isProcessingQueue && item.status === "pending"}
                        onDragStart={() => handleDragStart(idx)}
                        onDragOver={e => handleDragOver(e, idx)}
                        onDragEnd={handleDragEnd}
                        className={`flex flex-col border rounded-xl transition-all gap-0 ${
                          draggedIndex === idx ? "opacity-50 scale-[0.98]" : ""
                        } ${
                          isActive
                            ? "bg-[#ff4e00]/5 border-[#ff4e00]/30 shadow-[0_0_15px_rgba(255,78,0,0.1)]"
                            : item.status === 'completed'
                            ? "bg-[#00ff9d]/5 border-[#00ff9d]/20"
                            : item.status === 'failed'
                            ? "bg-red-950/20 border-red-900/30"
                            : "bg-[#080808] border-white/5 hover:border-white/10"
                        }`}
                      >
                        {/* Main row */}
                        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-3.5 gap-3">
                        {/* Drag handle + Title & Artist & Thumb */}
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          {item.status === "pending" && !isProcessingQueue && (
                            <GripVertical className="w-4 h-4 text-zinc-700 shrink-0 cursor-grab active:cursor-grabbing" />
                          )}
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

                          {/* Per-item settings expand + delete */}
                          {item.status === "pending" && !isProcessingQueue && (
                            <button
                              type="button"
                              onClick={() => handleToggleItemExpand(item.id)}
                              title="Per-item DSP settings"
                              className="p-1.5 text-zinc-500 hover:text-[#ff8c00] transition-colors cursor-pointer rounded-lg hover:bg-white/5"
                            >
                              <Settings2 className="w-3.5 h-3.5" />
                            </button>
                          )}
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
                        </div>{/* end main row */}

                        {/* Per-item expandable settings */}
                        <AnimatePresence>
                          {expandedItemId === item.id && (
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: "auto", opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              transition={{ duration: 0.18 }}
                              className="overflow-hidden border-t border-white/5"
                            >
                              <div className="p-3 flex flex-wrap gap-3 items-center">
                                <div className="flex flex-col gap-1">
                                  <span className="text-[9px] uppercase font-mono text-zinc-600">EQ</span>
                                  <select
                                    value={item.itemSettings?.equalizer ?? settings.equalizer}
                                    onChange={e => handleUpdateItemSettings(item.id, { equalizer: e.target.value as AudioSettings["equalizer"] })}
                                    title="Per-item equalizer"
                                    className="bg-zinc-950 border border-white/10 text-zinc-300 rounded-lg px-2 py-1 text-[9.5px] font-mono focus:outline-hidden cursor-pointer focus:border-[#ff4e00]"
                                  >
                                    {["flat","bass","vocal","treble","instrumental","lofi"].map(eq => (
                                      <option key={eq} value={eq}>{eq}</option>
                                    ))}
                                  </select>
                                </div>
                                <div className="flex flex-col gap-1">
                                  <span className="text-[9px] uppercase font-mono text-zinc-600">Mode</span>
                                  <select
                                    value={item.itemSettings?.conversionMode ?? settings.conversionMode}
                                    onChange={e => handleUpdateItemSettings(item.id, { conversionMode: e.target.value as AudioSettings["conversionMode"] })}
                                    title="Per-item conversion mode"
                                    className="bg-zinc-950 border border-white/10 text-zinc-300 rounded-lg px-2 py-1 text-[9.5px] font-mono focus:outline-hidden cursor-pointer focus:border-[#ff4e00]"
                                  >
                                    {["standard","audio_mix","mastering","vocal_master","club_master"].map(m => (
                                      <option key={m} value={m}>{m.replace(/_/g," ")}</option>
                                    ))}
                                  </select>
                                </div>
                                <div className="flex flex-col gap-1">
                                  <span className="text-[9px] uppercase font-mono text-zinc-600">Gain</span>
                                  <input
                                    type="range" min="1" max="2" step="0.05"
                                    value={item.itemSettings?.volumeBoost ?? 1}
                                    onChange={e => handleUpdateItemSettings(item.id, { volumeBoost: parseFloat(e.target.value) })}
                                    className="w-20 h-1 accent-[#ff4e00] cursor-pointer"
                                  />
                                </div>
                                <label className="flex items-center gap-1.5 text-[9.5px] text-zinc-400 font-mono cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={item.itemSettings?.embedThumbnail ?? settings.embedThumbnail}
                                    onChange={e => handleUpdateItemSettings(item.id, { embedThumbnail: e.target.checked })}
                                    className="accent-[#ff4e00]"
                                  />
                                  Embed Art
                                </label>
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
                {filteredQueueEntries.length === 0 && (
                  <div className="bg-[#080808] border border-dashed border-white/10 rounded-xl py-8 text-center">
                    <p className="text-xs font-semibold text-zinc-500">No queue items match the current filter.</p>
                  </div>
                )}
              </div>

              {/* Concurrent mode + ZIP */}
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-2 bg-[#0c0c0c] border border-white/5 rounded-xl px-3 py-2">
                  <Zap className="w-3.5 h-3.5 text-amber-400" />
                  <span className="text-[10px] font-mono text-zinc-400 uppercase tracking-wider">Threads</span>
                  {[1,2,3].map(n => (
                    <button key={n} type="button" onClick={() => setConcurrentLimit(n)}
                      className={`w-6 h-6 rounded text-[10px] font-bold transition-all cursor-pointer ${concurrentLimit === n ? "bg-amber-500 text-black" : "bg-zinc-800 text-zinc-400 hover:text-white"}`}>
                      {n}
                    </button>
                  ))}
                </div>
                {isProcessingQueue && (
                  <button
                    type="button"
                    onClick={() => setIsQueuePaused(prev => !prev)}
                    title="Pause or resume starting new queue jobs"
                    className={`flex items-center gap-1.5 px-3 py-2 border rounded-xl text-[10px] font-bold transition-all cursor-pointer ${
                      isQueuePaused
                        ? "bg-amber-500/15 border-amber-500/30 text-amber-300"
                        : "bg-[#0c0c0c] border-white/5 text-zinc-400 hover:text-white"
                    }`}
                  >
                    {isQueuePaused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
                    {isQueuePaused ? "Resume" : "Pause"}
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleDownloadZip}
                  disabled={completedZipCacheSize === 0}
                  title={`Download ${completedZipCacheSize} completed file(s) as ZIP`}
                  className="flex items-center gap-1.5 px-3 py-2 bg-[#0c0c0c] border border-white/5 hover:border-emerald-500/40 rounded-xl text-[10px] font-bold text-zinc-400 hover:text-emerald-400 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Archive className="w-3.5 h-3.5" />
                  ZIP All ({completedZipCacheSize})
                </button>
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
                  <span className="relative">Process Batch Queue · Ctrl+Shift+Enter</span>
                </button>
              ) : (
                <div className="w-full py-4 bg-[#ff4e00]/10 text-[#ff8c00] font-bold text-xs tracking-wider uppercase text-center rounded-xl border border-[#ff4e00]/20 flex items-center justify-center gap-2 animate-pulse">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  {isQueuePaused ? "Queue Paused" : `Processing Queue (threads: ${concurrentLimit}) — item ${activeQueueIndex + 1}/${queue.length}`}
                </div>
              )}
            </motion.div>
          )}

          {/* Configurable Panels (Only show when video loaded successfully) */}
          {videoMetadata ? (
            <>
              <div className="flex flex-col gap-3">
                <button
                  type="button"
                  onClick={() => togglePanel("id3")}
                  className="w-full flex items-center justify-between gap-3 px-4 py-3 bg-[#121212] hover:bg-[#171717] border border-white/5 rounded-xl text-left transition-all cursor-pointer"
                >
                  <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-zinc-300">
                    <User className="w-3.5 h-3.5 text-[#ff4e00]" />
                    Metadata Studio
                  </span>
                  {collapsedPanels.has("id3") ? <ChevronDown className="w-4 h-4 text-zinc-500" /> : <ChevronUp className="w-4 h-4 text-zinc-500" />}
                </button>
                {!collapsedPanels.has("id3") && (
                  <ID3TagEditor
                    tags={tags}
                    thumbnailUrl={tags.coverUrl}
                    isOptimizing={isOptimizingTags}
                    isMusicBrainzLoading={isMusicBrainzLoading}
                    onTagsChange={setTags}
                    onTriggerOptimize={() => triggerTagOptimization(tags.title, tags.artist)}
                    onMusicBrainzLookup={handleMusicBrainzLookup}
                    hasVideoLoaded={!!videoMetadata}
                  />
                )}
              </div>

              <div className="bg-[#121212] rounded-2xl border border-white/5 p-5 shadow-2xl flex flex-col gap-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-[#ff4e00]" />
                    <h3 className="font-heading font-semibold text-white text-base">Quick Studio Profiles</h3>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setShowPresetModal(true)}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 bg-[#ff4e00]/10 hover:bg-[#ff4e00]/20 border border-[#ff4e00]/20 rounded-lg text-[10px] font-bold text-[#ff8c00] transition-colors cursor-pointer"
                    >
                      <Save className="w-3 h-3" />
                      Save Preset
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setSettings(prev => ({
                          ...defaultSettings,
                          trimStart: prev.trimStart,
                          trimEnd: prev.trimEnd
                        }));
                        setLogs(prev => [...prev, "AUDIO_PROFILE: Reset studio profile to default conversion settings."]);
                      }}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 bg-zinc-950 hover:bg-zinc-900 border border-white/10 rounded-lg text-[10px] font-bold text-zinc-500 hover:text-white transition-colors cursor-pointer"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      Reset
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-2">
                  {AUDIO_PROFILES.map((profile) => (
                    <button
                      key={profile.label}
                      type="button"
                      onClick={() => handleApplyAudioProfile(profile)}
                      className="p-3 rounded-xl border border-white/5 bg-[#080808] hover:border-[#ff4e00]/35 hover:bg-[#ff4e00]/10 text-left transition-all cursor-pointer"
                    >
                      <span className="block text-xs font-black text-white uppercase tracking-wider">{profile.label}</span>
                      <span className="block text-[10px] text-zinc-500 mt-1 leading-snug">{profile.description}</span>
                    </button>
                  ))}
                </div>

                {/* User-saved presets */}
                {savedPresets.length > 0 && (
                  <div className="border-t border-white/5 pt-3 flex flex-col gap-2">
                    <span className="text-[10px] uppercase font-mono font-bold text-zinc-500 tracking-wider">Saved Presets</span>
                    <div className="flex flex-wrap gap-2">
                      {savedPresets.map(preset => (
                        <div key={preset.id} className="flex items-center gap-1 bg-[#080808] border border-white/5 rounded-lg px-2.5 py-1.5 group">
                          <button
                            type="button"
                            onClick={() => handleApplySavedPreset(preset)}
                            className="text-[11px] font-bold text-zinc-300 hover:text-white transition-colors cursor-pointer"
                          >
                            {preset.name}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteSavedPreset(preset.id)}
                            title="Delete preset"
                            className="opacity-0 group-hover:opacity-100 transition-opacity ml-1 text-zinc-600 hover:text-rose-400 cursor-pointer"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-3">
                <button
                  type="button"
                  onClick={() => togglePanel("dsp")}
                  className="w-full flex items-center justify-between gap-3 px-4 py-3 bg-[#121212] hover:bg-[#171717] border border-white/5 rounded-xl text-left transition-all cursor-pointer"
                >
                  <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-zinc-300">
                    <Sliders className="w-3.5 h-3.5 text-[#ff4e00]" />
                    DSP Console
                  </span>
                  {collapsedPanels.has("dsp") ? <ChevronDown className="w-4 h-4 text-zinc-500" /> : <ChevronUp className="w-4 h-4 text-zinc-500" />}
                </button>
                {!collapsedPanels.has("dsp") && (
                  <AudioSettingsPanel
                    settings={settings}
                    durationSeconds={videoMetadata.durationSeconds || 220}
                    onChange={setSettings}
                  />
                )}
              </div>
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
        <div className="lg:col-span-4 flex flex-col gap-6">
          
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
                currentTime={audioCurrentTime}
                duration={audioDuration}
                onSeek={(time) => {
                  if (audioRef.current) {
                    audioRef.current.currentTime = time;
                    setAudioCurrentTime(time);
                  }
                }}
              />

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {([
                  ["Status", sessionHealth.status, sessionHealth.hasBackend ? "text-emerald-400" : "text-rose-400"],
                  ["Queue Load", String(sessionHealth.queueLoad), "text-[#ffaa00]"],
                  ["ZIP Cache", String(sessionHealth.cacheFiles), "text-sky-400"],
                  ["Smart Mode", smartRecommendation.label, "text-purple-300"]
                ] as const).map(([label, value, color]) => (
                  <div key={label} className="bg-[#080808] border border-white/5 rounded-xl px-3 py-2 min-w-0">
                    <span className="block text-[9px] uppercase tracking-widest font-mono text-zinc-600">{label}</span>
                    <span className={`block text-[11px] font-bold truncate ${color}`}>{value}</span>
                  </div>
                ))}
              </div>

              <div className="bg-[#080808] border border-white/5 rounded-xl p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <FileDown className="w-4 h-4 text-[#ff4e00]" />
                  <div className="flex flex-col">
                    <span className="text-[10px] font-black text-zinc-400 uppercase tracking-widest font-mono">
                      Filename Template
                    </span>
                    <span className="text-[10px] text-zinc-600 truncate max-w-[260px]">
                      {buildDownloadFilename(filenameTemplate, {
                        title: tags.title || videoMetadata.title,
                        artist: tags.artist || videoMetadata.author,
                        bitrate: settings.bitrate,
                        format: settings.format,
                        mode: settings.conversionMode
                      })}
                    </span>
                  </div>
                </div>
                <select
                  value={filenameTemplate}
                  onChange={(e) => setFilenameTemplate(toFilenameTemplate(e.target.value))}
                  disabled={isConverting}
                  className="bg-zinc-950 border border-white/10 text-zinc-300 rounded-lg px-3 py-2 text-[10px] font-mono focus:outline-hidden cursor-pointer focus:border-[#ff4e00] disabled:opacity-50"
                >
                  <option value="title_bitrate">Title + bitrate</option>
                  <option value="artist_title">Artist + title</option>
                  <option value="title_mode">Title + mode</option>
                  <option value="artist_title_mode">Artist + title + mode</option>
                </select>
              </div>

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
                        ref={audioRef}
                        src={audioUrl}
                        controls
                        className="w-full h-8 accent-orange-500"
                        onPlay={() => setIsPlaying(true)}
                        onPause={() => setIsPlaying(false)}
                        onEnded={() => { setIsPlaying(false); setAudioCurrentTime(0); }}
                        onTimeUpdate={e => setAudioCurrentTime(e.currentTarget.currentTime)}
                        onLoadedMetadata={e => setAudioDuration(e.currentTarget.duration)}
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
              <div className="flex flex-col gap-3">
                <button
                  type="button"
                  onClick={() => togglePanel("console")}
                  className="w-full flex items-center justify-between gap-3 px-4 py-3 bg-[#080808] hover:bg-[#0f0f0f] border border-white/5 rounded-xl text-left transition-all cursor-pointer"
                >
                  <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-zinc-300">
                    <Activity className="w-3.5 h-3.5 text-[#ff4e00]" />
                    Process Console ({logs.length})
                  </span>
                  {collapsedPanels.has("console") ? <ChevronDown className="w-4 h-4 text-zinc-500" /> : <ChevronUp className="w-4 h-4 text-zinc-500" />}
                </button>
                {!collapsedPanels.has("console") && <ConsoleOutput logs={logs} />}
              </div>

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

      {/* Live backend status */}
      <footer className="bg-[#0c0c0c] border-t border-white/5 py-8 px-6 md:px-12 text-zinc-500 mt-20 relative z-10">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-end gap-8">
          <div className="flex flex-col sm:flex-row gap-8 sm:gap-12 w-full md:w-auto">
            <div className="flex flex-col gap-1">
              <span className="text-zinc-600 text-[10px] uppercase tracking-widest font-mono">Processing Node</span>
              <span className={`text-xs font-mono ${backendHealth.status === "ready" ? "text-[#00ff9d]" : "text-[#ffaa00]"}`}>
                LOCALHOST // {backendHealth.status.toUpperCase()}
              </span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-zinc-600 text-[10px] uppercase tracking-widest font-mono">Runtime</span>
              <span className="text-xs font-mono text-white">{formatUptime(backendHealth.uptimeSeconds)}</span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-zinc-600 text-[10px] uppercase tracking-widest font-mono">Queued Jobs</span>
              <span className="text-xs font-mono text-white">{queue.filter(item => item.status === "pending").length}</span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-zinc-600 text-[10px] uppercase tracking-widest font-mono">Transcoder</span>
              <span className="text-xs font-mono text-white">YT-DLP {backendHealth.ytdlp.toUpperCase()} / FFMPEG {backendHealth.ffmpeg.toUpperCase()}</span>
            </div>
          </div>

          <div className="flex flex-col items-start md:items-end gap-2 w-full md:w-auto">
            <span className="text-zinc-600 text-[10px] uppercase tracking-widest font-mono">BAD N3WS Stream v3.0</span>
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

      {/* ── Save Preset Modal ── */}
      <AnimatePresence>
        {showPresetModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/80 backdrop-blur-md z-[200] flex items-center justify-center p-4"
            onClick={() => setShowPresetModal(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={e => e.stopPropagation()}
              className="bg-[#111] border border-white/10 rounded-2xl w-full max-w-sm p-6 shadow-2xl flex flex-col gap-4"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Save className="w-4 h-4 text-[#ff4e00]" />
                  <h3 className="text-sm font-bold text-white">Save Settings Preset</h3>
                </div>
                <button type="button" onClick={() => setShowPresetModal(false)} className="w-7 h-7 flex items-center justify-center rounded-lg bg-white/5 hover:bg-white/10 cursor-pointer transition-colors">
                  <X className="w-4 h-4 text-zinc-400" />
                </button>
              </div>
              <p className="text-xs text-zinc-400">Saves the current format, DSP, and processing settings as a named preset you can recall any time.</p>
              <input
                type="text"
                value={presetName}
                onChange={e => setPresetName(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleSavePreset()}
                placeholder="Preset name (e.g. My Podcast)"
                autoFocus
                className="w-full px-3.5 py-2.5 bg-[#080808] border border-white/10 focus:border-[#ff4e00] rounded-xl text-sm text-white focus:outline-hidden placeholder:text-zinc-600 transition-all"
              />
              <div className="flex gap-2">
                <button type="button" onClick={() => setShowPresetModal(false)} className="flex-1 py-2.5 bg-zinc-900 border border-white/10 rounded-xl text-xs font-bold text-zinc-400 hover:text-white transition-colors cursor-pointer">
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSavePreset}
                  disabled={!presetName.trim()}
                  className="flex-1 py-2.5 bg-[#ff4e00] hover:bg-orange-500 rounded-xl text-xs font-bold text-white transition-colors cursor-pointer disabled:opacity-50"
                >
                  Save Preset
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

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
                        a.download = buildDownloadFilename(filenameTemplate, {
                          title: item.title,
                          artist: item.artist,
                          bitrate: item.bitrate,
                          format: item.format,
                          mode: settings.conversionMode
                        });
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

      {/* Toast notifications */}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />

      {/* Keyboard shortcuts overlay */}
      <AnimatePresence>
        {showShortcuts && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/80 backdrop-blur-md z-[300] flex items-center justify-center p-4"
            onClick={() => setShowShortcuts(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={e => e.stopPropagation()}
              className="bg-[#111] border border-white/10 rounded-2xl w-full max-w-sm p-6 shadow-2xl flex flex-col gap-4"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Keyboard className="w-4 h-4 text-[#ff4e00]" />
                  <h3 className="text-sm font-bold text-white">Keyboard Shortcuts</h3>
                </div>
                <button type="button" onClick={() => setShowShortcuts(false)} className="w-7 h-7 flex items-center justify-center rounded-lg bg-white/5 hover:bg-white/10 cursor-pointer transition-colors">
                  <X className="w-4 h-4 text-zinc-400" />
                </button>
              </div>
              <div className="flex flex-col gap-2 text-xs font-mono">
                {[
                  ["Space", "Play / Pause preview audio"],
                  ["Ctrl + Enter", "Convert & Download current track"],
                  ["Ctrl + Shift + Enter", "Process queue"],
                  ["Ctrl + P", "Pause / resume queue starts"],
                  ["Esc", "Close modals"],
                  ["Ctrl + /", "Toggle this shortcut reference"],
                ].map(([keys, desc]) => (
                  <div key={keys} className="flex items-center justify-between gap-4">
                    <span className="text-zinc-300 bg-zinc-800 px-2 py-1 rounded text-[10px] font-bold shrink-0">{keys}</span>
                    <span className="text-zinc-500 text-right text-[11px]">{desc}</span>
                  </div>
                ))}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Related videos panel (shown when loaded) */}
      <AnimatePresence>
        {showRelated && relatedVideos.length > 0 && (
          <motion.div
            initial={{ opacity: 0, x: 40 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 40 }}
            className="fixed top-20 right-4 z-[150] w-72 bg-[#111] border border-white/10 rounded-2xl shadow-2xl flex flex-col overflow-hidden"
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
              <span className="text-xs font-bold text-white flex items-center gap-2">
                <Activity className="w-3.5 h-3.5 text-[#ff4e00]" /> Related
              </span>
              <button type="button" onClick={() => setShowRelated(false)} className="text-zinc-500 hover:text-white cursor-pointer transition-colors">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="flex flex-col divide-y divide-white/5 max-h-80 overflow-y-auto">
              {relatedVideos.map((v, i) => (
                <button
                  key={i} type="button"
                  onClick={() => { handleLoadMetadata(v.url); setShowRelated(false); }}
                  className="flex flex-col gap-0.5 px-4 py-2.5 hover:bg-white/5 text-left cursor-pointer transition-colors"
                >
                  <span className="text-[11px] font-semibold text-white truncate">{v.title}</span>
                  <span className="text-[10px] text-zinc-500 truncate">{v.channel}</span>
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Artist discography panel */}
      <AnimatePresence>
        {showArtistVideos && artistVideos.length > 0 && (
          <motion.div
            initial={{ opacity: 0, x: -40 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -40 }}
            className="fixed top-20 left-4 z-[150] w-72 bg-[#111] border border-white/10 rounded-2xl shadow-2xl flex flex-col overflow-hidden"
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
              <span className="text-xs font-bold text-white flex items-center gap-2">
                <Users className="w-3.5 h-3.5 text-purple-400" /> {tags.artist || "Artist"}
              </span>
              <button type="button" onClick={() => setShowArtistVideos(false)} className="text-zinc-500 hover:text-white cursor-pointer transition-colors">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="flex flex-col divide-y divide-white/5 max-h-80 overflow-y-auto">
              {artistVideos.map((v, i) => (
                <button
                  key={i} type="button"
                  onClick={() => { handleLoadMetadata(v.url); setShowArtistVideos(false); }}
                  className="flex flex-col gap-0.5 px-4 py-2.5 hover:bg-white/5 text-left cursor-pointer transition-colors"
                >
                  <span className="text-[11px] font-semibold text-white truncate">{v.title}</span>
                  <span className="text-[10px] text-zinc-500 truncate">{v.channel}</span>
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

    </div>
  );
}
