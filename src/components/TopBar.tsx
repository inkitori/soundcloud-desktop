import { useLocation, useNavigate, useNavigationType } from "react-router-dom";
import { IconChevronLeft, IconChevronRight } from "./Icons";

// Deepest history index seen this session; react-router stamps each entry's
// position into history.state.idx, which tells us whether back/forward exist.
let maxHistoryIdx = 0;

/** macOS-style back/forward arrows pinned to the top-left of the content pane. */
export function TopBar() {
  const navigate = useNavigate();
  const navType = useNavigationType();
  useLocation(); // re-render on every navigation so disabled states stay fresh
  const idx = (window.history.state?.idx as number | undefined) ?? 0;
  // A push truncates any forward entries; a pop/replace just moves within them.
  maxHistoryIdx = navType === "PUSH" ? idx : Math.max(maxHistoryIdx, idx);

  const btn =
    "rounded-md p-1.5 text-zinc-400 hover:bg-white/10 hover:text-zinc-200 " +
    "disabled:opacity-25 disabled:hover:bg-transparent disabled:hover:text-zinc-400";

  return (
    <div className="flex h-11 shrink-0 items-center gap-1 px-3">
      <button onClick={() => navigate(-1)} disabled={idx <= 0} className={btn} title="Back">
        <IconChevronLeft size={18} />
      </button>
      <button
        onClick={() => navigate(1)}
        disabled={idx >= maxHistoryIdx}
        className={btn}
        title="Forward"
      >
        <IconChevronRight size={18} />
      </button>
    </div>
  );
}
