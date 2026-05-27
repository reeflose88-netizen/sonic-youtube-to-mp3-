import { useEffect, useRef } from "react";

interface WaveformProps {
  isProcessing: boolean;
  isCompleted: boolean;
  speedMultiplier: number; // e.g., 5x, 12x
}

export default function AudioWaveform({ isProcessing, isCompleted, speedMultiplier }: WaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const phaseRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animId: number;

    const render = () => {
      // Handle resizing if container changed
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
          // Fade wave edges so it looks beautiful
          const fade = Math.sin(relativeX * Math.PI);
          
          let y = (height / 2);
          if (isProcessing) {
            y += Math.sin(relativeX * Math.PI * frequency + phaseRef.current + phaseShift) * amplitude * fade;
          } else if (isCompleted) {
            // Static flat beautiful wave
            y += Math.sin(relativeX * Math.PI * frequency + phaseShift) * 4 * fade;
          } else {
            // Idle tiny heartbeat wave
            y += Math.sin(relativeX * Math.PI * 2 + phaseShift) * 2 * fade;
          }

          if (x === 0) {
            ctx.moveTo(x, y);
          } else {
            ctx.lineTo(x, y);
          }
        }
        ctx.stroke();
      };

      if (isProcessing) {
        phaseRef.current += 0.08 * (1 + speedMultiplier / 10);
        // Draw 3 layers of glowing orange design waves
        drawWave("rgba(255, 78, 0, 0.15)", 40, 4, 0, 1.5);
        drawWave("rgba(255, 170, 0, 0.3)", 55, 6, Math.PI / 3, 2);
        drawWave("rgb(255, 78, 0)", 30, 8, Math.PI / 1.5, 3.5);
      } else if (isCompleted) {
        // Complete static emerald neon wave
        drawWave("rgba(0, 255, 157, 0.15)", 15, 6, 0, 1.5);
        drawWave("rgba(0, 255, 157, 0.4)", 20, 8, Math.PI / 3, 2);
        drawWave("rgb(0, 255, 157)", 10, 10, Math.PI / 1.5, 3);
      } else {
        // Idle calm zinc wave
        drawWave("rgba(240, 240, 240, 0.05)", 10, 4, 0, 1);
        drawWave("rgba(240, 240, 240, 0.1)", 15, 6, Math.PI / 3, 1.5);
        drawWave("rgba(240, 240, 240, 0.15)", 8, 8, Math.PI / 1.5, 2);
      }

      animId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animId);
    };
  }, [isProcessing, isCompleted, speedMultiplier]);

  return (
    <div id="audio_waveform_container" className="relative w-full h-32 bg-[#121212] border border-white/5 rounded-xl overflow-hidden flex flex-col justify-end p-2 shadow-inner">
      <canvas ref={canvasRef} className="w-full h-full absolute inset-0" />
      <div className="relative z-10 flex justify-between items-center w-full px-2 text-[10px] font-mono text-zinc-500 select-none">
        <span>0.00s</span>
        <span className="animate-pulse text-[#ff4e00] font-semibold text-center">
          {isProcessing ? `TRANSCODING REALTIME • ${speedMultiplier}X SPEED` : isCompleted ? "COMPLETED" : "IDLE (WAITING FOR QUEUE)"}
        </span>
        <span>TRIM DURATION</span>
      </div>
    </div>
  );
}
