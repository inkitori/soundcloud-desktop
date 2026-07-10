import { useEffect, useLayoutEffect } from "react";
import { useLocation } from "react-router-dom";

/**
 * scrollTop per history entry (location.key), so Back/Forward return to where
 * the user was while fresh navigations start at the top. Pages that swap
 * content without navigating (search tabs) pass a `scope` to keep slots apart.
 */
const positions = new Map<string, number>();
const MAX_ENTRIES = 200;

export function useScrollRestore(
  ref: React.RefObject<HTMLElement | null>,
  /**
   * Flip true once the content that gives the container its height has
   * rendered (e.g. the list has rows). On Back, react-query usually serves
   * that from cache, so restoration is immediate; restoring earlier would
   * clamp to a still-empty container.
   */
  ready: boolean,
  scope = "",
) {
  const { key } = useLocation();
  const slot = scope ? `${key}:${scope}` : key;

  useLayoutEffect(() => {
    const el = ref.current;
    const saved = positions.get(slot);
    if (ready && el && saved != null) el.scrollTop = saved;
  }, [ref, slot, ready]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onScroll = () => {
      if (!positions.has(slot) && positions.size >= MAX_ENTRIES) {
        // Drop the oldest slot; back-stack entries that far gone are dead.
        const oldest = positions.keys().next().value;
        if (oldest !== undefined) positions.delete(oldest);
      }
      positions.set(slot, el.scrollTop);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [ref, slot]);
}
