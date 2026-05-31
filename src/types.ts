export interface VideoMetadata {
  title: string;
  author: string;
  thumbnailUrl: string;
  duration?: string; // in MM:SS format or seconds
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
  volumeBoost: number; // multiplier e.g. 1.0 to 2.5
  stereoWidth: number; // multiplier e.g. 0.7 to 2.0
  compression: number; // percentage intensity from 0 to 100
  limiterCeiling: number; // linear ceiling e.g. 0.85 to 1.0
  normalizeLoudness: boolean;
  loudnessTarget: -18 | -16 | -14 | -12 | -10;
  noiseReduction: number; // percentage intensity from 0 to 100
  highPass: number; // frequency in Hz
  lowPass: number; // frequency in Hz
  tempo: number; // playback speed multiplier
  pitchShift: number; // semitones
  trimStart: number; // in seconds
  trimEnd: number; // in seconds
  fadeIn: number; // in seconds
  fadeOut: number; // in seconds
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
}

