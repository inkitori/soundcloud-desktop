import { useEffect } from "react";
import { IconX } from "./Icons";

interface ModalProps {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  /** Right-aligned action row (mac convention: primary action last). */
  actions?: React.ReactNode;
  widthClass?: string;
}

/** App-wide dialog: dimmed backdrop, centered dark panel, Esc/backdrop to close. */
export function Modal({ title, onClose, children, actions, widthClass = "w-[26rem]" }: ModalProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`${widthClass} max-h-[80vh] overflow-y-auto rounded-xl border border-zinc-800 bg-zinc-900 p-5 shadow-2xl`}
      >
        <div className="mb-3 flex items-center justify-between gap-4">
          <h2 className="text-sm font-semibold text-zinc-100">{title}</h2>
          <button
            onClick={onClose}
            className="-mr-1 rounded p-1 text-zinc-500 hover:bg-white/10 hover:text-zinc-200"
            title="Close"
          >
            <IconX size={15} />
          </button>
        </div>
        <div className="text-sm text-zinc-300">{children}</div>
        {actions && <div className="mt-5 flex items-center justify-end gap-2">{actions}</div>}
      </div>
    </div>
  );
}

export function ModalButton({
  onClick,
  primary = false,
  disabled = false,
  children,
}: {
  onClick: () => void;
  primary?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center gap-2 rounded-md px-4 py-1.5 text-xs font-semibold disabled:opacity-40 ${
        primary
          ? "bg-orange-600 text-white hover:bg-orange-500"
          : "bg-white/10 text-zinc-200 hover:bg-white/15"
      }`}
    >
      {children}
    </button>
  );
}
