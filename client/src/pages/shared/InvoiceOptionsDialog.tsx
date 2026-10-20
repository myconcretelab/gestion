import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

export default function InvoiceOptionsDialog({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    dialog?.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      dialog?.close();
      document.body.style.overflow = previousOverflow;
      if (previousFocus instanceof HTMLElement) previousFocus.focus();
    };
  }, [open]);

  if (!open) return null;
  return createPortal(
    <dialog
      ref={dialogRef}
      className="invoice-options-dialog"
      aria-labelledby="invoice-options-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="invoice-options-dialog__header">
        <h2 id="invoice-options-title">Prestations & options</h2>
        <button type="button" className="secondary" onClick={onClose} autoFocus>
          Fermer
        </button>
      </div>
      {children}
      <div className="invoice-options-dialog__footer">
        <button type="button" onClick={onClose}>
          Terminé
        </button>
      </div>
    </dialog>,
    document.body,
  );
}
