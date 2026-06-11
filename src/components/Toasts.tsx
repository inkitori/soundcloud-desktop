import { useToastStore } from "../lib/toast";

export function Toasts() {
  const toasts = useToastStore((s) => s.toasts);
  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none absolute bottom-4 left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`max-w-md truncate rounded-full px-4 py-2 text-xs font-medium shadow-lg ${
            t.kind === "error"
              ? "bg-red-900/95 text-red-100"
              : "bg-zinc-800/95 text-zinc-100"
          }`}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}
