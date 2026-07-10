import { useEffect, useRef, useState } from "react";

/**
 * Keyboard selection for a track list: up/down move the highlight, Enter
 * plays it, Escape clears it. Pages mount one list at a time, so the
 * listener is window-level; it stands down while the user is typing or a
 * dialog/menu is open.
 */
export function useListSelection(
  count: number,
  onActivate: (index: number) => void,
  scrollTo?: (index: number) => void,
) {
  const [selected, setSelected] = useState<number | null>(null);
  // The window listener binds once and reads everything through this ref.
  const state = useRef({ count, onActivate, scrollTo, selected });
  state.current = { count, onActivate, scrollTo, selected };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const { count, onActivate, scrollTo, selected } = state.current;
      if (count === 0) return;
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      const target = e.target as HTMLElement | null;
      const typing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable;
      if (typing || document.querySelector('[role="dialog"], [role="menu"]')) return;

      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const next =
          e.key === "ArrowDown"
            ? Math.min((selected ?? -1) + 1, count - 1)
            : Math.max((selected ?? count) - 1, 0);
        setSelected(next);
        scrollTo?.(next);
      } else if (e.key === "Enter" && selected != null && selected < count) {
        onActivate(selected);
      } else if (e.key === "Escape") {
        setSelected(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return [selected, setSelected] as const;
}
