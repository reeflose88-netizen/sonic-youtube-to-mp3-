import { useEffect, useRef } from "react";
import { Terminal, Copy, Check } from "lucide-react";
import { useState } from "react";

interface ConsoleOutputProps {
  logs: string[];
}

export default function ConsoleOutput({ logs }: ConsoleOutputProps) {
  const endRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  const copyLogs = () => {
    if (logs.length === 0) return;
    navigator.clipboard.writeText(logs.join("\n"));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div id="console_output_container" className="bg-[#0c0c0c] rounded-2xl border border-white/5 shadow-2xl overflow-hidden flex flex-col h-64">
      
      {/* Console Header */}
      <div className="flex justify-between items-center bg-white/5 px-4 py-2.5 border-b border-white/5 select-none">
        <div className="flex items-center gap-2">
          <div className="flex gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-[#ff4e00]/80"></span>
            <span className="w-2.5 h-2.5 rounded-full bg-zinc-700"></span>
            <span className="w-2.5 h-2.5 rounded-full bg-zinc-800"></span>
          </div>
          <span className="text-[11px] font-mono tracking-wider font-bold text-zinc-400 flex items-center gap-1.5 ml-2">
            <Terminal className="w-3.5 h-3.5 text-[#ff4e00]" /> TRANSCODER_CORE_LOGS
          </span>
        </div>

        {logs.length > 0 && (
          <button
            type="button"
            onClick={copyLogs}
            className="text-[10px] font-mono text-zinc-400 hover:text-white flex items-center gap-1 bg-zinc-900 hover:bg-zinc-800 transition-all rounded px-2 py-0.5 cursor-pointer"
          >
            {copied ? (
              <>
                <Check className="w-3 h-3 text-emerald-400" /> COPIED
              </>
            ) : (
              <>
                <Copy className="w-3 h-3" /> COPY LOGS
              </>
            )}
          </button>
        )}
      </div>

      {/* Console Lines */}
      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-1.5 font-mono text-xs text-zinc-300 antialiased selection:bg-[#ff4e00]/30">
        {logs.map((log, idx) => (
          <div key={idx} className="flex gap-3 leading-relaxed hover:bg-white/5 px-1 py-0.5 rounded transition-all">
            <span className="text-zinc-600 select-none w-5 text-right font-mono text-[10px]">
              {idx + 1}
            </span>
            <span className="text-zinc-500 font-mono select-none">
              [{new Date().toLocaleTimeString('en-US', { hour12: false })}]
            </span>
            <span className={`${
              log.includes("ERROR") ? "text-red-400 font-bold" :
              log.includes("COMPLETED") || log.includes("SUCCESS") ? "text-[#00ff9d] font-bold" :
              log.includes("Optimizer") || log.includes("Gemini") ? "text-[#ffaa00] font-semibold" :
              "text-zinc-300"
            }`}>
              {log}
            </span>
          </div>
        ))}
        {logs.length === 0 && (
          <div className="flex-1 flex flex-col items-center justify-center text-zinc-700 text-center p-4">
            <Terminal className="w-8 h-8 stroke-1 mb-1.5 text-zinc-800" />
            <span className="font-mono text-[11px]">DEDICATED CONVERTER CONSOLE</span>
            <span className="font-sans text-[10.5px] italic text-zinc-500 mt-0.5">Submit a YouTube stream query to launch core processes.</span>
          </div>
        )}
        <div ref={endRef} />
      </div>

    </div>
  );
}
