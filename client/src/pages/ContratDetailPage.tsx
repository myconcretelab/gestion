import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { apiFetch } from "../utils/api";
import type { Contrat } from "../utils/types";
import { formatDate, formatEuro } from "../utils/format";
import {
  buildDocumentEmailDraft,
  buildDocumentEmailTemplateSettings,
  type BuildDocumentEmailDraftParams,
  type DocumentEmailDeliveryMode,
  type DocumentEmailTextSettings,
  type DocumentEmailTemplateSettings,
} from "../utils/documentEmail";
import DocumentEmailComposerDialog from "./shared/DocumentEmailComposerDialog";
import { toDateInputValue } from "./shared/rentalForm";

type EmailComposerState = {
  recipient: string;
  subject: string;
  body: string;
  deliveryMode: DocumentEmailDeliveryMode;
  draftParams: BuildDocumentEmailDraftParams;
  templateSettings: DocumentEmailTemplateSettings;
  autoSubject: string;
  autoBody: string;
};

const ContratDetailPage = () => {
  const { id } = useParams();
  const [contrat, setContrat] = useState<Contrat | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pdfNonce] = useState(() => Date.now());
  const [receptionUpdating, setReceptionUpdating] = useState(false);
  const [arrhesUpdating, setArrhesUpdating] = useState(false);
  const [balanceUpdating, setBalanceUpdating] = useState(false);
  const [dateSaving, setDateSaving] = useState<"reception" | "arrhes" | null>(
    null,
  );
  const [receptionDateInput, setReceptionDateInput] = useState("");
  const [arrhesPaymentDateInput, setArrhesPaymentDateInput] = useState("");
  const [emailSending, setEmailSending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [emailComposer, setEmailComposer] = useState<EmailComposerState | null>(
    null,
  );

  const load = async () => {
    if (!id) return;
    const data = await apiFetch<Contrat>(`/contracts/${id}`);
    setContrat(data);
  };

  useEffect(() => {
    load().catch((err) => setError(err.message));
  }, [id]);

  useEffect(() => {
    setReceptionDateInput(toDateInputValue(contrat?.date_reception_contrat));
    setArrhesPaymentDateInput(toDateInputValue(contrat?.date_paiement_arrhes));
  }, [contrat?.date_reception_contrat, contrat?.date_paiement_arrhes]);

  const regenerate = async () => {
    if (!id) return;
    await apiFetch(`/contracts/${id}/regenerate`, { method: "POST" });
    await load();
  };

  const toggleReception = async () => {
    if (!id || !contrat) return;
    const nextStatus =
      contrat.statut_reception_contrat === "recu" ? "non_recu" : "recu";
    setReceptionUpdating(true);
    try {
      const updated = await apiFetch<Contrat>(`/contracts/${id}/reception`, {
        method: "PATCH",
        json: { statut_reception_contrat: nextStatus },
      });
      setError(null);
      setNotice(null);
      setContrat(updated);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setReceptionUpdating(false);
    }
  };

  const toggleArrhes = async () => {
    if (!id || !contrat) return;
    const nextStatus =
      contrat.statut_paiement_arrhes === "recu" ? "non_recu" : "recu";
    setArrhesUpdating(true);
    try {
      const updated = await apiFetch<Contrat>(`/contracts/${id}/arrhes`, {
        method: "PATCH",
        json: { statut_paiement_arrhes: nextStatus },
      });
      setError(null);
      setNotice(null);
      setContrat(updated);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setArrhesUpdating(false);
    }
  };

  const toggleBalance = async () => {
    if (!id || !contrat) return;
    const nextStatus =
      contrat.statut_paiement_solde === "regle" ? "non_regle" : "regle";
    setBalanceUpdating(true);
    try {
      const updated = await apiFetch<Contrat>(`/contracts/${id}/solde`, {
        method: "PATCH",
        json: { statut_paiement_solde: nextStatus },
      });
      setError(null);
      setNotice(null);
      setContrat(updated);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBalanceUpdating(false);
    }
  };

  const saveTrackingDate = async (field: "reception" | "arrhes") => {
    if (!id) return;
    setDateSaving(field);
    try {
      const updated = await apiFetch<Contrat>(
        `/contracts/${id}/tracking-dates`,
        {
          method: "PATCH",
          json:
            field === "reception"
              ? { date_reception_contrat: receptionDateInput || null }
              : { date_paiement_arrhes: arrhesPaymentDateInput || null },
        },
      );
      setError(null);
      setNotice(null);
      setContrat(updated);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDateSaving(null);
    }
  };

  const openEmailComposer = async () => {
    if (!id || !contrat?.locataire_email) return;
    try {
      const version =
        contrat.date_derniere_modif ?? contrat.date_creation ?? Date.now();
      const documentUrl = new URL(
        `/api/contracts/${id}/pdf?v=${encodeURIComponent(String(version))}`,
        window.location.origin,
      ).toString();
      const emailTextSettings = await apiFetch<DocumentEmailTextSettings>(
        "/settings/document-email-texts",
      );
      const templateSettings = buildDocumentEmailTemplateSettings(
        emailTextSettings,
      );
      const draftParams: BuildDocumentEmailDraftParams = {
        recipient: contrat.locataire_email,
        documentType: "contrat",
        documentNumber: contrat.numero_contrat,
        documentUrl,
        locataireNom: contrat.locataire_nom,
        giteNom: contrat.gite?.nom,
        dateDebut: contrat.date_debut,
        heureArrivee: contrat.heure_arrivee,
        dateFin: contrat.date_fin,
        heureDepart: contrat.heure_depart,
        nbNuits: contrat.nb_nuits,
        arrhesMontant: contrat.arrhes_montant,
        arrhesDateLimite: contrat.arrhes_date_limite,
        statutPaiementArrhes: contrat.statut_paiement_arrhes,
        datePaiementArrhes: contrat.date_paiement_arrhes ?? null,
        modePaiementArrhes: contrat.mode_paiement_arrhes ?? null,
        soldeMontant: contrat.solde_montant,
        deliveryMode: "attachment",
      };
      const draft = buildDocumentEmailDraft(draftParams, templateSettings);
      setError(null);
      setEmailComposer({
        recipient: draft.recipient ?? contrat.locataire_email,
        subject: draft.subject,
        body: draft.body,
        deliveryMode: draftParams.deliveryMode ?? "attachment",
        draftParams,
        templateSettings,
        autoSubject: draft.subject,
        autoBody: draft.body,
      });
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const sendEmail = async () => {
    if (!id || !contrat?.locataire_email || !emailComposer) return;
    setEmailSending(true);
    try {
      const updated = await apiFetch<Contrat>(`/contracts/${id}/send-email`, {
        method: "POST",
        json: {
          recipient: emailComposer.recipient,
          subject: emailComposer.subject,
          body: emailComposer.body,
          deliveryMode: emailComposer.deliveryMode,
        },
      });
      setError(null);
      setNotice(`Contrat envoyé à ${updated.locataire_email}.`);
      setEmailComposer(null);
      setContrat(updated);
    } catch (err) {
      setNotice(null);
      setError((err as Error).message);
    } finally {
      setEmailSending(false);
    }
  };

  const downloadPdf = () => {
    if (!id) return;
    const version = contrat?.date_derniere_modif ?? Date.now();
    window.open(
      `/api/contracts/${id}/pdf?v=${encodeURIComponent(String(version))}&t=${Date.now()}`,
      "_blank",
    );
  };

  if (error && !contrat) return <div className="note">{error}</div>;
  if (!contrat) return <div>Chargement...</div>;

  const contractReceived = contrat.statut_reception_contrat === "recu";
  const arrhesPaid = contrat.statut_paiement_arrhes === "recu";
  const balancePaid = contrat.statut_paiement_solde === "regle";
  const contractFrozen = Boolean(contrat.pdf_sent_path);
  const email = contrat.locataire_email;
  const phoneHref = contrat.locataire_tel
    ? contrat.locataire_tel.replace(/\s+/g, "")
    : "";
  const receptionDateEnabled = contractReceived || Boolean(receptionDateInput);
  const arrhesDateEnabled = arrhesPaid || Boolean(arrhesPaymentDateInput);
  const showArrhesDeadline = !arrhesPaid && Boolean(contrat.arrhes_date_limite);
  const pdfVersion =
    contrat.date_derniere_modif ?? contrat.date_creation ?? Date.now();
  const pdfUrl = `/api/contracts/${id}/pdf?v=${encodeURIComponent(String(pdfVersion))}&t=${pdfNonce}`;

  return (
    <div>
      {error ? <div className="note">{error}</div> : null}
      {notice ? <div className="note note--success">{notice}</div> : null}
      <DocumentEmailComposerDialog
        open={Boolean(emailComposer)}
        title={`Email du contrat ${contrat.numero_contrat}`}
        recipient={emailComposer?.recipient ?? ""}
        subject={emailComposer?.subject ?? ""}
        body={emailComposer?.body ?? ""}
        deliveryMode={emailComposer?.deliveryMode ?? "attachment"}
        sending={emailSending}
        onClose={() => setEmailComposer(null)}
        onRecipientChange={(value) =>
          setEmailComposer((prev) =>
            prev ? { ...prev, recipient: value } : prev,
          )
        }
        onSubjectChange={(value) =>
          setEmailComposer((prev) =>
            prev ? { ...prev, subject: value } : prev,
          )
        }
        onBodyChange={(value) =>
          setEmailComposer((prev) => (prev ? { ...prev, body: value } : prev))
        }
        onDeliveryModeChange={(value) =>
          setEmailComposer((prev) => {
            if (!prev) return prev;
            const nextDraftParams = { ...prev.draftParams, deliveryMode: value };
            const nextDraft = buildDocumentEmailDraft(
              nextDraftParams,
              prev.templateSettings,
            );
            return {
              ...prev,
              deliveryMode: value,
              draftParams: nextDraftParams,
              subject:
                prev.subject === prev.autoSubject
                  ? nextDraft.subject
                  : prev.subject,
              body: prev.body === prev.autoBody ? nextDraft.body : prev.body,
              autoSubject: nextDraft.subject,
              autoBody: nextDraft.body,
            };
          })
        }
        onSubmit={sendEmail}
      />
      <Link to="/contrats" className="back-link">
        Retour
      </Link>

      <div className="card detail-card">
        <div className="detail-header">
          <div>
            <div className="detail-kicker">Contrat</div>
            <div className="detail-number">{contrat.numero_contrat}</div>
          </div>
          <div className="actions">
            {contractFrozen ? (
              <button
                type="button"
                disabled
                title="Le contrat envoyé est figé. Utilisez le traitement du retour pour mettre à jour la réservation."
              >
                Contrat figé
              </button>
            ) : (
              <Link to={`/contrats/${contrat.id}/edition`}>Éditer</Link>
            )}
            <Link
              to={`/factures/nouvelle?fromContractId=${encodeURIComponent(contrat.id)}`}
            >
              Créer facture
            </Link>
            {email ? (
              <button
                type="button"
                onClick={() => void openEmailComposer()}
                disabled={emailSending}
              >
                Email
              </button>
            ) : (
              <button
                type="button"
                disabled
                title="Email locataire non renseigné"
              >
                Envoyer contrat
              </button>
            )}
            <button onClick={downloadPdf}>Télécharger PDF</button>
            {contractFrozen ? null : (
              <button className="secondary" onClick={regenerate}>
                Régénérer
              </button>
            )}
          </div>
        </div>

        <div className="detail-grid">
          <div className="detail-block">
            <div className="detail-item">
              <span className="detail-label">Locataire</span>
              <span className="detail-value">{contrat.locataire_nom}</span>
            </div>
            <div className="detail-item">
              <span className="detail-label">Gîte</span>
              <span className="detail-value">{contrat.gite?.nom ?? "—"}</span>
            </div>
            <div className="detail-item">
              <span className="detail-label">Période</span>
              <span className="detail-value">
                {formatDate(contrat.date_debut)} —{" "}
                {formatDate(contrat.date_fin)}
              </span>
            </div>
            <div className="detail-item">
              <span className="detail-label">Créé le</span>
              <span className="detail-value">
                {formatDate(contrat.date_creation)}
              </span>
            </div>
            <div className="detail-item">
              <span className="detail-label">Dernière modif</span>
              <span className="detail-value">
                {formatDate(contrat.date_derniere_modif)}
              </span>
            </div>
          </div>

          <div
            className={`arrhes-card ${contractReceived ? "arrhes-card--paid" : "arrhes-card--pending"}`}
          >
            <div className="arrhes-label">Contrat signé</div>
            <div className="switch-group">
              <label className="switch">
                <input
                  type="checkbox"
                  checked={contractReceived}
                  disabled={receptionUpdating}
                  onChange={toggleReception}
                />
                <span className="slider" />
              </label>
              <span>Reçu en retour</span>
            </div>
            <div className="arrhes-card__editor">
              <label className="field">
                Date de réception du contrat
                <input
                  type="date"
                  value={receptionDateInput}
                  disabled={!receptionDateEnabled}
                  onChange={(e) => setReceptionDateInput(e.target.value)}
                />
              </label>
              <button
                type="button"
                className="secondary arrhes-card__save"
                disabled={!receptionDateEnabled || dateSaving === "reception"}
                onClick={() => saveTrackingDate("reception")}
              >
                {dateSaving === "reception"
                  ? "Enregistrement..."
                  : "Enregistrer"}
              </button>
            </div>
          </div>

          <div
            className={`arrhes-card ${arrhesPaid ? "arrhes-card--paid" : "arrhes-card--pending"}`}
          >
            <div className="arrhes-label">Arrhes</div>
            <div className="arrhes-card__header">
              <div className="arrhes-amount arrhes-amount--compact">
                {formatEuro(contrat.arrhes_montant)}
              </div>
              <div className="switch-group arrhes-card__toggle">
                <label className="switch">
                  <input
                    type="checkbox"
                    checked={arrhesPaid}
                    disabled={arrhesUpdating}
                    onChange={toggleArrhes}
                  />
                  <span className="slider" />
                </label>
                <span>Payées</span>
              </div>
            </div>
            <div className="arrhes-balance">
              <div className="arrhes-balance__label">Reste dû</div>
              <div className="arrhes-card__header">
                <div className="arrhes-amount">
                  {formatEuro(contrat.solde_montant)}
                </div>
                <div className="switch-group arrhes-card__toggle">
                  <label className="switch">
                    <input
                      type="checkbox"
                      checked={balancePaid}
                      disabled={balanceUpdating}
                      onChange={toggleBalance}
                    />
                    <span className="slider" />
                  </label>
                  <span>Payé</span>
                </div>
              </div>
            </div>
            {balancePaid ? (
              <div className="arrhes-meta">Solde réglé</div>
            ) : null}
            {showArrhesDeadline ? (
              <div className="arrhes-meta">
                À régler avant le {formatDate(contrat.arrhes_date_limite)}
              </div>
            ) : null}
            {contrat.mode_paiement_arrhes ? (
              <div className="arrhes-meta">
                Mode de paiement: {contrat.mode_paiement_arrhes}
              </div>
            ) : null}
            <div className="arrhes-card__editor">
              <label className="field">
                Date de paiement des arrhes
                <input
                  type="date"
                  value={arrhesPaymentDateInput}
                  disabled={!arrhesDateEnabled}
                  onChange={(e) => setArrhesPaymentDateInput(e.target.value)}
                />
              </label>
              <button
                type="button"
                className="secondary arrhes-card__save"
                disabled={!arrhesDateEnabled || dateSaving === "arrhes"}
                onClick={() => saveTrackingDate("arrhes")}
              >
                {dateSaving === "arrhes"
                  ? "Enregistrement..."
                  : "Enregistrer"}
              </button>
            </div>
          </div>

          <div className="detail-block detail-block--contact">
            <div className="detail-item">
              <span className="detail-label">Adresse</span>
              <span className="detail-value">{contrat.locataire_adresse}</span>
            </div>
            <div className="detail-item">
              <span className="detail-label">Email</span>
              {email ? (
                <a className="detail-link" href={`mailto:${email}`}>
                  {email}
                </a>
              ) : (
                <span className="detail-value">—</span>
              )}
            </div>
            <div className="detail-item">
              <span className="detail-label">Dernier envoi email</span>
              <span className="detail-value">
                {contrat.date_envoi_email
                  ? formatDate(contrat.date_envoi_email)
                  : "—"}
              </span>
            </div>
            <div className="detail-item">
              <span className="detail-label">Téléphone</span>
              {contrat.locataire_tel ? (
                <a className="detail-link" href={`tel:${phoneHref}`}>
                  {contrat.locataire_tel}
                </a>
              ) : (
                <span className="detail-value">—</span>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="section-title">PDF</div>
        <div className="preview-shell">
          <iframe
            key={pdfUrl}
            className="preview-frame"
            title="Contrat PDF"
            src={pdfUrl}
          />
        </div>
      </div>
    </div>
  );
};

export default ContratDetailPage;
