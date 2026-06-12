import { cancelLogin, startLogin, useLoginStore } from "../lib/login";
import { closeAuthModal, useModalStore } from "../lib/modals";
import { Spinner } from "./Icons";
import { Modal, ModalButton } from "./Modal";

/**
 * Interrupting auth dialogs. Both failure modes have the same fix — a fresh
 * browser session via the embedded sign-in window — so both lead there.
 */
export function AuthModals() {
  const kind = useModalStore((s) => s.auth);
  const waiting = useLoginStore((s) => s.waiting);

  if (!kind) return null;

  const copy =
    kind === "expired"
      ? {
          title: "Session expired",
          body: "Your SoundCloud session has expired. Sign in again to keep listening — your library, queue and downloads are untouched.",
          action: "Sign In Again",
        }
      : {
          title: "Action blocked by SoundCloud",
          body: "SoundCloud's bot protection wants a fresh browser session before it allows likes, reposts or playlist changes from the app. Signing in again refreshes it — usually it takes just a few seconds.",
          action: "Refresh Session",
        };

  const dismiss = () => {
    if (waiting) void cancelLogin();
    closeAuthModal();
  };

  return (
    <Modal title={copy.title} onClose={dismiss}>
      <p className="leading-relaxed text-zinc-400">{copy.body}</p>
      {waiting && (
        <p className="mt-3 flex items-center gap-2 text-xs text-zinc-500">
          <Spinner size={13} />
          Waiting for sign-in to finish — the window closes by itself.
        </p>
      )}
      <div className="mt-5 flex items-center justify-end gap-2">
        <ModalButton onClick={dismiss}>Not Now</ModalButton>
        <ModalButton primary disabled={waiting} onClick={() => void startLogin()}>
          {copy.action}
        </ModalButton>
      </div>
    </Modal>
  );
}
