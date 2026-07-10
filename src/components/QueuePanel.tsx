import { useState } from "react";
import { fmtDurationMs, trackArt, trackArtist, trackTitle } from "../lib/format";
import { usePlayerStore } from "../player/playerStore";
import { jumpTo, moveItem, removeAt, togglePanel, useQueueStore } from "../player/queueStore";
import { IconX } from "./Icons";

export function QueuePanel() {
  const open = useQueueStore((s) => s.panelOpen);
  const items = useQueueStore((s) => s.items);
  const index = useQueueStore((s) => s.index);
  const radioLoading = useQueueStore((s) => s.radioLoading);
  const playingId = usePlayerStore((s) => s.track?.id);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const endDrag = () => {
    setDragFrom(null);
    setDragOver(null);
  };

  if (!open) return null;

  return (
    <aside className="absolute bottom-20 right-0 top-0 z-20 flex w-80 flex-col border-l border-zinc-800 bg-zinc-900/95 backdrop-blur">
      <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
        <h2 className="text-sm font-semibold text-zinc-100">
          Queue <span className="font-normal text-zinc-500">({items.length})</span>
        </h2>
        <button onClick={togglePanel} className="rounded p-1 text-zinc-400 hover:bg-white/10">
          <IconX size={16} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {items.map((entry, i) => {
          const track = entry.track;
          const isCurrent = i === index && track.id === playingId;
          return (
            <div
              key={entry.key}
              draggable
              onDragStart={() => setDragFrom(i)}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(i);
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragFrom != null) moveItem(dragFrom, i);
                endDrag();
              }}
              onDragEnd={endDrag}
              className={`group flex cursor-grab items-center gap-2 rounded px-2 py-1.5 hover:bg-white/5 ${
                isCurrent ? "bg-white/5" : ""
              } ${i < index ? "opacity-50" : ""} ${
                dragOver === i && dragFrom !== i
                  ? dragFrom != null && dragFrom < i
                    ? "border-b border-orange-500"
                    : "border-t border-orange-500"
                  : ""
              } ${dragFrom === i ? "opacity-30" : ""}`}
            >
              <button
                onClick={() => jumpTo(i)}
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
              >
                <div className="h-8 w-8 shrink-0 overflow-hidden rounded bg-zinc-800">
                  {trackArt(track, 120) && (
                    <img
                      src={trackArt(track, 120)!}
                      alt=""
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                  )}
                </div>
                <div className="min-w-0">
                  <div
                    className={`truncate text-xs font-medium ${
                      isCurrent ? "text-orange-500" : "text-zinc-200"
                    }`}
                  >
                    {trackTitle(track)}
                  </div>
                  <div className="truncate text-[11px] text-zinc-500">{trackArtist(track)}</div>
                </div>
              </button>
              <span className="text-[11px] tabular-nums text-zinc-600">
                {fmtDurationMs(track.duration)}
              </span>
              {i !== index && (
                <button
                  onClick={() => removeAt(i)}
                  className="rounded p-1 text-zinc-500 opacity-0 hover:bg-white/10 group-hover:opacity-100"
                  title="Remove from queue"
                >
                  <IconX size={13} />
                </button>
              )}
            </div>
          );
        })}
        {radioLoading && (
          <div className="px-2 py-3 text-center text-xs text-zinc-500">finding related tracks…</div>
        )}
        {items.length === 0 && (
          <div className="px-2 py-8 text-center text-sm text-zinc-500">
            Play something to build a queue
          </div>
        )}
      </div>
    </aside>
  );
}
