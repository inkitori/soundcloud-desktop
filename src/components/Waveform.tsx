import { useEffect, useRef } from "react";
import { useWaveform } from "../api/queries";
import { fmtTime } from "../lib/format";
import { audioController } from "../player/audioController";
import { usePlayerStore } from "../player/playerStore";

const PLAYED = "#ff5500";
const UNPLAYED = "#3f3f46";

/**
 * Canvas waveform scrubber. The canvas is always mounted (drawing a flat
 * baseline until the waveform JSON arrives) so there's no slider↔canvas swap
 * — that swap was a visible flicker on every track change.
 */
export function Waveform() {
  const track = usePlayerStore((s) => s.track);
  const position = usePlayerStore((s) => s.position);
  const duration = usePlayerStore((s) => s.duration);
  const { data: waveform } = useWaveform(track);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Redraw on data/position/duration changes.
  useEffect(() => {
    drawWaveform(canvasRef.current, containerRef.current, waveform?.samples, waveform?.height, {
      position,
      duration,
    });
  }, [waveform, position, duration]);

  // Redraw on resize, set up once.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(() => {
      const { position: p, duration: d } = usePlayerStore.getState();
      drawWaveform(canvasRef.current, container, waveform?.samples, waveform?.height, {
        position: p,
        duration: d,
      });
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [waveform]);

  const seekFromPointer = (clientX: number) => {
    const container = containerRef.current;
    if (!container || duration <= 0) return;
    const rect = container.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    audioController.seek(frac * duration);
  };

  return (
    <div className="flex w-full items-center gap-2">
      <span className="w-10 shrink-0 text-right text-[11px] tabular-nums text-zinc-400">
        {fmtTime(position)}
      </span>
      <div
        ref={containerRef}
        className="h-9 flex-1 cursor-pointer"
        onPointerDown={(e) => {
          seekFromPointer(e.clientX);
          const onMove = (ev: PointerEvent) => seekFromPointer(ev.clientX);
          const onUp = () => {
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
          };
          window.addEventListener("pointermove", onMove);
          window.addEventListener("pointerup", onUp);
        }}
      >
        <canvas ref={canvasRef} className="h-full w-full" />
      </div>
      <span className="w-10 shrink-0 text-[11px] tabular-nums text-zinc-400">
        {fmtTime(duration)}
      </span>
    </div>
  );
}

function drawWaveform(
  canvas: HTMLCanvasElement | null,
  container: HTMLDivElement | null,
  samples: number[] | undefined,
  sampleHeight: number | undefined,
  { position, duration }: { position: number; duration: number },
) {
  if (!canvas || !container) return;
  const dpr = window.devicePixelRatio || 1;
  const width = container.clientWidth;
  const height = container.clientHeight;
  if (width === 0) return;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, width, height);

  const barWidth = 2;
  const gap = 1;
  const bars = Math.floor(width / (barWidth + gap));
  const progress = duration > 0 ? position / duration : 0;
  const playedBars = progress * bars;

  for (let i = 0; i < bars; i++) {
    let barHeight: number;
    if (samples && samples.length > 0) {
      const maxSample = sampleHeight || Math.max(...samples, 1);
      const value = samples[Math.floor((i / bars) * samples.length)] / maxSample;
      barHeight = Math.max(2, value * height * 0.95);
    } else {
      barHeight = 3; // flat baseline until the waveform loads
    }
    const x = i * (barWidth + gap);
    const y = (height - barHeight) / 2;
    ctx.fillStyle = i < playedBars ? PLAYED : UNPLAYED;
    ctx.fillRect(x, y, barWidth, barHeight);
  }
}
