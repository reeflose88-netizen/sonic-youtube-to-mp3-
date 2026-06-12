import React, { useEffect, useRef } from "react";

interface WaveformProps {
  isProcessing: boolean;
  isCompleted: boolean;
  speedMultiplier: number;
  currentTime?: number;
  duration?: number;
  onSeek?: (time: number) => void;
}

export default function AudioWaveform({
  isProcessing,
  isCompleted,
  speedMultiplier,
  currentTime = 0,
  duration = 0,
  onSeek
}: WaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const phaseRef = useRef(0);
  // Keep latest props accessible inside the animation loop without re-creating it
  const propsRef = useRef({ currentTime, duration });
  propsRef.current = { currentTime, duration };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animId: number;

    const render = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      if (canvas.width !== rect.width * dpr || canvas.height !== rect.height * dpr) {
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        ctx.scale(dpr, dpr);
      }

      const width = rect.width;
      const height = rect.height;

      ctx.clearRect(0, 0, width, height);

      const drawWave = (color: string, amplitude: number, frequency: number, phaseShift: number, lineWidth: number) => {
        ctx.beginPath();
        ctx.strokeStyle = color;
        ctx.lineWidth = lineWidth;
        ctx.lineCap = "round";

        for (let x = 0; x < width; x++) {
          const relativeX = x / width;
          const fade = Math.sin(relativeX * Math.PI);

          let y = height / 2;
          if (isProcessing) {
            y += Math.sin(relativeX * Math.PI * frequency + phaseRef.current + phaseShift) * amplitude * fade;
          } else if (isCompleted) {
            y += Math.sin(relativeX * Math.PI * frequency + phaseShift) * 4 * fade;
          } else {
            y += Math.sin(relativeX * Math.PI * 2 + phaseShift) * 2 * fade;
          }

          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      };

      if (isProcessing) {
        phaseRef.current += 0.08 * (1 + speedMultiplier / 10);
        drawWave("rgba(255, 78, 0, 0.15)", 40, 4, 0, 1.5);
        drawWave("rgba(255, 170, 0, 0.3)", 55, 6, Math.PI / 3, 2);
        drawWave("rgb(255, 78, 0)", 30, 8, Math.PI / 1.5, 3.5);
      } else if (isCompleted) {
        drawWave("rgba(0, 255, 157, 0.15)", 15, 6, 0, 1.5);
        drawWave("rgba(0, 255, 157, 0.4)", 20, 8, Math.PI / 3, 2);
        drawWave("rgb(0, 255, 157)", 10, 10, Math.PI / 1.5, 3);
      } else {
        drawWave("rgba(240, 240, 240, 0.05)", 10, 4, 0, 1);
        drawWave("rgba(240, 240, 240, 0.1)", 15, 6, Math.PI / 3, 1.5);
        drawWave("rgba(240, 240, 240, 0.15)", 8, 8, Math.PI / 1.5, 2);
      }

      // Playback cursor
      const { currentTime: ct, duration: dur } = propsRef.current;
      if (dur > 0 && ct >= 0) {
        const cursorX = (ct / dur) * width;

        // Played region overlay
        ctx.fillStyle = "rgba(255,255,255,0.04)";
        ctx.fillRect(0, 0, cursorX, height);

        // Cursor line
        ctx.beginPath();
        ctx.strokeStyle = "rgba(255,255,255,0.75)";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([3, 3]);
        ctx.moveTo(cursorX, 0);
        ctx.lineTo(cursorX, height);
        ctx.stroke();
        ctx.setLineDash([]);

        // Cursor handle dot
        ctx.beginPath();
        ctx.fillStyle = "#ffffff";
        ctx.arc(cursorX, height / 2, 4, 0, Math.PI * 2);
        ctx.fill();
      }

      animId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animId);
    };
  }, [isProcessing, isCompleted, speedMultiplier]);

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!onSeek || duration <= 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    onSeek(Math.max(0, Math.min(duration, ratio * duration)));
  };

  return (
    <div id="audio_waveform_container" className="relative w-full h-32 bg-[#121212] border border-white/5 rounded-xl overflow-hidden flex flex-col justify-end p-2 shadow-inner">
      <canvas
        ref={canvasRef}
        className={`w-full h-full absolute inset-0 ${duration > 0 && onSeek ? "cursor-pointer" : ""}`}
        onClick={handleClick}
        title={duration > 0 && onSeek ? "Click to seek" : undefined}
      />
      <div className="relative z-10 flex justify-between items-center w-full px-2 text-[10px] font-mono text-zinc-500 select-none">
        <span>{duration > 0 ? `${Math.floor(currentTime / 60)}:${String(Math.floor(currentTime % 60)).padStart(2, "0")}` : "0:00"}</span>
        <span className="animate-pulse text-[#ff4e00] font-semibold text-center">
          {isProcessing
            ? `TRANSCODING REALTIME • ${speedMultiplier}X SPEED`
            : isCompleted
            ? duration > 0 ? "CLICK WAVEFORM TO SEEK" : "COMPLETED"
            : "IDLE (WAITING FOR QUEUE)"}
        </span>
        <span>{duration > 0 ? `${Math.floor(duration / 60)}:${String(Math.floor(duration % 60)).padStart(2, "0")}` : "TRIM DURATION"}</span>
      </div>
    </div>
  );
}
