export interface VideoMetadata {
  title: string;
  author: string;
  thumbnailUrl: string;
  duration?: string;
  durationSeconds?: number;
  url: string;
}

export interface ID3Tags {
  title: string;
  artist: string;
  album: string;
  genre: string;
  year: string;
  coverUrl: string;
}

export interface AudioSettings {
  format: 'mp3' | 'wav' | 'aac' | 'flac' | 'm4a' | 'ogg';
  bitrate: 128 | 192 | 256 | 320;
  sampleRate: 44100 | 48000;
  conversionMode: 'standard' | 'audio_mix' | 'mastering' | 'vocal_master' | 'club_master';
  equalizer: 'flat' | 'bass' | 'vocal' | 'treble' | 'instrumental' | 'lofi';
  channelMode: 'stereo' | 'mono';
  volumeBoost: number;
  stereoWidth: number;
  compression: number;
  limiterCeiling: number;
  normalizeLoudness: boolean;
  loudnessTarget: -18 | -16 | -14 | -12 | -10;
  noiseReduction: number;
  highPass: number;
  lowPass: number;
  tempo: number;
  pitchShift: number;
  trimStart: number;
  trimEnd: number;
  fadeIn: number;
  fadeOut: number;
  embedThumbnail: boolean;
  reverb: number;
  eqBands: [number, number, number, number, number];
}

export interface SearchResult {
  title: string;
  channel: string;
  url: string;
  snippet?: string;
}

export interface QueueItem {
  id: string;
  url: string;
  title: string;
  artist: string;
  status: 'pending' | 'fetching_meta' | 'optimizing_tags' | 'converting' | 'completed' | 'failed';
  progress: number;
  bitrate: 128 | 192 | 256 | 320;
  format: 'mp3' | 'wav' | 'aac' | 'flac' | 'm4a' | 'ogg';
  thumbnailUrl?: string;
  error?: string;
  retryCount?: number;
  itemSettings?: {
    equalizer?: AudioSettings['equalizer'];
    conversionMode?: AudioSettings['conversionMode'];
    volumeBoost?: number;
    embedThumbnail?: boolean;
  };
}

export interface Chapter {
  title: string;
  startTime: number;
  endTime: number;
}

export interface SettingsPreset {
  id: string;
  name: string;
  settings: Partial<AudioSettings>;
  createdAt: string;
}
