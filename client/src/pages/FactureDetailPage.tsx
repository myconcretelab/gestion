import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { apiFetch } from "../utils/api";
import type { Facture } from "../utils/types";
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
import { invoiceDisplayNumber, invoiceLifecycleLabel } from "../utils/invoiceLifecycle";
import { canCurrentUserManageIntegrations } from "../utils/auth";
import ElectronicInvoicePanel from "./shared/ElectronicInvoicePanel";

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

const FactureDetailPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [facture, setFacture] = useState<Facture | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pdfNonce] = useState(() => Date.now());
  const [emailSending, setEmailSending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [issuing, setIssuing] = useState(false);
  const [creditReason, setCreditReason] = useState("");
  const [showCreditForm, setShowCreditForm] = useState(false);
  const [emailComposer, setEmailComposer] = useState<EmailComposerState | null>(
    null,
  );

  const load = async () => {
    if (!id) return;
    const data = await apiFetch<Facture>(`/invoices/${id}`);
    setFacture(data);
  };

  useEffect(() => {
    load().catch((err) => setError(err.message));
  }, [id]);

  const regenerate = async () => {
    if (!id) return;
    try {
      await apiFetch(`/invoices/${id}/regenerate`, { method: "POST" });
      await load();
    } catch (error) { setError((error as Error).message); }
  };

  const issue = async () => {
    if (!facture || !confirm("Valider définitivement ce document ? Son numéro et son PDF seront figés. Le document ne pourra plus être modifié ou supprimé.")) return;
    setIssuing(true); setError(null); setNotice(null);
    try {
      const saved = await apiFetch<Facture>(`/invoices/${facture.id}/issue`, { method: "POST", json: { revision: facture.revision } });
      setFacture(saved);
      setNotice("Document validé et PDF archivé.");
    } catch (error) { setError((error as Error).message); }
    finally { setIssuing(false); }
  };

  const createCredit = async () => {
    if (!facture || !creditReason.trim()) return;
    setIssuing(true); setError(null);
    try {
      const saved = await apiFetch<Facture>(`/invoices/${facture.id}/credit-note`, { method: "POST", json: { reason: creditReason } });
      setShowCreditForm(false);
      navigate(`/factures/${saved.id}`);
      setFacture(null);
    } catch (error) { setError((error as Error).message); }
    finally { setIssuing(false); }
  };

  const openEmailComposer = async () => {
    if (!id || !facture?.locataire_email) return;
    try {
      const version =
        facture.date_derniere_modif ?? facture.date_creation ?? Date.now();
      const documentUrl = new URL(
        `/api/invoices/${id}/pdf?v=${encodeURIComponent(String(version))}`,
        window.location.origin,
      ).toString();
      const emailTextSettings = await apiFetch<DocumentEmailTextSettings>(
        "/settings/document-email-texts",
      );
      const templateSettings = buildDocumentEmailTemplateSettings(
        emailTextSettings,
      );
      const draftParams: BuildDocumentEmailDraftParams = {
        recipient: facture.locataire_email,
        documentType: "facture",
        documentNumber: facture.numero_facture,
        documentUrl,
        locataireNom: facture.locataire_nom,
        giteNom: facture.gite?.nom,
        giteNameWithPreposition: facture.gite?.nom_avec_preposition,
        giteAddressLine1: facture.gite?.adresse_ligne1,
        giteAddressLine2: facture.gite?.adresse_ligne2,
        ownerPhoneNumbers: facture.gite?.telephones,
        deliveryMode: "attachment",
      };
      const draft = buildDocumentEmailDraft(draftParams, templateSettings);
      setError(null);
      setEmailComposer({
        recipient: draft.recipient ?? facture.locataire_email,
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
    if (!id || !facture?.locataire_email || !emailComposer) return;
    setEmailSending(true);
    try {
      const updated = await apiFetch<Facture>(`/invoices/${id}/send-email`, {
        method: "POST",
        json: {
          recipient: emailComposer.recipient,
          subject: emailComposer.subject,
          body: emailComposer.body,
          deliveryMode: emailComposer.deliveryMode,
        },
      });
      setError(null);
      setNotice(`Facture envoyée à ${updated.locataire_email}.`);
      setEmailComposer(null);
      setFacture(updated);
    } catch (err) {
      setNotice(null);
      setError((err as Error).message);
    } finally {
      setEmailSending(false);
    }
  };

  const downloadPdf = () => {
    if (!id) return;
    const version = facture?.date_derniere_modif ?? Date.now();
    window.open(
      `/api/invoices/${id}/pdf?v=${encodeURIComponent(String(version))}&t=${Date.now()}`,
      "_blank",
    );
  };

  if (error && !facture) return <div className="note">{error}</div>;
  if (!facture) return <div>Chargement...</div>;

  const isPaid = facture.statut_paiement === "reglee";
  const totalMontant =
    Number(facture.solde_montant ?? 0) + Number(facture.arrhes_montant ?? 0);
  const email = facture.locataire_email;
  const phoneHref = facture.locataire_tel
    ? facture.locataire_tel.replace(/\s+/g, "")
    : "";
  const pdfVersion =
    facture.date_derniere_modif ?? facture.date_creation ?? Date.now();
  const pdfUrl = `/api/invoices/${id}/pdf?v=${encodeURIComponent(String(pdfVersion))}&t=${pdfNonce}`;

  return (
    <div>
      {error ? <div className="note">{error}</div> : null}
      {notice ? <div className="note note--success">{notice}</div> : null}
      <DocumentEmailComposerDialog
        open={Boolean(emailComposer)}
        title={`Email de la facture ${facture.numero_facture}`}
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
      <Link to="/factures" className="back-link">
        Retour
      </Link>

      <div className="card detail-card">
        <div className="detail-header">
          <div>
            <div className="detail-kicker">{facture.document_kind === "credit_note" ? "Avoir intégral" : "Facture"} · {invoiceLifecycleLabel(facture)}</div>
            <div className="detail-number">{invoiceDisplayNumber(facture)}</div>
          </div>
          <div className="actions">
            {facture.lifecycle_status === "draft" && facture.document_kind !== "credit_note" && <Link to={`/factures/${facture.id}/edition`}>Éditer le brouillon</Link>}
            {facture.lifecycle_status === "draft" && <button type="button" onClick={() => void issue()} disabled={issuing}>{issuing ? "Validation…" : "Valider définitivement"}</button>}
            {facture.lifecycle_status !== "draft" && facture.locataire_email ? (
              <button
                type="button"
                onClick={() => void openEmailComposer()}
                disabled={emailSending}
              >
                Email
              </button>
            ) : (
              <button type="button" disabled title="Email client non renseigné">
                Envoyer facture
              </button>
            )}
            <button onClick={downloadPdf}>Télécharger PDF</button>
            {facture.lifecycle_status === "draft" && <button className="secondary" onClick={() => void regenerate()}>
              Régénérer
            </button>}
            {facture.lifecycle_status === "issued" && facture.document_kind === "invoice" && !facture.credit_notes?.length && totalMontant > 0 &&
              <button type="button" className="secondary" onClick={() => setShowCreditForm(true)}>Créer un avoir intégral</button>}
          </div>
        </div>

        {facture.lifecycle_status === "draft" && <p className="note">Ce document est un brouillon. Sa validation lui attribuera un numéro définitif et figera son contenu. L’envoi par e-mail sera alors disponible.</p>}
        {facture.issuer && <p>{facture.lifecycle_status === "draft" ? "Émetteur prévu" : "Émetteur"} : {facture.issuer.legal_name} · SIREN {facture.issuer.siren || "à compléter"} · SIRET {facture.issuer.siret || "à compléter"}</p>}
        {facture.issued_at && <p>Émis le {formatDate(facture.issued_at)}. Le suivi du paiement ne modifie pas le PDF archivé.</p>}
        {facture.lifecycle_status === "draft" && !!facture.fiscal_issues?.length && <div className="note"><p>À compléter avant validation :</p><ul>{facture.fiscal_issues.map((issue) => <li key={issue}>{issue}</li>)}</ul></div>}
        {facture.fiscal_totals && <p>Détail fiscal : HT {formatEuro(facture.fiscal_totals.net_cents / 100)} · TVA {formatEuro(facture.fiscal_totals.vat_cents / 100)} · TTC {formatEuro(facture.fiscal_totals.gross_cents / 100)}{facture.document_kind === "credit_note" ? " (montants annulés par l’avoir)" : ""}.</p>}
        {facture.structured_available && <p><a href={`/api/invoices/${facture.id}/structured`} target="_blank" rel="noreferrer">Exporter l’instantané fiscal structuré</a> · Données figées à l’émission, distinctes du suivi SuperPDP.</p>}
        {facture.lifecycle_status === "issued" && canCurrentUserManageIntegrations() && <ElectronicInvoicePanel key={facture.id} invoiceId={facture.id} />}
        {facture.lifecycle_status === "legacy" && <p className="note">Document historique conservé avec son numéro et son PDF d’origine. Les corrections nécessitent une reprise vérifiée de son émetteur et de ses montants.</p>}
        {facture.original_invoice && <p>Avoir de la <Link to={`/factures/${facture.original_invoice.id}`}>facture {facture.original_invoice.numero_facture}</Link>.</p>}
        {facture.credit_notes?.map((credit) => <p key={credit.id}><Link to={`/factures/${credit.id}`}>{credit.lifecycle_status === "draft" ? "Consulter le brouillon d’avoir" : `Consulter l’avoir ${credit.numero_facture}`}</Link></p>)}
        {showCreditForm && <div className="form-section"><p>L’avoir annulera l’intégralité du montant de cette facture. La facture d’origine sera conservée. L’avoir sera d’abord enregistré en brouillon.</p>
          <label className="field">Motif de l’avoir<textarea value={creditReason} maxLength={2000} onChange={(event) => setCreditReason(event.target.value)} /></label>
          <div className="actions"><button type="button" disabled={issuing || !creditReason.trim()} onClick={() => void createCredit()}>Enregistrer le brouillon d’avoir</button>
            <button type="button" className="secondary" onClick={() => setShowCreditForm(false)}>Annuler</button></div>
        </div>}

        <div className="detail-grid">
          <div className="detail-block">
            <div className="detail-item">
              <span className="detail-label">Client</span>
              <span className="detail-value">{facture.locataire_nom}</span>
            </div>
            <div className="detail-item">
              <span className="detail-label">Gîte</span>
              <span className="detail-value">
                {facture.reservation_items?.length >= 2
                  ? `${new Set(facture.reservation_items.map((item) => item.gite_id)).size} gîtes`
                  : facture.gite?.nom ?? "—"}
              </span>
            </div>
            <div className="detail-item">
              <span className="detail-label">Période</span>
              <span className="detail-value">
                {formatDate(facture.date_debut)} —{" "}
                {formatDate(facture.date_fin)}
              </span>
            </div>
            <div className="detail-item">
              <span className="detail-label">Créée le</span>
              <span className="detail-value">
                {formatDate(facture.date_creation)}
              </span>
            </div>
            <div className="detail-item">
              <span className="detail-label">Dernière modif</span>
              <span className="detail-value">
                {formatDate(facture.date_derniere_modif)}
              </span>
            </div>
          </div>

          {facture.reservation_items?.length >= 2 && (
            <div className="detail-block">
              <div className="detail-label">Réservations incluses</div>
              {facture.reservation_items.map((item) => (
                <div className="detail-item" key={item.reservation_id}>
                  <span className="detail-value">{item.gite_nom} · {item.hote_nom}</span>
                  <span className="detail-value">{formatDate(item.date_debut)} — {formatDate(item.date_fin)} · {formatEuro(item.montant)}</span>
                </div>
              ))}
            </div>
          )}

          <div
            className={`arrhes-card ${isPaid ? "arrhes-card--paid" : "arrhes-card--pending"}`}
          >
            <div className="arrhes-label">{facture.document_kind === "credit_note" ? "Suivi de l’avoir" : "Paiement"}</div>
            <div className="arrhes-amount">{formatEuro(totalMontant)}</div>
            <div
              className={`arrhes-status ${isPaid ? "arrhes-status--paid" : "arrhes-status--pending"}`}
            >
              {isPaid ? facture.document_kind === "credit_note" ? "Traité" : "Réglée" : "En attente"}
            </div>
            <div className="arrhes-meta">
              {facture.fiscal_totals ? `Sommes reçues à l’émission : ${formatEuro(facture.fiscal_totals.paid_cents / 100)}` : `Acompte : ${formatEuro(facture.arrhes_montant)}`}
            </div>
            <div className="arrhes-meta">
              {facture.fiscal_totals ? `Reste à régler à l’émission : ${formatEuro((facture.document_kind === "credit_note" ? -1 : 1) * facture.fiscal_totals.due_cents / 100)}` : `Solde : ${formatEuro(facture.solde_montant)}`}
            </div>
          </div>

          <div className="detail-block detail-block--contact">
            <div className="detail-item">
              <span className="detail-label">Adresse</span>
              <span className="detail-value">{facture.fiscal_input ? [facture.fiscal_input.buyer.address_line1, facture.fiscal_input.buyer.address_line2, facture.fiscal_input.buyer.postal_code, facture.fiscal_input.buyer.city, facture.fiscal_input.buyer.country_code].filter(Boolean).join(" · ") : facture.locataire_adresse}</span>
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
                {facture.date_envoi_email
                  ? formatDate(facture.date_envoi_email)
                  : "—"}
              </span>
            </div>
            <div className="detail-item">
              <span className="detail-label">Téléphone</span>
              {facture.locataire_tel ? (
                <a className="detail-link" href={`tel:${phoneHref}`}>
                  {facture.locataire_tel}
                </a>
              ) : (
                <span className="detail-value">—</span>
              )}
            </div>
            {facture.document_kind !== "credit_note" && <div className="detail-item">
              <span className="detail-label">Échéance</span>
              <span className="detail-value">
                {facture.fiscal_input ? facture.fiscal_input.payment_due_date ? formatDate(facture.fiscal_input.payment_due_date) : "Voir les conditions de paiement" : formatDate(facture.arrhes_date_limite)}
              </span>
            </div>}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="section-title">PDF</div>
        <div className="preview-shell">
          <iframe
            key={pdfUrl}
            className="preview-frame"
            title="Facture PDF"
            src={pdfUrl}
          />
        </div>
      </div>
    </div>
  );
};

export default FactureDetailPage;
