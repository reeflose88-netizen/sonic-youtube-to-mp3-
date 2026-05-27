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
  equalizer: 'flat' | 'bass' | 'vocal' | 'treble' | 'instrumental' | 'lofi';
  volumeBoost: number; // multiplier e.g. 1.0 to 2.5
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

