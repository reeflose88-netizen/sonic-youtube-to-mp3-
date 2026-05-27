import { useState, FormEvent } from "react";
import { SearchResult } from "../types";
import { Search, Sparkles, Youtube, ExternalLink, Music, Plus, FolderPlus, ArrowUpRight } from "lucide-react";

interface ProactiveSearchProps {
  onSelectResult: (videoUrl: string) => void;
  onAddToQueue?: (url: string, title: string, artist: string) => void;
  isLoading: boolean;
  setIsLoading: (val: boolean) => void;
}

// Extract YouTube ID for real thumbnail lookup
function getYouTubeId(url: string) {
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
  const match = url.match(regExp);
  return (match && match[2].length === 11) ? match[2] : null;
}

const PRESET_QUERIES = [
  "Lofi hip hop beats",
  "Ludovico Einaudi piano",
  "Synthwave radio retro",
  "Ambient nature soundscape"
];

export default function ProactiveSearch({ onSelectResult, onAddToQueue, isLoading, setIsLoading }: ProactiveSearchProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [error, setError] = useState<string | null>(null);

  const handleSearch = async (e?: FormEvent, targetQuery?: string) => {
    if (e) e.preventDefault();
    const activeQuery = targetQuery || query;
    if (!activeQuery.trim()) return;

    if (targetQuery) {
      setQuery(targetQuery);
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: activeQuery })
      });

      if (!response.ok) {
        throw new Error("Failed to explore resources.");
      }

      const data = await response.json();
      setResults(data);
    } catch (err: any) {
      console.error(err);
      setError("Failed to retrieve YouTube search results. Try a direct video URL instead.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div id="proactive_search" className="bg-[#121212] rounded-2xl border border-white/5 p-6 shadow-2xl flex flex-col gap-5">
      
      <div className="flex flex-col gap-1 border-b border-white/5 pb-3">
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-[#ff4e00] animate-pulse" />
          <h3 className="font-heading font-semibold tracking-tight text-white text-lg">
            YouTube Finder
          </h3>
        </div>
        <p className="text-xs text-zinc-500 font-sans">
          Don't have a URL handy? Search YouTube directly, copy links, or load them instantly.
        </p>
      </div>

      {/* Preset Suggestion Tags */}
      <div className="flex flex-wrap gap-1.5">
        {PRESET_QUERIES.map((preset, idx) => (
          <button
            key={idx}
            type="button"
            onClick={() => handleSearch(undefined, preset)}
            disabled={isLoading}
            className="px-2.5 py-1 bg-zinc-900 hover:bg-[#ff4e00]/15 border border-white/5 hover:border-[#ff4e00]/20 text-[10px] text-zinc-400 hover:text-white rounded-lg transition-all cursor-pointer font-medium disabled:opacity-50"
          >
            {preset}
          </button>
        ))}
      </div>

      <form onSubmit={(e) => handleSearch(e)} className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search keywords: 'Relaxing ambient guitar', 'ludovico einaudi live'..."
            className="w-full pl-10 pr-4 py-2.5 bg-[#080808] border border-white/10 focus:border-[#ff4e00] rounded-xl text-sm font-medium text-white focus:outline-hidden transition-all shadow-inner placeholder:text-zinc-600"
          />
        </div>
        <button
          type="submit"
          disabled={isLoading || !query.trim()}
          className="px-5 py-2.5 bg-white text-black font-extrabold text-sm rounded-xl transition-all shadow-md shrink-0 cursor-pointer disabled:opacity-50 hover:bg-[#ff4e00] hover:text-white"
        >
          {isLoading ? "Searching..." : "Search"}
        </button>
      </form>

      {error && (
        <p className="text-xs font-semibold text-red-400 font-sans bg-red-950/20 p-3 rounded-xl border border-red-900/40">
          {error}
        </p>
      )}

      {results.length > 0 && (
        <div className="flex flex-col gap-3 max-h-96 overflow-y-auto pr-1">
          <div className="flex justify-between items-center bg-white/0">
            <span className="text-[10px] uppercase font-bold text-zinc-500 font-mono tracking-wider">
              YouTube Search Results
            </span>
            <span className="text-[9px] bg-[#ff4e00]/10 text-[#ff8c00] font-bold font-mono px-2 py-0.5 rounded">
              {results.length} Tracks Found
            </span>
          </div>

          {results.map((item, idx) => {
            const ytId = getYouTubeId(item.url);
            const thumbUrl = ytId 
              ? `https://img.youtube.com/vi/${ytId}/mqdefault.jpg` 
              : "https://images.unsplash.com/photo-1611162617213-7d7a39e9b1d7?w=120&auto=format&fit=crop";

            return (
              <div
                key={idx}
                className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-3 border border-white/5 hover:border-[#ff4e00]/20 bg-[#0c0c0c] hover:bg-[#ff4e00]/5 rounded-xl transition-all gap-3 group"
              >
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  {/* Embedded Real Youtube Thumbnail */}
                  <div className="w-16 h-10 rounded overflow-hidden bg-zinc-950 border border-white/10 shrink-0 relative">
                    <img 
                      src={thumbUrl} 
                      alt="" 
                      className="w-full h-full object-cover transition-transform group-hover:scale-105" 
                      onError={(e) => {
                        (e.target as HTMLImageElement).src = "https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=120&auto=format&fit=crop";
                      }}
                    />
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-0.5 flex justify-end">
                      <Youtube className="w-3.5 h-3.5 text-zinc-500 group-hover:text-red-500 transition-colors" />
                    </div>
                  </div>

                  <div className="flex flex-col min-w-0">
                    <h4 className="text-xs font-bold text-zinc-200 truncate leading-snug group-hover:text-white transition-colors">
                      {item.title}
                    </h4>
                    <p className="text-[10px] text-zinc-500 font-medium truncate mt-0.5">
                      Channel: {item.channel}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0 self-end sm:self-auto">
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-1.5 border border-white/5 hover:border-white/15 rounded-lg text-zinc-500 hover:text-zinc-300 transition-colors"
                    title="View on YouTube"
                    id={`search_link_${idx}`}
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                  
                  {/* Direct to single loader */}
                  <button
                    type="button"
                    onClick={() => onSelectResult(item.url)}
                    className="flex items-center gap-1 py-1.5 px-2 bg-zinc-900 border border-white/5 hover:bg-[#ff4e00]/10 hover:border-[#ff4e00]/20 text-zinc-300 hover:text-white text-[10px] font-bold rounded-lg transition-all cursor-pointer"
                    title="Load into single converter player"
                    id={`load_single_button_${idx}`}
                  >
                    <Music className="w-3 h-3 text-[#ff4e00]" /> Load
                  </button>

                  {/* Add direct to batch queue */}
                  {onAddToQueue && (
                    <button
                      type="button"
                      onClick={() => onAddToQueue(item.url, item.title, item.channel)}
                      className="flex items-center gap-1 py-1.5 px-2 bg-[#ff4e00] hover:bg-[#ff5a10] text-white text-[10px] font-bold rounded-lg transition-all cursor-pointer shadow-md"
                      title="Append directly to Transcoding batch list"
                      id={`append_queue_button_${idx}`}
                    >
                      <Plus className="w-3 h-3" /> Add Batch
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {results.length === 0 && !isLoading && (
        <div className="flex flex-col items-center justify-center py-6 text-zinc-700 select-none">
          <Youtube className="w-10 h-10 stroke-1 mb-2 text-zinc-800" />
          <span className="text-xs font-semibold text-zinc-600">Search is ready to index videos</span>
        </div>
      )}

    </div>
  );
}
