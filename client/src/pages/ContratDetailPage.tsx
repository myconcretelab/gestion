import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { apiFetch } from "../utils/api";
import type { Contrat } from "../utils/types";
import { formatDate, formatEuro } from "../utils/format";

const ContratDetailPage = () => {
  const { id } = useParams();
  const [contrat, setContrat] = useState<Contrat | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pdfNonce] = useState(() => Date.now());

  const load = async () => {
    if (!id) return;
    const data = await apiFetch<Contrat>(`/contracts/${id}`);
    setContrat(data);
  };

  useEffect(() => {
    load().catch((err) => setError(err.message));
  }, [id]);

  const regenerate = async () => {
    if (!id) return;
    await apiFetch(`/contracts/${id}/regenerate`, { method: "POST" });
    await load();
  };

  const downloadPdf = () => {
    if (!id) return;
    const version = contrat?.date_derniere_modif ?? Date.now();
    window.open(
      `/api/contracts/${id}/pdf?v=${encodeURIComponent(String(version))}&t=${Date.now()}`,
      "_blank"
    );
  };

  if (error) return <div className="note">{error}</div>;
  if (!contrat) return <div>Chargement...</div>;

  const arrhesPaid = contrat.statut_paiement_arrhes === "recu";
  const email = contrat.locataire_email;
  const phoneHref = contrat.locataire_tel ? contrat.locataire_tel.replace(/\s+/g, "") : "";
  const pdfVersion = contrat.date_derniere_modif ?? contrat.date_creation ?? Date.now();
  const pdfUrl = `/api/contracts/${id}/pdf?v=${encodeURIComponent(String(pdfVersion))}&t=${pdfNonce}`;

  return (
    <div>
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
            <Link to={`/contrats/${contrat.id}/edition`}>Éditer</Link>
            <Link to={`/factures/nouvelle?fromContractId=${encodeURIComponent(contrat.id)}`}>
              Créer facture
            </Link>
            <button onClick={downloadPdf}>Télécharger PDF</button>
            <button className="secondary" onClick={regenerate}>
              Régénérer
            </button>
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
                {formatDate(contrat.date_debut)} — {formatDate(contrat.date_fin)}
              </span>
            </div>
            <div className="detail-item">
              <span className="detail-label">Créé le</span>
              <span className="detail-value">{formatDate(contrat.date_creation)}</span>
            </div>
            <div className="detail-item">
              <span className="detail-label">Dernière modif</span>
              <span className="detail-value">{formatDate(contrat.date_derniere_modif)}</span>
            </div>
          </div>

          <div className={`arrhes-card ${arrhesPaid ? "arrhes-card--paid" : "arrhes-card--pending"}`}>
            <div className="arrhes-label">Arrhes</div>
            <div className="arrhes-amount">{formatEuro(contrat.arrhes_montant)}</div>
            <div className={`arrhes-status ${arrhesPaid ? "arrhes-status--paid" : "arrhes-status--pending"}`}>
              {arrhesPaid ? "Payées" : "Non payées"}
            </div>
            <div className="arrhes-meta">
              À régler avant le {formatDate(contrat.arrhes_date_limite)}
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
          <iframe key={pdfUrl} className="preview-frame" title="Contrat PDF" src={pdfUrl} />
        </div>
      </div>
    </div>
  );
};

export default ContratDetailPage;
