import { AudioSettings } from "../types";
import { Sliders, Volume2, Scissors, Music, Headphones, Flame, AudioLines, Radio, Gauge, Sparkles, Timer, Waves, Mic2 } from "lucide-react";

const EQ_PRESETS: Array<{ id: AudioSettings["equalizer"]; label: string }> = [
  { id: "flat", label: "Flat" },
  { id: "bass", label: "Bass Booster" },
  { id: "vocal", label: "Vocal Center" },
  { id: "treble", label: "Pure Treble" },
  { id: "instrumental", label: "Acoustic Stage" },
  { id: "lofi", label: "Lo-Fi Vintage" },
];

const CONVERSION_MODES: Array<{
  id: AudioSettings["conversionMode"];
  label: string;
  description: string;
}> = [
  { id: "standard", label: "Standard", description: "Clean format conversion" },
  { id: "audio_mix", label: "Audio Mix", description: "Balanced EQ and bus glue" },
  { id: "mastering", label: "Mastering", description: "Loudness, polish, limiter" },
  { id: "vocal_master", label: "Vocal Master", description: "Speech and lead clarity" },
  { id: "club_master", label: "Club Master", description: "Wide, loud, bass-forward" },
];

const LOUDNESS_TARGETS: AudioSettings["loudnessTarget"][] = [-18, -16, -14, -12, -10];

interface AudioSettingsPanelProps {
  settings: AudioSettings;
  durationSeconds: number;
  onChange: (settings: AudioSettings) => void;
}

export default function AudioSettingsPanel({ settings, durationSeconds = 220, onChange }: AudioSettingsPanelProps) {
  
  const updateSetting = <K extends keyof AudioSettings>(key: K, value: AudioSettings[K]) => {
    onChange({
      ...settings,
      [key]: value
    });
  };

  const handleTrimStartChange = (val: number) => {
    const start = Math.max(0, Math.min(val, settings.trimEnd - 1));
    updateSetting("trimStart", start);
  };

  const handleTrimEndChange = (val: number) => {
    const end = Math.max(settings.trimStart + 1, Math.min(val, durationSeconds));
    updateSetting("trimEnd", end);
  };

  const formatSeconds = (sec: number) => {
    const minutes = Math.floor(sec / 60);
    const seconds = Math.floor(sec % 60);
    return `${minutes}:${seconds < 10 ? "0" : ""}${seconds}`;
  };

  return (
    <div id="audio_settings_panel" className="bg-[#121212] rounded-2xl border border-white/5 p-6 shadow-2xl flex flex-col gap-6">
      <div className="flex items-center gap-2 border-b border-white/5 pb-3">
        <Sliders className="w-5 h-5 text-[#ff4e00]" />
        <h3 className="font-heading font-semibold tracking-tight text-white text-lg">
          High-Quality Transcoding Settings
        </h3>
      </div>

      {/* Conversion Mode Suite */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-2">
        {CONVERSION_MODES.map((mode) => (
          <button
            key={mode.id}
            type="button"
            onClick={() => updateSetting("conversionMode", mode.id)}
            className={`p-3 border rounded-xl text-left transition-all cursor-pointer ${
              settings.conversionMode === mode.id
                ? "border-[#ff4e00] bg-[#ff4e00]/10 shadow-[0_0_18px_rgba(255,78,0,0.16)]"
                : "border-white/5 bg-[#080808] hover:border-white/15 hover:bg-white/5"
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className={`text-xs font-extrabold uppercase tracking-wider ${
                settings.conversionMode === mode.id ? "text-[#ff8c00]" : "text-white"
              }`}>
                {mode.label}
              </span>
              <AudioLines className={`w-4 h-4 ${settings.conversionMode === mode.id ? "text-[#ff4e00]" : "text-zinc-600"}`} />
            </div>
            <p className="text-[10px] text-zinc-500 mt-1 leading-snug">{mode.description}</p>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        
        {/* Format Selection Component */}
        <div className="flex flex-col gap-2">
          <label className="text-xs font-semibold text-zinc-500 font-sans tracking-wide uppercase flex items-center gap-1.5">
            <Music className="w-3.5 h-3.5 text-zinc-400" /> Output format
          </label>
          <div className="grid grid-cols-3 gap-1.5 p-1 bg-[#080808] rounded-xl border border-white/5">
            {(["mp3", "wav", "aac", "flac", "m4a", "ogg"] as const).map((fmt) => (
              <button
                key={fmt}
                type="button"
                onClick={() => updateSetting("format", fmt)}
                className={`py-1.5 px-3 rounded-lg text-xs font-semibold uppercase tracking-wider transition-all duration-150 cursor-pointer ${
                  settings.format === fmt
                    ? "bg-[#ff4e00] text-white shadow-[0_0_10px_rgba(255,78,0,0.3)] font-bold"
                    : "text-zinc-400 hover:text-white hover:bg-white/5"
                }`}
              >
                {fmt}
              </button>
            ))}
          </div>
        </div>

        {/* Audio Quality Bitrate */}
        <div className="flex flex-col gap-2">
          <label className="text-xs font-semibold text-zinc-500 font-sans tracking-wide uppercase flex items-center gap-1.5">
            <Headphones className="w-3.5 h-3.5 text-zinc-400" /> Audio Bitrate
          </label>
          <div className="grid grid-cols-4 gap-1 p-1 bg-[#080808] rounded-xl border border-white/5">
            {([128, 192, 256, 320] as const).map((rate) => (
              <button
                key={rate}
                type="button"
                onClick={() => updateSetting("bitrate", rate)}
                className={`py-1.5 rounded-lg text-xs font-semibold transition-all duration-150 cursor-pointer ${
                  settings.bitrate === rate
                    ? "bg-[#ff4e00] text-white shadow-[0_0_10px_rgba(255,78,0,0.4)] font-bold"
                    : "text-zinc-500 hover:text-white hover:bg-white/5"
                }`}
              >
                {rate}k
                {rate === 320 && <span className="block text-[8px] font-bold tracking-tight text-white uppercase -mt-0.5">HD</span>}
              </button>
            ))}
          </div>
        </div>

        {/* Sample Rate */}
        <div className="flex flex-col gap-2">
          <label className="text-xs font-semibold text-zinc-500 font-sans tracking-wide uppercase flex items-center gap-1.5">
            <Sliders className="w-3.5 h-3.5 text-zinc-400" /> Sample Frequency
          </label>
          <div className="grid grid-cols-2 gap-1.5 p-1 bg-[#080808] rounded-xl border border-white/5">
            {([44100, 48000] as const).map((rate) => (
              <button
                key={rate}
                type="button"
                onClick={() => updateSetting("sampleRate", rate)}
                className={`py-1.5 rounded-lg text-xs font-semibold transition-all duration-150 cursor-pointer ${
                  settings.sampleRate === rate
                    ? "bg-white text-black shadow-sm font-bold"
                    : "text-zinc-400 hover:text-white hover:bg-white/5"
                }`}
              >
                {rate === 44100 ? "44.1 kHz (CD)" : "48.0 kHz (Studio)"}
              </button>
            ))}
          </div>
        </div>

      </div>

      {/* DSP Effects Section */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 border-t border-white/5 pt-6">
        
        {/* Equalizer Profile */}
        <div className="flex flex-col gap-2">
          <label className="text-xs font-semibold text-zinc-500 font-sans tracking-wide uppercase flex items-center gap-1.5">
            <Sliders className="w-3.5 h-3.5 text-zinc-400" /> EQ Profile Preset
          </label>
          <div className="grid grid-cols-3 gap-1.5">
            {EQ_PRESETS.map((eq) => (
              <button
                key={eq.id}
                type="button"
                onClick={() => updateSetting("equalizer", eq.id)}
                className={`py-2 px-3 border rounded-xl text-left text-xs font-medium cursor-pointer transition-all duration-150 ${
                  settings.equalizer === eq.id
                    ? "border-[#ff4e00] bg-[#ff4e00]/10 text-[#ff8c00] font-semibold"
                    : "border-white/5 hover:bg-white/5 text-zinc-400 hover:text-zinc-200"
                }`}
              >
                {eq.label}
              </button>
            ))}
          </div>
        </div>

        {/* Volume & Boost */}
        <div className="flex flex-col gap-4 bg-[#080808] p-4 rounded-xl border border-white/5">
          <div className="flex justify-between items-center">
            <label className="text-xs font-semibold text-zinc-400 font-sans tracking-wide uppercase flex items-center gap-1.5">
              <Volume2 className="w-3.5 h-3.5 text-zinc-500" /> Gain Boost Power
            </label>
            <span className="text-xs font-mono font-bold text-white bg-zinc-800 px-2 py-0.5 rounded">
              {(settings.volumeBoost * 100).toFixed(0)}%
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[10px] text-zinc-500 font-mono">100%</span>
            <input
              type="range"
              min="1.0"
              max="2.5"
              step="0.1"
              value={settings.volumeBoost}
              onChange={(e) => updateSetting("volumeBoost", parseFloat(e.target.value))}
              className="flex-1 h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-[#ff4e00]"
            />
            <span className="text-[10px] text-[#ff4e00] font-mono flex items-center gap-0.5 font-bold">
              250% <Flame className="w-3 h-3 text-[#ff4e00] animate-pulse" />
            </span>
          </div>
          <p className="text-[10.5px] text-zinc-500 font-sans italic -mt-2">
            Warning: Setting gain boost over 150% may result in safe analog compression to avoid digital clipping noise.
          </p>
        </div>

      </div>

      {/* Mix and Master Controls */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 border-t border-white/5 pt-6">
        <div className="flex flex-col gap-3 bg-[#080808] p-4 rounded-xl border border-white/5">
          <div className="flex justify-between items-center">
            <label className="text-xs font-semibold text-zinc-400 font-sans tracking-wide uppercase flex items-center gap-1.5">
              <Radio className="w-3.5 h-3.5 text-zinc-500" /> Stereo Width
            </label>
            <span className="text-xs font-mono font-bold text-white bg-zinc-800 px-2 py-0.5 rounded">
              {(settings.stereoWidth * 100).toFixed(0)}%
            </span>
          </div>
          <input
            type="range"
            min="0.7"
            max="2"
            step="0.05"
            value={settings.stereoWidth}
            onChange={(e) => updateSetting("stereoWidth", parseFloat(e.target.value))}
            className="h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-[#ff4e00]"
          />
        </div>

        <div className="flex flex-col gap-3 bg-[#080808] p-4 rounded-xl border border-white/5">
          <div className="flex justify-between items-center">
            <label className="text-xs font-semibold text-zinc-400 font-sans tracking-wide uppercase flex items-center gap-1.5">
              <Gauge className="w-3.5 h-3.5 text-zinc-500" /> Compression
            </label>
            <span className="text-xs font-mono font-bold text-white bg-zinc-800 px-2 py-0.5 rounded">
              {settings.compression}%
            </span>
          </div>
          <input
            type="range"
            min="0"
            max="100"
            step="5"
            value={settings.compression}
            onChange={(e) => updateSetting("compression", parseInt(e.target.value))}
            className="h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-[#ffaa00]"
          />
        </div>

        <div className="flex flex-col gap-3 bg-[#080808] p-4 rounded-xl border border-white/5">
          <div className="flex justify-between items-center">
            <label className="text-xs font-semibold text-zinc-400 font-sans tracking-wide uppercase flex items-center gap-1.5">
              <Volume2 className="w-3.5 h-3.5 text-zinc-500" /> Limiter Ceiling
            </label>
            <span className="text-xs font-mono font-bold text-white bg-zinc-800 px-2 py-0.5 rounded">
              {(settings.limiterCeiling * 100).toFixed(0)}%
            </span>
          </div>
          <input
            type="range"
            min="0.85"
            max="1"
            step="0.01"
            value={settings.limiterCeiling}
            onChange={(e) => updateSetting("limiterCeiling", parseFloat(e.target.value))}
            className="h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-[#ff4e00]"
          />
        </div>
      </div>

      {/* Restoration and Loudness Controls */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 border-t border-white/5 pt-6">
        <div className="flex flex-col gap-4 bg-[#080808] p-4 rounded-xl border border-white/5">
          <div className="flex items-center justify-between gap-3">
            <label className="text-xs font-semibold text-zinc-400 font-sans tracking-wide uppercase flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-zinc-500" /> Noise Cleanup
            </label>
            <span className="text-xs font-mono font-bold text-white bg-zinc-800 px-2 py-0.5 rounded">
              {settings.noiseReduction}%
            </span>
          </div>
          <input
            type="range"
            min="0"
            max="100"
            step="5"
            value={settings.noiseReduction}
            onChange={(e) => updateSetting("noiseReduction", parseInt(e.target.value))}
            className="h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-[#ffaa00]"
          />

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-2">
              <div className="flex justify-between text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">
                <span>High-Pass</span>
                <span className="font-mono text-[#ffaa00]">{settings.highPass}Hz</span>
              </div>
              <input
                type="range"
                min="0"
                max="400"
                step="5"
                value={settings.highPass}
                onChange={(e) => updateSetting("highPass", parseInt(e.target.value))}
                className="h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-[#ff4e00]"
              />
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex justify-between text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">
                <span>Low-Pass</span>
                <span className="font-mono text-[#ffaa00]">{settings.lowPass >= 20000 ? "Open" : `${settings.lowPass}Hz`}</span>
              </div>
              <input
                type="range"
                min="4000"
                max="20000"
                step="250"
                value={settings.lowPass}
                onChange={(e) => updateSetting("lowPass", parseInt(e.target.value))}
                className="h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-[#ff4e00]"
              />
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-4 bg-[#080808] p-4 rounded-xl border border-white/5">
          <div className="flex items-center justify-between gap-3">
            <label className="text-xs font-semibold text-zinc-400 font-sans tracking-wide uppercase flex items-center gap-1.5">
              <Waves className="w-3.5 h-3.5 text-zinc-500" /> Loudness Normalizer
            </label>
            <button
              type="button"
              onClick={() => updateSetting("normalizeLoudness", !settings.normalizeLoudness)}
              className={`px-3 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider border transition-all cursor-pointer ${
                settings.normalizeLoudness
                  ? "bg-[#ff4e00] border-[#ff4e00] text-white"
                  : "bg-zinc-950 border-white/10 text-zinc-500 hover:text-white"
              }`}
            >
              {settings.normalizeLoudness ? "On" : "Off"}
            </button>
          </div>

          <div className="grid grid-cols-5 gap-1.5">
            {LOUDNESS_TARGETS.map((target) => (
              <button
                key={target}
                type="button"
                onClick={() => updateSetting("loudnessTarget", target)}
                disabled={!settings.normalizeLoudness}
                className={`py-2 rounded-lg text-[10px] font-bold font-mono border transition-all cursor-pointer disabled:cursor-not-allowed disabled:opacity-35 ${
                  settings.loudnessTarget === target
                    ? "bg-white text-black border-white"
                    : "bg-zinc-950 text-zinc-400 border-white/10 hover:text-white"
                }`}
              >
                {target}
              </button>
            ))}
          </div>
          <p className="text-[10.5px] text-zinc-500 font-sans leading-snug">
            Target is measured in LUFS. Lower values preserve headroom; higher values push louder exports for car, club, or phone playback.
          </p>
        </div>
      </div>

      {/* Playback and Channel Controls */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 border-t border-white/5 pt-6">
        <div className="flex flex-col gap-3 bg-[#080808] p-4 rounded-xl border border-white/5">
          <div className="flex justify-between items-center">
            <label className="text-xs font-semibold text-zinc-400 font-sans tracking-wide uppercase flex items-center gap-1.5">
              <Timer className="w-3.5 h-3.5 text-zinc-500" /> Tempo
            </label>
            <span className="text-xs font-mono font-bold text-white bg-zinc-800 px-2 py-0.5 rounded">
              {(settings.tempo * 100).toFixed(0)}%
            </span>
          </div>
          <input
            type="range"
            min="0.75"
            max="1.25"
            step="0.01"
            value={settings.tempo}
            onChange={(e) => updateSetting("tempo", parseFloat(e.target.value))}
            className="h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-[#ffaa00]"
          />
        </div>

        <div className="flex flex-col gap-3 bg-[#080808] p-4 rounded-xl border border-white/5">
          <div className="flex justify-between items-center">
            <label className="text-xs font-semibold text-zinc-400 font-sans tracking-wide uppercase flex items-center gap-1.5">
              <Mic2 className="w-3.5 h-3.5 text-zinc-500" /> Pitch Shift
            </label>
            <span className="text-xs font-mono font-bold text-white bg-zinc-800 px-2 py-0.5 rounded">
              {settings.pitchShift > 0 ? "+" : ""}{settings.pitchShift} st
            </span>
          </div>
          <input
            type="range"
            min="-12"
            max="12"
            step="1"
            value={settings.pitchShift}
            onChange={(e) => updateSetting("pitchShift", parseInt(e.target.value))}
            className="h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-[#ff4e00]"
          />
        </div>

        <div className="flex flex-col gap-2 bg-[#080808] p-4 rounded-xl border border-white/5">
          <label className="text-xs font-semibold text-zinc-400 font-sans tracking-wide uppercase flex items-center gap-1.5">
            <Radio className="w-3.5 h-3.5 text-zinc-500" /> Output Channel
          </label>
          <div className="grid grid-cols-2 gap-1.5 p-1 bg-zinc-950 rounded-xl border border-white/5">
            {(["stereo", "mono"] as const).map((channel) => (
              <button
                key={channel}
                type="button"
                onClick={() => updateSetting("channelMode", channel)}
                className={`py-2 rounded-lg text-xs font-black uppercase tracking-wider transition-all cursor-pointer ${
                  settings.channelMode === channel
                    ? "bg-[#ff4e00] text-white"
                    : "text-zinc-500 hover:text-white hover:bg-white/5"
                }`}
              >
                {channel}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Interactive Timing & Scissoring Options */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 border-t border-white/5 pt-6">
        
        {/* Audio Trimmer */}
        <div className="flex flex-col gap-3">
          <div className="flex justify-between items-center">
            <label className="text-xs font-semibold text-zinc-500 font-sans tracking-wide uppercase flex items-center gap-1.5">
              <Scissors className="w-3.5 h-3.5 text-zinc-400" /> Audio Cutting (Trimmer)
            </label>
            <span className="text-xs font-mono font-semibold text-[#ff4e00]">
              Duration: {formatSeconds(settings.trimEnd - settings.trimStart)}
            </span>
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex justify-between text-xs font-mono text-zinc-500">
              <span>Start Trim: {formatSeconds(settings.trimStart)}</span>
              <span>End Trim: {formatSeconds(settings.trimEnd)}</span>
            </div>
            
            <div className="flex gap-4">
              <div className="flex-1">
                <input
                  type="range"
                  min="0"
                  max={durationSeconds}
                  value={settings.trimStart}
                  onChange={(e) => handleTrimStartChange(parseInt(e.target.value))}
                  className="w-full h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-[#ff4e00]"
                />
              </div>
              <div className="flex-1">
                <input
                  type="range"
                  min="0"
                  max={durationSeconds}
                  value={settings.trimEnd}
                  onChange={(e) => handleTrimEndChange(parseInt(e.target.value))}
                  className="w-full h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-[#ffaa00]"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Fading curves */}
        <div className="flex gap-4 bg-[#080808] p-4 rounded-xl border border-white/5">
          <div className="flex-1 flex flex-col gap-2">
            <div className="flex justify-between text-[11px] font-sans font-semibold text-zinc-500 uppercase tracking-wider">
              <span>Fade-In</span>
              <span className="font-mono text-[#ffaa00]">{settings.fadeIn}s</span>
            </div>
            <input
              type="range"
              min="0"
              max="10"
              value={settings.fadeIn}
              onChange={(e) => updateSetting("fadeIn", parseInt(e.target.value))}
              className="h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-[#ff4e00]"
            />
          </div>

          <div className="w-[1px] h-10 bg-white/10 self-center"></div>

          <div className="flex-1 flex flex-col gap-2">
            <div className="flex justify-between text-[11px] font-sans font-semibold text-zinc-500 uppercase tracking-wider">
              <span>Fade-Out</span>
              <span className="font-mono text-[#ff8c00]">{settings.fadeOut}s</span>
            </div>
            <input
              type="range"
              min="0"
              max="10"
              value={settings.fadeOut}
              onChange={(e) => updateSetting("fadeOut", parseInt(e.target.value))}
              className="h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-[#ff4e00]"
            />
          </div>
        </div>

      </div>

    </div>
  );
}
