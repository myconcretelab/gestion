import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { apiFetch } from "../utils/api";
import type { Contrat } from "../utils/types";
import { formatDate, formatEuro } from "../utils/format";

const ContratDetailPage = () => {
  const { id } = useParams();
  const [contrat, setContrat] = useState<Contrat | null>(null);
  const [error, setError] = useState<string | null>(null);

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
    window.open(`/api/contracts/${id}/pdf`, "_blank");
  };

  if (error) return <div className="note">{error}</div>;
  if (!contrat) return <div>Chargement...</div>;

  return (
    <div>
      <div className="card">
        <div className="section-title">Contrat {contrat.numero_contrat}</div>
        <div className="grid-2">
          <div>
            <strong>Locataire:</strong> {contrat.locataire_nom}
          </div>
          <div>
            <strong>Gîte:</strong> {contrat.gite?.nom}
          </div>
          <div>
            <strong>Période:</strong> {formatDate(contrat.date_debut)} - {formatDate(contrat.date_fin)}
          </div>
          <div>
            <strong>Arrhes:</strong> {formatEuro(contrat.arrhes_montant)}
          </div>
          <div>
            <strong>Créé le:</strong> {formatDate(contrat.date_creation)}
          </div>
          <div>
            <strong>Dernière modif:</strong> {formatDate(contrat.date_derniere_modif)}
          </div>
        </div>
        <div className="actions" style={{ marginTop: 16 }}>
          <button onClick={downloadPdf}>Télécharger PDF</button>
          <button className="secondary" onClick={regenerate}>
            Régénérer
          </button>
          <Link to="/contrats" className="secondary">
            Retour
          </Link>
        </div>
      </div>

      <div className="card">
        <div className="section-title">Détails</div>
        <p>{contrat.locataire_adresse}</p>
        <p>{contrat.locataire_tel}</p>
      </div>
    </div>
  );
};

export default ContratDetailPage;
