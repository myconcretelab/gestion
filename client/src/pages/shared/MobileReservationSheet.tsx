import { createPortal } from "react-dom";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { formatEuro } from "../../utils/format";
import type {
  QuickReservationDraft,
  QuickReservationErrorField,
  QuickReservationSmsSnippet,
  QuickReservationDateSummary,
} from "./quickReservation";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

type QuickReservationOptionPreview = {
  total: number;
  byKey: {
    draps: number;
    linge_toilette: number;
  };
};

type MobileReservationSheetProps = {
  open: boolean;
  mode: "create" | "edit";
  saving: boolean;
  saved: boolean;
  title: string;
  error: string | null;
  errorField: QuickReservationErrorField;
  savedMessage?: string | null;
  draft: QuickReservationDraft | null;
  dateSummary: QuickReservationDateSummary;
  computedTotal: number | null;
  adultOptions: number[];
  nightlySuggestions: number[];
  sourceOptions: readonly string[];
  optionCountMax: number;
  optionPreview: QuickReservationOptionPreview;
  gitePricing: {
    menage: number;
    draps: number;
    serviettes: number;
  };
  smsSnippets: QuickReservationSmsSnippet[];
  smsSelection: string[];
  smsText: string;
  smsHref: string | null;
  primaryActionLabel: string;
  primaryActionDisabled: boolean;
  onRequestClose: () => void;
  onPrimaryAction: () => void;
  onFieldChange: (field: keyof QuickReservationDraft, value: string | number | boolean) => void;
  onSmsSelectionChange: (snippetId: string, checked: boolean) => void;
  formatShortDate: (value: string) => string;
};

const APP_SCROLL_LOCK_CLASS = "app-scroll-locked";
const OPTION_FIELDS = new Set<QuickReservationErrorField>(["option_menage", "option_draps", "option_serviettes"]);

const queryFocusableElements = (node: HTMLElement) =>
  [...node.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)].filter(
    (element) => !element.hasAttribute("hidden") && element.getAttribute("aria-hidden") !== "true"
  );

const lockDocumentScroll = () => {
  const body = document.body;
  const root = document.documentElement;
  const hadBodyLock = body.classList.contains(APP_SCROLL_LOCK_CLASS);
  const hadRootLock = root.classList.contains(APP_SCROLL_LOCK_CLASS);

  body.classList.add(APP_SCROLL_LOCK_CLASS);
  root.classList.add(APP_SCROLL_LOCK_CLASS);

  return () => {
    if (!hadBodyLock) body.classList.remove(APP_SCROLL_LOCK_CLASS);
    if (!hadRootLock) root.classList.remove(APP_SCROLL_LOCK_CLASS);
  };
};

const setAppBackgroundHidden = () => {
  const appNode = document.querySelector(".app") as (HTMLElement & { inert?: boolean }) | null;
  if (!appNode) return () => undefined;

  const previousAriaHidden = appNode.getAttribute("aria-hidden");
  const hadAriaHidden = appNode.hasAttribute("aria-hidden");
  const previousInert = Boolean(appNode.inert);

  appNode.setAttribute("aria-hidden", "true");
  appNode.inert = true;

  return () => {
    if (hadAriaHidden && previousAriaHidden !== null) {
      appNode.setAttribute("aria-hidden", previousAriaHidden);
    } else {
      appNode.removeAttribute("aria-hidden");
    }
    appNode.inert = previousInert;
  };
};

const isInteractiveField = (target: EventTarget | null): target is HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement =>
  target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;

const ensureFieldVisible = (container: HTMLElement | null, target: HTMLElement | null, behavior: ScrollBehavior = "auto") => {
  if (!container || !target) return;

  const containerRect = container.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  const topThreshold = containerRect.top + 24;
  const bottomThreshold = containerRect.bottom - 24;

  if (targetRect.top >= topThreshold && targetRect.bottom <= bottomThreshold) return;

  const targetTop = targetRect.top - containerRect.top + container.scrollTop;
  const desiredTop = Math.max(0, targetTop - Math.max(28, Math.round(container.clientHeight * 0.22)));
  container.scrollTo({ top: desiredTop, behavior });
};

const MobileReservationSheet = ({
  open,
  mode,
  saving,
  saved,
  title,
  error,
  errorField,
  savedMessage,
  draft,
  dateSummary,
  computedTotal,
  adultOptions,
  nightlySuggestions,
  sourceOptions,
  optionCountMax,
  optionPreview,
  gitePricing,
  smsSnippets,
  smsSelection,
  smsText,
  smsHref,
  primaryActionLabel,
  primaryActionDisabled,
  onRequestClose,
  onPrimaryAction,
  onFieldChange,
  onSmsSelectionChange,
  formatShortDate,
}: MobileReservationSheetProps) => {
  const titleId = useId();
  const dialogRef = useRef<HTMLElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const [optionsExpanded, setOptionsExpanded] = useState(false);
  const [smsExpanded, setSmsExpanded] = useState(false);
  const [smsPreviewExpanded, setSmsPreviewExpanded] = useState(false);

  const canRender = open && draft;
  const formattedTotal = useMemo(
    () => (computedTotal !== null ? formatEuro(computedTotal) : "A calculer"),
    [computedTotal]
  );
  const hasLongSmsPreview = useMemo(() => smsText.length > 260 || smsText.split("\n").length > 6, [smsText]);

  useEffect(() => {
    if (!open) return;
    setOptionsExpanded(false);
    setSmsExpanded(false);
    setSmsPreviewExpanded(false);
  }, [open, mode]);

  useEffect(() => {
    if (!canRender || !errorField || !OPTION_FIELDS.has(errorField)) return;
    setOptionsExpanded(true);
  }, [canRender, errorField]);

  useEffect(() => {
    if (!canRender) return;

    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const restoreScroll = lockDocumentScroll();
    const restoreBackground = setAppBackgroundHidden();
    const focusDialogFrame = window.requestAnimationFrame(() => {
      dialogRef.current?.focus({ preventScroll: true });
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      const dialogNode = dialogRef.current;
      if (!dialogNode) return;

      if (event.key === "Escape") {
        if (!saving) onRequestClose();
        return;
      }

      if (event.key !== "Tab") return;

      const focusable = queryFocusableElements(dialogNode);
      if (focusable.length === 0) {
        event.preventDefault();
        dialogNode.focus({ preventScroll: true });
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const activeElement = document.activeElement;

      if (event.shiftKey && activeElement === first) {
        event.preventDefault();
        last.focus({ preventScroll: true });
        return;
      }

      if (!event.shiftKey && activeElement === last) {
        event.preventDefault();
        first.focus({ preventScroll: true });
      }
    };

    const handleFocusIn = (event: FocusEvent) => {
      const dialogNode = dialogRef.current;
      if (!dialogNode) return;

      if (!dialogNode.contains(event.target as Node)) {
        const focusable = queryFocusableElements(dialogNode);
        (focusable[0] ?? dialogNode).focus({ preventScroll: true });
        return;
      }

      if (!isInteractiveField(event.target)) return;
      window.requestAnimationFrame(() => {
        ensureFieldVisible(bodyRef.current, event.target, "auto");
      });
    };

    const handleViewportChange = () => {
      const activeElement = document.activeElement;
      if (!isInteractiveField(activeElement)) return;

      window.requestAnimationFrame(() => {
        ensureFieldVisible(bodyRef.current, activeElement, "auto");
      });
    };

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("focusin", handleFocusIn);
    window.visualViewport?.addEventListener("resize", handleViewportChange);
    window.visualViewport?.addEventListener("scroll", handleViewportChange);

    return () => {
      window.cancelAnimationFrame(focusDialogFrame);
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("focusin", handleFocusIn);
      window.visualViewport?.removeEventListener("resize", handleViewportChange);
      window.visualViewport?.removeEventListener("scroll", handleViewportChange);
      restoreBackground();
      restoreScroll();
      openerRef.current?.focus?.({ preventScroll: true });
    };
  }, [canRender, onRequestClose, saving]);

  useEffect(() => {
    if (!canRender || !errorField) return;

    const target = bodyRef.current?.querySelector<HTMLElement>(`[data-reservation-field="${errorField}"]`) ?? null;
    if (!target) return;

    const timeoutId = window.setTimeout(() => {
      target.focus({ preventScroll: true });
      ensureFieldVisible(bodyRef.current, target);
    }, 30);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [canRender, errorField, optionsExpanded]);

  if (!canRender || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="calendar-quick-create-sheet"
      role="presentation"
      onClick={() => {
        if (saving) return;
        onRequestClose();
      }}
    >
      <section
        ref={dialogRef}
        className="calendar-quick-create-sheet__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="calendar-quick-create-sheet__top">
          <div className="calendar-quick-create-sheet__handle" aria-hidden="true" />
          <div className="calendar-quick-create-sheet__header">
            <div>
              <p className="calendar-quick-create-sheet__eyebrow">{title || "Réservation"}</p>
              <h2 id={titleId}>{mode === "edit" ? "Réservation rapide" : "Nouvelle réservation"}</h2>
            </div>
            <button
              type="button"
              className="calendar-quick-create-sheet__close"
              aria-label={mode === "edit" ? "Fermer l'édition rapide" : "Fermer la création rapide"}
              onClick={onRequestClose}
              disabled={saving}
            >
              ×
            </button>
          </div>

          <div className="calendar-quick-create-sheet__summary">
            <div className="calendar-quick-create-sheet__summary-main">
              <strong className="calendar-quick-create-sheet__summary-dates">
                {dateSummary.startIso && dateSummary.exitIso
                  ? `${formatShortDate(dateSummary.startIso)} → ${formatShortDate(dateSummary.exitIso)}`
                  : "Dates à renseigner"}
              </strong>
              <span className="calendar-quick-create-sheet__summary-pill">
                {dateSummary.nights} nuit{dateSummary.nights > 1 ? "s" : ""}
              </span>
              {savedMessage ? <span className="calendar-quick-create-sheet__saved-pill">{savedMessage}</span> : null}
            </div>
            <div className="calendar-quick-create-sheet__summary-total">
              <strong>{formattedTotal}</strong>
            </div>
          </div>
        </div>

        <div ref={bodyRef} className="calendar-quick-create-sheet__body">
          {error ? <p className="calendar-quick-create-sheet__error">{error}</p> : null}

          <div className="calendar-quick-create-sheet__form">
            <section className="calendar-quick-create-sheet__section">
              <p className="calendar-quick-create-sheet__section-title">1 - Infos séjour</p>

              <label className="field field--small calendar-quick-create-sheet__host-field">
                Hôte
                <input
                  data-reservation-field="hote_nom"
                  type="text"
                  value={draft.hote_nom}
                  placeholder="Nom du voyageur"
                  onChange={(event) => onFieldChange("hote_nom", event.target.value)}
                />
              </label>

              <label className="field field--small calendar-quick-create-sheet__host-field">
                Téléphone
                <input
                  data-reservation-field="telephone"
                  type="tel"
                  inputMode="tel"
                  value={draft.telephone}
                  placeholder="06 12 34 56 78"
                  onChange={(event) => onFieldChange("telephone", event.target.value)}
                />
              </label>

              <div className="calendar-quick-create-sheet__dates-band">
                <label className="field field--small calendar-quick-create-sheet__host-field">
                  Entrée
                  <input
                    data-reservation-field="date_entree"
                    type="date"
                    value={draft.date_entree}
                    onChange={(event) => onFieldChange("date_entree", event.target.value)}
                  />
                </label>

                <label className="field field--small calendar-quick-create-sheet__host-field">
                  Sortie
                  <input
                    data-reservation-field="date_sortie"
                    type="date"
                    value={draft.date_sortie}
                    onChange={(event) => onFieldChange("date_sortie", event.target.value)}
                  />
                </label>
              </div>

              <div className="calendar-quick-create-sheet__stats-grid">
                <label className="field field--small calendar-quick-create-sheet__compact-field calendar-quick-create-sheet__compact-field--adults">
                  <span className="calendar-quick-create-sheet__compact-label">Adultes</span>
                  <select
                    data-reservation-field="nb_adultes"
                    value={draft.nb_adultes}
                    onChange={(event) => onFieldChange("nb_adultes", Number(event.target.value))}
                  >
                    {adultOptions.map((count) => (
                      <option key={count} value={count}>
                        {count}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="field field--small calendar-quick-create-sheet__compact-field calendar-quick-create-sheet__compact-field--nightly">
                  <span className="calendar-quick-create-sheet__compact-label">Prix / nuit</span>
                  <input
                    data-reservation-field="prix_par_nuit"
                    type="number"
                    min={0}
                    step={1}
                    inputMode="decimal"
                    value={draft.prix_par_nuit}
                    onChange={(event) => onFieldChange("prix_par_nuit", event.target.value)}
                  />
                </label>

                {nightlySuggestions.length > 0 ? (
                  <div className="calendar-quick-create-sheet__prices">
                    <span className="calendar-quick-create-sheet__compact-label">Tarifs du gîte</span>
                    <div className="calendar-quick-create-sheet__price-list">
                      {nightlySuggestions.map((price) => {
                        const isActive = Number(draft.prix_par_nuit) === price;
                        return (
                          <button
                            key={price}
                            type="button"
                            className={`calendar-quick-create-sheet__price-chip${
                              isActive ? " calendar-quick-create-sheet__price-chip--active" : ""
                            }`}
                            onClick={() => onFieldChange("prix_par_nuit", String(price))}
                          >
                            {formatEuro(price)}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <div className="calendar-quick-create-sheet__prices calendar-quick-create-sheet__prices--empty">
                    <span className="calendar-quick-create-sheet__compact-label">Tarifs du gîte</span>
                    <strong>Manuel</strong>
                  </div>
                )}
              </div>

              <label className="field field--small calendar-quick-create-sheet__host-field">
                Source
                <select
                  data-reservation-field="source_paiement"
                  value={draft.source_paiement}
                  onChange={(event) => onFieldChange("source_paiement", event.target.value)}
                >
                  {sourceOptions.map((source) => (
                    <option key={source} value={source}>
                      {source}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field field--small calendar-quick-create-sheet__note-field">
                Note
                <textarea
                  data-reservation-field="commentaire"
                  rows={2}
                  value={draft.commentaire}
                  placeholder="Optionnel"
                  onChange={(event) => onFieldChange("commentaire", event.target.value)}
                />
              </label>

            </section>

            <section className="calendar-quick-create-sheet__section">
              <button
                type="button"
                className="calendar-quick-create-sheet__section-toggle"
                onClick={() => setOptionsExpanded((current) => !current)}
                aria-expanded={optionsExpanded}
              >
                <span>2 - Options</span>
                <span>{optionsExpanded ? "Masquer" : "Afficher"}</span>
              </button>

              {optionsExpanded ? (
                <div className="calendar-quick-create-sheet__section-body">
                  <div className="calendar-quick-create-sheet__options-card">
                    <label className="calendar-quick-create-sheet__toggle-row">
                      <div>
                        <span className="calendar-quick-create-sheet__toggle-title">Option ménage</span>
                        <span className="calendar-quick-create-sheet__toggle-meta">{formatEuro(gitePricing.menage)}</span>
                      </div>
                      <span className="calendar-quick-create-sheet__switch-control">
                        <input
                          data-reservation-field="option_menage"
                          type="checkbox"
                          checked={draft.option_menage}
                          onChange={(event) => onFieldChange("option_menage", event.target.checked)}
                        />
                        <span aria-hidden="true" />
                      </span>
                    </label>

                    <label className="calendar-quick-create-sheet__range-field">
                      <div className="calendar-quick-create-sheet__range-head">
                        <span className="calendar-quick-create-sheet__toggle-title">Draps</span>
                        <span className="calendar-quick-create-sheet__range-value">
                          {draft.option_draps} · {formatEuro(optionPreview.byKey.draps)}
                        </span>
                      </div>
                      <input
                        data-reservation-field="option_draps"
                        type="range"
                        min={0}
                        max={optionCountMax}
                        step={1}
                        value={draft.option_draps}
                        onChange={(event) => onFieldChange("option_draps", Number(event.target.value))}
                      />
                      <span className="calendar-quick-create-sheet__range-meta">{formatEuro(gitePricing.draps)} / lit</span>
                    </label>

                    <label className="calendar-quick-create-sheet__range-field">
                      <div className="calendar-quick-create-sheet__range-head">
                        <span className="calendar-quick-create-sheet__toggle-title">Serviettes</span>
                        <span className="calendar-quick-create-sheet__range-value">
                          {draft.option_serviettes} · {formatEuro(optionPreview.byKey.linge_toilette)}
                        </span>
                      </div>
                      <input
                        data-reservation-field="option_serviettes"
                        type="range"
                        min={0}
                        max={optionCountMax}
                        step={1}
                        value={draft.option_serviettes}
                        onChange={(event) => onFieldChange("option_serviettes", Number(event.target.value))}
                      />
                      <span className="calendar-quick-create-sheet__range-meta">
                        {formatEuro(gitePricing.serviettes)} / personne
                      </span>
                    </label>
                  </div>
                </div>
              ) : null}
            </section>

            <section className="calendar-quick-create-sheet__section">
              <button
                type="button"
                className="calendar-quick-create-sheet__section-toggle"
                onClick={() => setSmsExpanded((current) => !current)}
                aria-expanded={smsExpanded}
              >
                <span>3 - SMS de confirmation</span>
                <span>{smsExpanded ? "Masquer" : "Afficher"}</span>
              </button>

              {smsExpanded ? (
                <div className="calendar-quick-create-sheet__section-body">
                  <div className="calendar-quick-create-sheet__switches">
                    {smsSnippets.map((snippet) => {
                      const checked = smsSelection.includes(snippet.id);
                      return (
                        <label key={snippet.id} className="calendar-quick-create-sheet__switch">
                          <span>{snippet.title}</span>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(event) => onSmsSelectionChange(snippet.id, event.target.checked)}
                          />
                        </label>
                      );
                    })}
                  </div>

                  <div
                    className={`calendar-quick-create-sheet__sms-preview${
                      !smsPreviewExpanded && hasLongSmsPreview ? " calendar-quick-create-sheet__sms-preview--collapsed" : ""
                    }`}
                  >
                    <pre>{smsText}</pre>
                  </div>

                  {hasLongSmsPreview ? (
                    <button
                      type="button"
                      className="calendar-quick-create-sheet__preview-toggle"
                      onClick={() => setSmsPreviewExpanded((current) => !current)}
                    >
                      {smsPreviewExpanded ? "Réduire l'aperçu" : "Voir tout le SMS"}
                    </button>
                  ) : null}

                  <div className="calendar-quick-create-sheet__sms-actions">
                    <button
                      type="button"
                      className="calendar-quick-create-sheet__copy"
                      onClick={() => {
                        if (!navigator.clipboard?.writeText) return;
                        void navigator.clipboard.writeText(smsText);
                      }}
                      aria-label="Copier le SMS"
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path
                          d="M9 9.5A1.5 1.5 0 0 1 10.5 8h8A1.5 1.5 0 0 1 20 9.5v10a1.5 1.5 0 0 1-1.5 1.5h-8A1.5 1.5 0 0 1 9 19.5v-10Z"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                        <path
                          d="M6 16H5.5A1.5 1.5 0 0 1 4 14.5v-10A1.5 1.5 0 0 1 5.5 3h8A1.5 1.5 0 0 1 15 4.5V5"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                      <span>Copier</span>
                    </button>
                    {saved ? (
                      <span className="calendar-quick-create-sheet__sms-hint">
                        {smsHref ? "Le bouton principal ouvre la messagerie SMS." : "Ajoute un numéro pour envoyer le SMS."}
                      </span>
                    ) : (
                      <span className="calendar-quick-create-sheet__sms-hint">Le SMS s'ouvre après l'enregistrement.</span>
                    )}
                  </div>
                </div>
              ) : null}
            </section>
          </div>
        </div>

        <div className="calendar-quick-create-sheet__footer">
          <button
            type="button"
            className={`calendar-quick-create-sheet__submit${saved ? " calendar-quick-create-sheet__submit--sms" : ""}`}
            onClick={onPrimaryAction}
            disabled={primaryActionDisabled}
          >
            {primaryActionLabel}
          </button>
        </div>
      </section>
    </div>,
    document.body
  );
};

export default MobileReservationSheet;
