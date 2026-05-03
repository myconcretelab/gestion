import { createPortal } from "react-dom";
import { useEffect, useId, useRef } from "react";

type SignedDocumentLightboxProps = {
  open: boolean;
  title: string;
  url: string;
  filename?: string | null;
  mimeType?: string | null;
  onClose: () => void;
};

const APP_SCROLL_LOCK_CLASS = "app-scroll-locked";

const SignedDocumentLightbox = ({
  open,
  title,
  url,
  filename,
  mimeType,
  onClose,
}: SignedDocumentLightboxProps) => {
  const titleId = useId();
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const previousActiveElementRef = useRef<HTMLElement | null>(null);
  const isImage = String(mimeType ?? "").toLowerCase().startsWith("image/");

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    previousActiveElementRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.classList.add(APP_SCROLL_LOCK_CLASS);
    document.documentElement.classList.add(APP_SCROLL_LOCK_CLASS);
    document.body.style.overflow = "hidden";

    const frame = window.requestAnimationFrame(() => {
      closeButtonRef.current?.focus();
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("keydown", handleKeyDown);
      document.body.classList.remove(APP_SCROLL_LOCK_CLASS);
      document.documentElement.classList.remove(APP_SCROLL_LOCK_CLASS);
      document.body.style.overflow = previousOverflow;
      previousActiveElementRef.current?.focus();
      previousActiveElementRef.current = null;
    };
  }, [onClose, open]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="signed-document-lightbox-backdrop" role="presentation" onClick={onClose}>
      <section
        className="signed-document-lightbox"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="signed-document-lightbox__header">
          <div>
            <p className="signed-document-lightbox__eyebrow">Document signe</p>
            <h2 id={titleId}>{title}</h2>
            {filename ? <div className="signed-document-lightbox__filename">{filename}</div> : null}
          </div>
          <div className="signed-document-lightbox__actions">
            <a href={url} target="_blank" rel="noreferrer" className="secondary">
              Ouvrir dans un onglet
            </a>
            <button ref={closeButtonRef} type="button" className="secondary" onClick={onClose}>
              Fermer
            </button>
          </div>
        </div>

        <div className="signed-document-lightbox__body">
          {isImage ? (
            <div className="signed-document-lightbox__image-shell">
              <img
                className="signed-document-lightbox__image"
                src={url}
                alt={filename ? `Document signe ${filename}` : "Document signe"}
              />
            </div>
          ) : (
            <iframe
              className="signed-document-lightbox__frame"
              title={title}
              src={url}
            />
          )}
        </div>
      </section>
    </div>,
    document.body
  );
};

export default SignedDocumentLightbox;
