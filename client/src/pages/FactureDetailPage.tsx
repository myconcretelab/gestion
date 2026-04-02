import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { apiFetch } from "../utils/api";
import type { Facture } from "../utils/types";
import { formatDate, formatEuro } from "../utils/format";
import {
  buildDocumentEmailDraft,
  buildDocumentEmailTemplateSettings,
  type DocumentEmailTextSettings,
} from "../utils/documentEmail";
import DocumentEmailComposerDialog from "./shared/DocumentEmailComposerDialog";

type EmailComposerState = {
  recipient: string;
  subject: string;
  body: string;
};

const FactureDetailPage = () => {
  const { id } = useParams();
  const [facture, setFacture] = useState<Facture | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pdfNonce] = useState(() => Date.now());
  const [emailSending, setEmailSending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
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
    await apiFetch(`/invoices/${id}/regenerate`, { method: "POST" });
    await load();
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
      setError(null);
      setEmailComposer(
        buildDocumentEmailDraft(
          {
            recipient: facture.locataire_email,
            documentType: "facture",
            documentNumber: facture.numero_facture,
            documentUrl,
            locataireNom: facture.locataire_nom,
            giteNom: facture.gite?.nom,
          },
          buildDocumentEmailTemplateSettings(emailTextSettings),
        ),
      );
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
        onSubmit={sendEmail}
      />
      <Link to="/factures" className="back-link">
        Retour
      </Link>

      <div className="card detail-card">
        <div className="detail-header">
          <div>
            <div className="detail-kicker">Facture</div>
            <div className="detail-number">{facture.numero_facture}</div>
          </div>
          <div className="actions">
            <Link to={`/factures/${facture.id}/edition`}>Éditer</Link>
            {facture.locataire_email ? (
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
            <button className="secondary" onClick={regenerate}>
              Régénérer
            </button>
          </div>
        </div>

        <div className="detail-grid">
          <div className="detail-block">
            <div className="detail-item">
              <span className="detail-label">Client</span>
              <span className="detail-value">{facture.locataire_nom}</span>
            </div>
            <div className="detail-item">
              <span className="detail-label">Gîte</span>
              <span className="detail-value">{facture.gite?.nom ?? "—"}</span>
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

          <div
            className={`arrhes-card ${isPaid ? "arrhes-card--paid" : "arrhes-card--pending"}`}
          >
            <div className="arrhes-label">Paiement</div>
            <div className="arrhes-amount">{formatEuro(totalMontant)}</div>
            <div
              className={`arrhes-status ${isPaid ? "arrhes-status--paid" : "arrhes-status--pending"}`}
            >
              {isPaid ? "Réglée" : "En attente"}
            </div>
            <div className="arrhes-meta">
              Acompte: {formatEuro(facture.arrhes_montant)}
            </div>
            <div className="arrhes-meta">
              Solde: {formatEuro(facture.solde_montant)}
            </div>
          </div>

          <div className="detail-block detail-block--contact">
            <div className="detail-item">
              <span className="detail-label">Adresse</span>
              <span className="detail-value">{facture.locataire_adresse}</span>
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
              <span className="detail-label">Téléphone</span>
              {facture.locataire_tel ? (
                <a className="detail-link" href={`tel:${phoneHref}`}>
                  {facture.locataire_tel}
                </a>
              ) : (
                <span className="detail-value">—</span>
              )}
            </div>
            <div className="detail-item">
              <span className="detail-label">Échéance</span>
              <span className="detail-value">
                {formatDate(facture.arrhes_date_limite)}
              </span>
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
            title="Facture PDF"
            src={pdfUrl}
          />
        </div>
      </div>
    </div>
  );
};

export default FactureDetailPage;
