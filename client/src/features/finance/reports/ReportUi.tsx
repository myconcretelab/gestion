import { useEffect, useId, useRef, type ReactNode } from "react";
import { type ReportKind } from "./reportModel";

type IconName =
  | "refresh"
  | "arrow"
  | "back"
  | "check"
  | "clock"
  | "document"
  | "download"
  | "edit"
  | "filter"
  | "info"
  | "plus"
  | "search"
  | "settings"
  | "star"
  | "close"
  | "undo"
  | "home";
const paths: Record<IconName, ReactNode> = {
  refresh: (
    <path d="M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 11-1l3 6M4 12l3 6a7 7 0 0 0 11-1" />
  ),
  arrow: (
    <>
      <path d="M5 12h14m-6-6 6 6-6 6" />
    </>
  ),
  back: <path d="M19 12H5m6-6-6 6 6 6" />,
  check: <path d="m5 12 4 4L19 6" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  document: (
    <>
      <path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z" />
      <path d="M14 3v5h5M9 12h6m-6 4h6" />
    </>
  ),
  download: (
    <>
      <path d="M12 3v12m-4-4 4 4 4-4M5 16v4h14v-4" />
    </>
  ),
  edit: (
    <>
      <path d="m15 4 5 5M4 20l5-1L20 8a2 2 0 0 0-5-5L4 15z" />
    </>
  ),
  filter: (
    <>
      <path d="M4 7h16M7 12h10m-7 5h4" />
      <circle cx="8" cy="7" r="1" />
      <circle cx="15" cy="12" r="1" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6m0-10v1" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m16 16 5 5" />
    </>
  ),
  settings: (
    <>
      <path d="M4 7h16M4 17h16" />
      <circle cx="9" cy="7" r="3" />
      <circle cx="15" cy="17" r="3" />
    </>
  ),
  star: (
    <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3l-5.5 2.9 1-6.2L3 9.6l6.2-.9z" />
  ),
  close: <path d="m6 6 12 12M6 18 18 6" />,
  undo: (
    <>
      <path d="M4 10h9a6 6 0 0 1 0 12M4 10l5-5m-5 5 5 5" />
    </>
  ),
  home: (
    <>
      <path d="m3 10 9-7 9 7M5 9v12h14V9M9 21v-8h6v8" />
    </>
  ),
};
export function ReportIcon({
  name,
  className = "",
}: {
  name: IconName;
  className?: string;
}) {
  return (
    <svg
      className={`rp-icon ${className}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}
export function ReportKindIcon({ kind }: { kind: ReportKind }) {
  return (
    <span className="rp-kind-icon">
      <ReportIcon
        name={
          kind === "tourist"
            ? "home"
            : kind === "custom"
              ? "settings"
              : "document"
        }
      />
    </span>
  );
}
export function ReportBadge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "primary" | "attention" | "complete";
}) {
  return (
    <span className={`rp-badge rp-badge--${tone}`}>
      <span aria-hidden="true" />
      {children}
    </span>
  );
}
export function ReportDialog({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current!;
    const previous =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    dialog.showModal();
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      dialog.close();
      document.body.style.overflow = originalOverflow;
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`rp-dialog${wide ? " rp-dialog--wide" : ""}`}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const rect = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < rect.left ||
          event.clientX > rect.right ||
          event.clientY < rect.top ||
          event.clientY > rect.bottom
        )
          onClose();
      }}
    >
      <header className="rp-dialog__header">
        <h2 id={titleId}>{title}</h2>
        <button
          className="rp-icon-button"
          type="button"
          aria-label="Fermer"
          onClick={onClose}
        >
          <ReportIcon name="close" />
        </button>
      </header>
      {children}
    </dialog>
  );
}

export function ReportEmpty({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="rp-empty">
      <ReportIcon name="document" />
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
