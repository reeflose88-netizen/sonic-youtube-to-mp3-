import { ID3Tags } from "../types";
import { Tag, Sparkles, Disc, User, FolderHeart, Calendar, TagIcon } from "lucide-react";

interface ID3TagEditorProps {
  tags: ID3Tags;
  thumbnailUrl: string;
  isOptimizing: boolean;
  onTagsChange: (tags: ID3Tags) => void;
  onTriggerOptimize: () => void;
  hasVideoLoaded: boolean;
}

export default function ID3TagEditor({
  tags,
  thumbnailUrl,
  isOptimizing,
  onTagsChange,
  onTriggerOptimize,
  hasVideoLoaded
}: ID3TagEditorProps) {

  const handleFieldChange = (key: keyof ID3Tags, value: string) => {
    onTagsChange({
      ...tags,
      [key]: value
    });
  };

  return (
    <div id="id3_tag_editor" className="bg-[#121212] rounded-2xl border border-white/5 p-6 shadow-2xl flex flex-col gap-6">
      
      <div className="flex justify-between items-center border-b border-white/5 pb-3">
        <div className="flex items-center gap-2">
          <Tag className="w-5 h-5 text-[#ff4e00]" />
          <h3 className="font-heading font-semibold tracking-tight text-white text-lg">
            ID3 Metadata Tags & Cover Art
          </h3>
        </div>

        {hasVideoLoaded && (
          <button
            type="button"
            onClick={onTriggerOptimize}
            disabled={isOptimizing}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-[#ff4e00]/10 hover:bg-[#ff4e00]/20 text-[#ff8c00] text-xs font-semibold rounded-xl border border-[#ff4e00]/20 transition-all cursor-pointer disabled:opacity-60"
          >
            <Sparkles className={`w-3.5 h-3.5 ${isOptimizing ? "animate-spin text-[#ff8c00]" : "text-[#ff4e00]"}`} />
            {isOptimizing ? "Optimizing tags..." : "Gemini AI Optimize"}
          </button>
        )}
      </div>

      <div className="flex flex-col md:flex-row gap-6">
        
        {/* Cover Art Preview */}
        <div className="w-full md:w-44 flex flex-col gap-2 shrink-0">
          <span className="text-[10px] uppercase tracking-wider font-bold text-zinc-500 font-mono">
            Embedded Cover Art
          </span>
          <div className="relative aspect-square w-full md:w-44 rounded-2xl overflow-hidden border border-white/5 bg-[#080808] shadow-inner group">
            {thumbnailUrl ? (
              <img
                src={thumbnailUrl}
                alt="Audio Cover Thumbnail"
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
              />
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center p-4 text-center text-zinc-700">
                <Disc className="w-12 h-12 stroke-1 animate-spin-pulse mb-1" />
                <span className="text-[10px] font-semibold text-zinc-500">Waiting for Stream...</span>
              </div>
            )}
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-2 text-[10px] text-zinc-300 flex justify-between font-mono">
              <span>HD COVER</span>
              <span className="text-[#ff4e00]">RGB HIFI</span>
            </div>
          </div>
          <span className="text-[10px] text-center text-zinc-500 font-sans italic">
            Automated covers extract directly from source video canvas stream.
          </span>
        </div>

        {/* Form Fields */}
        <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-4">
          
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <label className="text-xs font-semibold text-zinc-400 flex items-center gap-1">
              <Disc className="w-3.5 h-3.5 text-zinc-500" /> Audio Track Title
            </label>
            <input
              type="text"
              value={tags.title}
              onChange={(e) => handleFieldChange("title", e.target.value)}
              placeholder="e.g., Midnight City"
              className="w-full px-3.5 py-2 bg-[#080808] border border-white/10 hover:border-white/20 focus:border-[#ff4e00] rounded-xl text-sm font-medium text-white focus:outline-hidden transition-all shadow-inner placeholder:text-zinc-600"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-zinc-400 flex items-center gap-1">
              <User className="w-3.5 h-3.5 text-zinc-500" /> Artist / Composer
            </label>
            <input
              type="text"
              value={tags.artist}
              onChange={(e) => handleFieldChange("artist", e.target.value)}
              placeholder="e.g., M83"
              className="w-full px-3.5 py-2 bg-[#080808] border border-white/10 hover:border-white/20 focus:border-[#ff4e00] rounded-xl text-sm font-medium text-white focus:outline-hidden transition-all shadow-inner placeholder:text-zinc-600"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-zinc-400 flex items-center gap-1">
              <FolderHeart className="w-3.5 h-3.5 text-zinc-500" /> Album Name
            </label>
            <input
              type="text"
              value={tags.album}
              onChange={(e) => handleFieldChange("album", e.target.value)}
              placeholder="e.g., Hurry Up, We're Dreaming"
              className="w-full px-3.5 py-2 bg-[#080808] border border-white/10 hover:border-white/20 focus:border-[#ff4e00] rounded-xl text-sm font-medium text-white focus:outline-hidden transition-all shadow-inner placeholder:text-zinc-600"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-zinc-400 flex items-center gap-1">
              <TagIcon className="w-3.5 h-3.5 text-zinc-500" /> Genre Category
            </label>
            <input
              type="text"
              value={tags.genre}
              onChange={(e) => handleFieldChange("genre", e.target.value)}
              placeholder="e.g., Electronic / Dream Pop"
              className="w-full px-3.5 py-2 bg-[#080808] border border-white/10 hover:border-white/20 focus:border-[#ff4e00] rounded-xl text-sm font-medium text-white focus:outline-hidden transition-all shadow-inner placeholder:text-zinc-600"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-zinc-400 flex items-center gap-1">
              <Calendar className="w-3.5 h-3.5 text-zinc-500" /> Release Year
            </label>
            <input
              type="text"
              value={tags.year}
              onChange={(e) => handleFieldChange("year", e.target.value)}
              placeholder="e.g., 2011"
              maxLength={4}
              className="w-full px-3.5 py-2 bg-[#080808] border border-white/10 hover:border-white/20 focus:border-[#ff4e00] rounded-xl text-sm font-medium text-white focus:outline-hidden transition-all shadow-inner placeholder:text-zinc-600"
            />
          </div>

        </div>

      </div>

    </div>
  );
}
