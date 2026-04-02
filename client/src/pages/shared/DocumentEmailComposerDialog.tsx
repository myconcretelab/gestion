import { createPortal } from "react-dom";
import { useEffect, useId, useMemo, useRef } from "react";
import { renderEmailBodyHtml } from "../../utils/documentEmail";

type DocumentEmailComposerDialogProps = {
  open: boolean;
  title: string;
  recipient: string;
  subject: string;
  body: string;
  sending: boolean;
  onClose: () => void;
  onRecipientChange: (value: string) => void;
  onSubjectChange: (value: string) => void;
  onBodyChange: (value: string) => void;
  onSubmit: () => void;
};

const APP_SCROLL_LOCK_CLASS = "app-scroll-locked";

const DocumentEmailComposerDialog = ({
  open,
  title,
  recipient,
  subject,
  body,
  sending,
  onClose,
  onRecipientChange,
  onSubjectChange,
  onBodyChange,
  onSubmit,
}: DocumentEmailComposerDialogProps) => {
  const titleId = useId();
  const subjectRef = useRef<HTMLInputElement | null>(null);
  const previewHtml = useMemo(() => renderEmailBodyHtml(body), [body]);

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.classList.add(APP_SCROLL_LOCK_CLASS);
    document.documentElement.classList.add(APP_SCROLL_LOCK_CLASS);
    document.body.style.overflow = "hidden";

    const frame = window.requestAnimationFrame(() => {
      subjectRef.current?.focus();
      subjectRef.current?.select();
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !sending) onClose();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("keydown", handleKeyDown);
      document.body.classList.remove(APP_SCROLL_LOCK_CLASS);
      document.documentElement.classList.remove(APP_SCROLL_LOCK_CLASS);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose, sending]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="email-composer-backdrop" role="presentation" onClick={() => !sending && onClose()}>
      <section
        className="email-composer-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="email-composer-dialog__header">
          <div>
            <p className="email-composer-dialog__eyebrow">Prévisualisation email</p>
            <h2 id={titleId}>{title}</h2>
          </div>
          <button type="button" className="email-composer-dialog__close" onClick={onClose} disabled={sending}>
            Fermer
          </button>
        </div>

        <div className="email-composer-dialog__body">
          <div className="email-composer-dialog__editor">
            <label className="field">
              Destinataire
              <input type="email" value={recipient} onChange={(event) => onRecipientChange(event.target.value)} />
            </label>
            <label className="field">
              Sujet
              <input ref={subjectRef} type="text" value={subject} onChange={(event) => onSubjectChange(event.target.value)} />
            </label>
            <label className="field">
              Corps du message
              <textarea
                className="email-composer-dialog__textarea"
                value={body}
                onChange={(event) => onBodyChange(event.target.value)}
                rows={18}
              />
            </label>
          </div>
          <aside className="email-composer-dialog__preview">
            <div className="email-composer-dialog__preview-card">
              <div className="email-composer-dialog__preview-head">
                <span>Aperçu HTML</span>
                <strong>{subject.trim() || "Sans sujet"}</strong>
              </div>
              <div className="email-composer-dialog__preview-meta">À: {recipient.trim() || "Destinataire à renseigner"}</div>
              <div
                className="email-composer-dialog__preview-body"
                dangerouslySetInnerHTML={{ __html: previewHtml || "<p>Le corps du message est vide.</p>" }}
              />
            </div>
          </aside>
        </div>

        <div className="email-composer-dialog__footer">
          <button type="button" className="secondary" onClick={onClose} disabled={sending}>
            Annuler
          </button>
          <button type="button" onClick={onSubmit} disabled={sending || !recipient.trim() || !subject.trim() || !body.trim()}>
            {sending ? "Envoi..." : "Envoyer"}
          </button>
        </div>
      </section>
    </div>,
    document.body
  );
};

export default DocumentEmailComposerDialog;
