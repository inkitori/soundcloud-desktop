import { Link } from "react-router-dom";
import { trackArt, trackArtist, trackTitle } from "../lib/format";
import { toggleLikeTrack, useLikedStore } from "../lib/stores";
import { audioController } from "../player/audioController";
import { usePlayerStore } from "../player/playerStore";
import {
  next,
  prev,
  togglePanel,
  toggleRadio,
  toggleRepeat,
  useQueueStore,
} from "../player/queueStore";
import {
  IconHeart,
  IconHeartFilled,
  IconNext,
  IconPause,
  IconPlay,
  IconPrev,
  IconQueue,
  IconRadio,
  IconRepeat,
  IconVolume,
  Spinner,
} from "./Icons";
import { Waveform } from "./Waveform";

export function PlayerBar() {
  const track = usePlayerStore((s) => s.track);
  const status = usePlayerStore((s) => s.status);
  const errorMsg = usePlayerStore((s) => s.error);
  const volume = usePlayerStore((s) => s.volume);
  const snipped = usePlayerStore((s) => s.snipped);
  const sourceKind = usePlayerStore((s) => s.sourceKind);
  const repeat = useQueueStore((s) => s.repeat);
  const radio = useQueueStore((s) => s.radio);
  const panelOpen = useQueueStore((s) => s.panelOpen);
  const liked = useLikedStore((s) => (track ? s.ids.has(track.id) : false));

  const art = track ? trackArt(track, 200) : null;

  return (
    <footer className="flex h-20 shrink-0 items-center gap-4 border-t border-zinc-800 bg-zinc-900/95 px-4">
      <div className="flex w-64 min-w-0 items-center gap-3">
        {track ? (
          <>
            <div className="h-12 w-12 shrink-0 overflow-hidden rounded bg-zinc-800">
              {art && <img src={art} alt="" className="h-full w-full object-cover" />}
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-zinc-100">{trackTitle(track)}</div>
              <div className="truncate text-xs text-zinc-400">
                {track.user ? (
                  <Link to={`/artist/${track.user.id}`} className="hover:underline">
                    {trackArtist(track)}
                  </Link>
                ) : (
                  trackArtist(track)
                )}
              </div>
              <div className="flex gap-2 text-[10px] uppercase tracking-wide text-zinc-500">
                {sourceKind === "cached" && <span className="text-emerald-400">offline</span>}
                {snipped && <span className="text-amber-400">30s preview</span>}
              </div>
            </div>
            <button
              onClick={() => void toggleLikeTrack(track)}
              className={`ml-auto shrink-0 rounded p-2 hover:bg-white/10 ${
                liked ? "text-orange-500" : "text-zinc-400"
              }`}
              title={liked ? "Unlike" : "Like"}
            >
              {liked ? <IconHeartFilled size={18} /> : <IconHeart size={18} />}
            </button>
          </>
        ) : (
          <span className="text-sm text-zinc-500">Nothing playing</span>
        )}
      </div>

      <div className="flex items-center gap-1">
        <button
          onClick={prev}
          className="rounded-full p-2 text-zinc-300 hover:bg-white/10"
          title="Previous"
        >
          <IconPrev size={20} />
        </button>
        <button
          onClick={() => audioController.toggle()}
          className="rounded-full bg-zinc-100 p-2.5 text-zinc-900 hover:bg-white disabled:opacity-50"
          disabled={!track}
          title="Play / pause (space)"
        >
          {status === "loading" ? (
            <Spinner size={22} />
          ) : status === "playing" ? (
            <IconPause size={22} />
          ) : (
            <IconPlay size={22} />
          )}
        </button>
        <button
          onClick={() => next()}
          className="rounded-full p-2 text-zinc-300 hover:bg-white/10"
          title="Next"
        >
          <IconNext size={20} />
        </button>
      </div>

      <div className="min-w-0 flex-1">
        {status === "error" && errorMsg ? (
          <div className="truncate px-2 text-center text-xs text-amber-400" title={errorMsg}>
            {errorMsg}
          </div>
        ) : (
          <Waveform />
        )}
      </div>

      <div className="flex items-center gap-1">
        <button
          onClick={toggleRepeat}
          className={`relative rounded p-2 hover:bg-white/10 ${
            repeat !== "off" ? "text-orange-500" : "text-zinc-400"
          }`}
          title={`Repeat: ${repeat}`}
        >
          <IconRepeat size={17} />
          {repeat === "one" && (
            <span className="absolute right-0.5 top-0.5 text-[9px] font-bold">1</span>
          )}
        </button>
        <button
          onClick={toggleRadio}
          className={`rounded p-2 hover:bg-white/10 ${radio ? "text-orange-500" : "text-zinc-400"}`}
          title={radio ? "Station autoplay on" : "Station autoplay off"}
        >
          <IconRadio size={17} />
        </button>
        <button
          onClick={togglePanel}
          className={`rounded p-2 hover:bg-white/10 ${panelOpen ? "text-orange-500" : "text-zinc-400"}`}
          title="Queue"
        >
          <IconQueue size={17} />
        </button>
        <div className="ml-1 flex w-28 shrink-0 items-center gap-2 text-zinc-400">
          <IconVolume size={16} className="shrink-0" />
          {/* range inputs have a ~129px intrinsic width; min-w-0 lets it
              shrink into the 112px container instead of overflowing it */}
          <input
            type="range"
            min={0}
            max={1}
            step={0.02}
            value={volume}
            onChange={(e) => audioController.setVolume(Number(e.target.value))}
            className="h-1 w-full min-w-0 flex-1"
          />
        </div>
      </div>
    </footer>
  );
}
