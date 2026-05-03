import { createPortal } from "react-dom";
import { useEffect, useId, useMemo, useRef, useState, type ChangeEvent } from "react";
import { apiFetch, buildApiUrl, isApiError } from "../../utils/api";
import { formatDate, formatEuro } from "../../utils/format";
import { computeReservationOptionsPreview, mergeReservationOptions } from "../../utils/reservationOptions";
import type { Contrat, ContratOptions, Reservation } from "../../utils/types";
import ReservationOptionsEditor from "./ReservationOptionsEditor";
import SignedDocumentLightbox from "./SignedDocumentLightbox";
import { toDateInputValue } from "./rentalForm";

type ContractReturnDrawerProps = {
  open: boolean;
  contract: Contrat | null;
  onClose: () => void;
  onUpdated: (updated: Contrat) => void;
};

const APP_SCROLL_LOCK_CLASS = "app-scroll-locked";

const RESERVATION_PAYMENT_SOURCES = [
  "Abritel",
  "Airbnb",
  "Chèque",
  "Espèces",
  "HomeExchange",
  "Virement",
  "A définir",
  "Gites de France",
] as const;

const ARRHES_PAYMENT_MODES = ["Chèque", "Virement", "Espèces", "A définir"] as const;
const SIGNED_DOCUMENT_MAX_BYTES = 12 * 1024 * 1024;
const SIGNED_DOCUMENT_ALLOWED_MIME_TYPES = new Map<string, string>([
  ["application/pdf", ".pdf"],
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/webp", ".webp"],
]);
const SIGNED_DOCUMENT_ALLOWED_EXTENSIONS = new Map<string, string>([
  [".pdf", "application/pdf"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".png", "image/png"],
  [".webp", "image/webp"],
]);

const todayInputValue = () => new Date().toISOString().slice(0, 10);

const formatFileSize = (size: number) => {
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} Ko`;
  return `${(size / (1024 * 1024)).toFixed(1)} Mo`;
};

const readFileAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error("Lecture du fichier impossible."));
        return;
      }
      resolve(reader.result);
    };
    reader.onerror = () => reject(new Error("Lecture du fichier impossible."));
    reader.readAsDataURL(file);
  });

const resolveSignedDocumentMimeType = (file: File) => {
  const fileType = file.type.trim().toLowerCase();
  if (SIGNED_DOCUMENT_ALLOWED_MIME_TYPES.has(fileType)) {
    return fileType;
  }
  const dotIndex = file.name.lastIndexOf(".");
  const extension = dotIndex >= 0 ? file.name.slice(dotIndex).toLowerCase() : "";
  return SIGNED_DOCUMENT_ALLOWED_EXTENSIONS.get(extension) ?? null;
};

type PendingSignedDocument = {
  filename: string;
  mimeType: string;
  data: string;
  size: number;
};

const CloseIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="m6 6 12 12M18 6 6 18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);

const ContractReturnDrawer = ({ open, contract, onClose, onUpdated }: ContractReturnDrawerProps) => {
  const titleId = useId();
  const firstFieldRef = useRef<HTMLInputElement | null>(null);
  const [reservation, setReservation] = useState<Reservation | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [linkingReservation, setLinkingReservation] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preparingSignedDocument, setPreparingSignedDocument] = useState(false);
  const [pendingSignedDocument, setPendingSignedDocument] = useState<PendingSignedDocument | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [signedDocumentLightboxOpen, setSignedDocumentLightboxOpen] = useState(false);
  const [contractReceived, setContractReceived] = useState(false);
  const [receptionDate, setReceptionDate] = useState("");
  const [arrhesPaid, setArrhesPaid] = useState(false);
  const [arrhesDate, setArrhesDate] = useState("");
  const [arrhesPaymentMode, setArrhesPaymentMode] = useState("");
  const [adultCount, setAdultCount] = useState(1);
  const [childrenCount, setChildrenCount] = useState(0);
  const [reservationPaymentSource, setReservationPaymentSource] = useState("");
  const [internalComment, setInternalComment] = useState("");
  const [options, setOptions] = useState<ContratOptions>(mergeReservationOptions());

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.classList.add(APP_SCROLL_LOCK_CLASS);
    document.documentElement.classList.add(APP_SCROLL_LOCK_CLASS);
    document.body.style.overflow = "hidden";

    const frame = window.requestAnimationFrame(() => {
      firstFieldRef.current?.focus();
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving && !preparingSignedDocument && !signedDocumentLightboxOpen) onClose();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("keydown", handleKeyDown);
      document.body.classList.remove(APP_SCROLL_LOCK_CLASS);
      document.documentElement.classList.remove(APP_SCROLL_LOCK_CLASS);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose, open, preparingSignedDocument, saving, signedDocumentLightboxOpen]);

  useEffect(() => {
    if (!open || !contract) return;
    let active = true;
    const controller = new AbortController();

    setLoading(Boolean(contract.reservation_id));
    setSaving(false);
    setLinkingReservation(false);
    setError(null);
    setPreparingSignedDocument(false);
    setPendingSignedDocument(null);
    setFileInputKey((current) => current + 1);
    setSignedDocumentLightboxOpen(false);
    setReservation(null);
    setContractReceived(contract.statut_reception_contrat === "recu");
    setReceptionDate(
      toDateInputValue(contract.date_reception_contrat) ||
        (contract.statut_reception_contrat === "recu" ? todayInputValue() : "")
    );
    setArrhesPaid(contract.statut_paiement_arrhes === "recu");
    setArrhesDate(
      toDateInputValue(contract.date_paiement_arrhes) ||
        (contract.statut_paiement_arrhes === "recu" ? todayInputValue() : "")
    );
    setArrhesPaymentMode(contract.mode_paiement_arrhes ?? "");
    setAdultCount(Math.max(1, Number(contract.nb_adultes ?? 1)));
    setChildrenCount(Math.max(0, Number(contract.nb_enfants_2_17 ?? 0)));
    setReservationPaymentSource("");
    setInternalComment(contract.commentaire_interne ?? "");
    setOptions(mergeReservationOptions(contract.options));

    if (!contract.reservation_id) {
      setLoading(false);
      return () => {
        active = false;
        controller.abort();
      };
    }

    apiFetch<Reservation>(`/reservations/${contract.reservation_id}`, { signal: controller.signal })
      .then((data) => {
        if (!active) return;
        setReservation(data);
        setReservationPaymentSource(data.source_paiement ?? "");
        setOptions(mergeReservationOptions(data.options ?? contract.options));
      })
      .catch((err) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Impossible de charger la réservation liée.");
      })
      .finally(() => {
        if (!active) return;
        setLoading(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [contract, open]);

  const optionPreview = useMemo(
    () =>
      computeReservationOptionsPreview(options, {
        nights: Math.max(0, Number(reservation?.nb_nuits ?? contract?.nb_nuits ?? 0)),
        gite: contract?.gite ?? null,
      }),
    [contract?.gite, contract?.nb_nuits, options, reservation?.nb_nuits]
  );

  const handleSignedDocumentSelection = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      setPendingSignedDocument(null);
      return;
    }

    const mimeType = resolveSignedDocumentMimeType(file);
    if (!mimeType) {
      setPendingSignedDocument(null);
      setFileInputKey((current) => current + 1);
      setError("Format non pris en charge. Utilisez un PDF, JPG, PNG ou WEBP.");
      return;
    }

    if (file.size > SIGNED_DOCUMENT_MAX_BYTES) {
      setPendingSignedDocument(null);
      setFileInputKey((current) => current + 1);
      setError(`Le document signé dépasse ${Math.round(SIGNED_DOCUMENT_MAX_BYTES / (1024 * 1024))} Mo.`);
      return;
    }

    setPreparingSignedDocument(true);
    try {
      const dataUrl = await readFileAsDataUrl(file);
      const separatorIndex = dataUrl.indexOf(",");
      const data = separatorIndex >= 0 ? dataUrl.slice(separatorIndex + 1) : dataUrl;
      setPendingSignedDocument({
        filename: file.name,
        mimeType,
        data,
        size: file.size,
      });
      setError(null);
    } catch (err) {
      setPendingSignedDocument(null);
      setFileInputKey((current) => current + 1);
      setError(err instanceof Error ? err.message : "Impossible de préparer le document signé.");
    } finally {
      setPreparingSignedDocument(false);
    }
  };

  const submit = async () => {
    if (!contract) return;
    setSaving(true);
    try {
      const trackingUpdated = await apiFetch<Contrat>(`/contracts/${contract.id}/return-processing`, {
        method: "PATCH",
        json: {
          nb_adultes: adultCount,
          nb_enfants_2_17: childrenCount,
          statut_reception_contrat: contractReceived ? "recu" : "non_recu",
          date_reception_contrat: contractReceived ? receptionDate || null : null,
          statut_paiement_arrhes: arrhesPaid ? "recu" : "non_recu",
          date_paiement_arrhes: arrhesPaid ? arrhesDate || null : null,
          mode_paiement_arrhes: arrhesPaid ? arrhesPaymentMode || null : null,
          commentaire_interne: internalComment,
          reservation: {
            source_paiement: reservationPaymentSource || null,
            options,
          },
        },
      });
      let updated = trackingUpdated;
      if (pendingSignedDocument) {
        updated = await apiFetch<Contrat>(`/contracts/${contract.id}/signed-document`, {
          method: "POST",
          json: pendingSignedDocument,
        });
      }
      setError(null);
      setPendingSignedDocument(null);
      setFileInputKey((current) => current + 1);
      onUpdated(updated);
      onClose();
    } catch (err) {
      setError(
        isApiError(err)
          ? err.message
          : err instanceof Error
            ? err.message
            : "Impossible d'enregistrer le retour du contrat."
      );
    } finally {
      setSaving(false);
    }
  };

  const createAndLinkReservation = async () => {
    if (!contract) return;
    setLinkingReservation(true);
    try {
      const updated = await apiFetch<Contrat>(`/contracts/${contract.id}/create-linked-reservation`, {
        method: "POST",
      });
      setError(null);
      onUpdated(updated);
    } catch (err) {
      setError(
        isApiError(err)
          ? err.message
          : err instanceof Error
            ? err.message
            : "Impossible de créer la réservation liée."
      );
    } finally {
      setLinkingReservation(false);
    }
  };

  if (!open || !contract || typeof document === "undefined") return null;

  const hasReservation = Boolean(contract.reservation_id);
  const signedDocumentUrl = contract.signed_document_path
    ? buildApiUrl(
        `/contracts/${contract.id}/signed-document?v=${encodeURIComponent(
          String(contract.signed_document_uploaded_at ?? contract.date_derniere_modif ?? "")
        )}`
      )
    : null;

  return createPortal(
    <>
      <SignedDocumentLightbox
        open={signedDocumentLightboxOpen && Boolean(signedDocumentUrl)}
        title={`Contrat signe ${contract.numero_contrat}`}
        url={signedDocumentUrl ?? ""}
        filename={contract.signed_document_filename ?? null}
        mimeType={contract.signed_document_mime_type ?? null}
        onClose={() => setSignedDocumentLightboxOpen(false)}
      />
      <div
        className="contract-return-drawer-backdrop"
        role="presentation"
        onClick={() => !saving && !preparingSignedDocument && onClose()}
      >
        <section
          className="contract-return-drawer"
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          onClick={(event) => event.stopPropagation()}
        >
        <div className="contract-return-drawer__header">
          <div>
            <p className="contract-return-drawer__eyebrow">Traitement du retour</p>
            <h2 id={titleId}>Contrat {contract.numero_contrat}</h2>
            <div className="contract-return-drawer__summary">
              <span>{contract.locataire_nom}</span>
              <span>{contract.gite?.nom ?? "Gîte non renseigné"}</span>
              <span>
                {formatDate(contract.date_debut)} - {formatDate(contract.date_fin)}
              </span>
            </div>
          </div>
          <button
            type="button"
            className="contract-return-drawer__close"
            onClick={onClose}
            disabled={saving || linkingReservation || preparingSignedDocument}
            aria-label="Fermer"
          >
            <CloseIcon />
          </button>
        </div>

        <div className="contract-return-drawer__body">
          <p className="contract-return-drawer__intro">
            Le contrat envoyé reste figé. Les modifications ci-dessous mettent à jour le suivi du retour et la réservation liée.
          </p>
          {error ? <div className="note note--error">{error}</div> : null}

          <section className="contract-return-drawer__section">
            <div className="contract-return-drawer__section-head">
              <strong>Retour courrier</strong>
            </div>
            <div className="contract-return-drawer__grid">
              <div className="field contract-return-drawer__toggle-field">
                <span>Contrat reçu</span>
                <label className="switch">
                  <input
                    ref={firstFieldRef}
                    type="checkbox"
                    checked={contractReceived}
                    onChange={(event) => {
                      const checked = event.target.checked;
                      setContractReceived(checked);
                      if (checked && !receptionDate) setReceptionDate(todayInputValue());
                    }}
                  />
                  <span className="slider" />
                </label>
              </div>

              <label className="field">
                Date de réception
                <input
                  type="date"
                  value={receptionDate}
                  disabled={!contractReceived}
                  onChange={(event) => setReceptionDate(event.target.value)}
                />
              </label>

              <div className="field contract-return-drawer__toggle-field">
                <span>Arrhes reçues</span>
                <label className="switch">
                  <input
                    type="checkbox"
                    checked={arrhesPaid}
                    onChange={(event) => {
                      const checked = event.target.checked;
                      setArrhesPaid(checked);
                      if (checked && !arrhesDate) setArrhesDate(todayInputValue());
                    }}
                  />
                  <span className="slider" />
                </label>
              </div>

              <label className="field">
                Date de paiement
                <input
                  type="date"
                  value={arrhesDate}
                  disabled={!arrhesPaid}
                  onChange={(event) => setArrhesDate(event.target.value)}
                />
              </label>

              <label className="field">
                Mode de paiement des arrhes
                <select
                  value={arrhesPaymentMode}
                  disabled={!arrhesPaid}
                  onChange={(event) => setArrhesPaymentMode(event.target.value)}
                >
                  <option value="">À renseigner</option>
                  {ARRHES_PAYMENT_MODES.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </label>

              <div className="contract-return-drawer__amount-card">
                <span>Montant des arrhes prévues</span>
                <strong>{formatEuro(contract.arrhes_montant)}</strong>
              </div>
            </div>
          </section>

          <section className="contract-return-drawer__section">
            <div className="contract-return-drawer__section-head">
              <strong>Réservation actuelle</strong>
              <span>
                {hasReservation
                  ? "Les options ci-dessous alimentent le calcul de la réservation."
                  : "Aucune réservation liée à ce contrat."}
              </span>
            </div>

            <div className="contract-return-drawer__grid contract-return-drawer__grid--compact">
              <label className="field">
                Adultes
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={adultCount}
                  onChange={(event) => setAdultCount(Math.max(1, Number(event.target.value) || 1))}
                />
              </label>
              <label className="field">
                Enfants 2-17 ans
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={childrenCount}
                  onChange={(event) => setChildrenCount(Math.max(0, Number(event.target.value) || 0))}
                />
              </label>
            </div>

            {hasReservation ? (
              <>
                {loading ? <div className="note">Chargement de la réservation liée...</div> : null}
                <div className="contract-return-drawer__grid contract-return-drawer__grid--compact">
                  <label className="field">
                    Source de paiement réservation
                    <select
                      value={reservationPaymentSource}
                      onChange={(event) => setReservationPaymentSource(event.target.value)}
                    >
                      <option value="">À renseigner</option>
                      {RESERVATION_PAYMENT_SOURCES.map((item) => (
                        <option key={item} value={item}>
                          {item}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="contract-return-drawer__amount-card contract-return-drawer__amount-card--soft">
                    <span>Options recalculées</span>
                    <strong>{formatEuro(optionPreview.total)}</strong>
                    <small>{optionPreview.label || "Aucune option sélectionnée"}</small>
                  </div>
                </div>

                <ReservationOptionsEditor
                  options={options}
                  preview={optionPreview}
                  gite={contract.gite ?? null}
                  guestCount={adultCount}
                  layout="compact"
                  onChange={setOptions}
                />
              </>
            ) : (
              <div className="contract-return-drawer__empty-state">
                <p>Aucune réservation liée pour ce contrat.</p>
                <button
                  type="button"
                  className="table-action table-action--neutral contract-return-drawer__link-btn"
                  onClick={createAndLinkReservation}
                  disabled={saving || linkingReservation}
                >
                  {linkingReservation ? "Création..." : "Créer et lier la réservation"}
                </button>
              </div>
            )}
          </section>

          <section className="contract-return-drawer__section">
            <div className="contract-return-drawer__section-head">
              <strong>Document signé</strong>
              <span>PDF ou scan photo conservé avec le contrat.</span>
            </div>
            <div className="contract-return-drawer__signed-document">
              {signedDocumentUrl ? (
                <div className="note note--success">
                  Document enregistré :
                  {" "}
                  <button
                    type="button"
                    className="contract-return-drawer__signed-document-link"
                    onClick={() => setSignedDocumentLightboxOpen(true)}
                  >
                    {contract.signed_document_filename ?? "Consulter"}
                  </button>
                  {contract.signed_document_uploaded_at ? ` (${formatDate(contract.signed_document_uploaded_at)})` : ""}
                  {typeof contract.signed_document_size === "number"
                    ? ` - ${formatFileSize(contract.signed_document_size)}`
                    : ""}
                </div>
              ) : (
                <div className="note">Aucun document signé enregistré pour le moment.</div>
              )}

              <label className="field">
                Ajouter ou remplacer le document signé
                <input
                  key={fileInputKey}
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp"
                  disabled={saving || preparingSignedDocument}
                  onChange={(event) => void handleSignedDocumentSelection(event)}
                />
              </label>

              {pendingSignedDocument ? (
                <div className="contract-return-drawer__signed-document-pending">
                  <span>
                    Nouveau fichier prêt : {pendingSignedDocument.filename} ({formatFileSize(pendingSignedDocument.size)})
                  </span>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => {
                      setPendingSignedDocument(null);
                      setFileInputKey((current) => current + 1);
                    }}
                    disabled={saving || preparingSignedDocument}
                  >
                    Retirer
                  </button>
                </div>
              ) : null}

              {preparingSignedDocument ? <div className="note">Préparation du document…</div> : null}
            </div>
          </section>

          <section className="contract-return-drawer__section">
            <div className="contract-return-drawer__section-head">
              <strong>Notes internes</strong>
              <span>Visible seulement en gestion.</span>
            </div>
            <label className="field">
              Notes
              <textarea
                className="contract-return-drawer__textarea"
                value={internalComment}
                onChange={(event) => setInternalComment(event.target.value)}
                rows={5}
              />
            </label>
          </section>
        </div>

        <div className="contract-return-drawer__footer">
          <button
            type="button"
            className="secondary"
            onClick={onClose}
            disabled={saving || preparingSignedDocument}
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={saving || loading || linkingReservation || preparingSignedDocument}
          >
            {saving ? "Enregistrement..." : "Enregistrer"}
          </button>
        </div>
        </section>
      </div>
    </>,
    document.body
  );
};

export default ContractReturnDrawer;
