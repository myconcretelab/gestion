import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../utils/api";
import type { Gestionnaire } from "../utils/types";

const SettingsPage = () => {
  const [gestionnaires, setGestionnaires] = useState<Gestionnaire[]>([]);
  const [prenom, setPrenom] = useState("");
  const [nom, setNom] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = async () => {
    const data = await apiFetch<Gestionnaire[]>("/managers");
    setGestionnaires(data);
  };

  useEffect(() => {
    setLoading(true);
    load()
      .catch((err: any) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const linkedGitesCount = useMemo(
    () => gestionnaires.reduce((sum, item) => sum + Number(item.gites_count ?? 0), 0),
    [gestionnaires]
  );

  const createManager = async () => {
    const trimmedPrenom = prenom.trim();
    const trimmedNom = nom.trim();
    if (!trimmedPrenom || !trimmedNom) {
      setError("Renseignez le prénom et le nom.");
      return;
    }

    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await apiFetch<Gestionnaire>("/managers", {
        method: "POST",
        json: { prenom: trimmedPrenom, nom: trimmedNom },
      });
      setPrenom("");
      setNom("");
      await load();
      setNotice("Gestionnaire ajouté.");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const removeManager = async (manager: Gestionnaire) => {
    const fullName = `${manager.prenom} ${manager.nom}`.trim();
    if (!confirm(`Supprimer le gestionnaire ${fullName} ?`)) return;

    setDeletingId(manager.id);
    setError(null);
    setNotice(null);
    try {
      await apiFetch(`/managers/${manager.id}`, { method: "DELETE" });
      await load();
      setNotice("Gestionnaire supprimé.");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div>
      <div className="card">
        <div className="section-title">Paramètres</div>
        <div className="field-hint">Gérez les gestionnaires qui peuvent être associés aux fiches gîtes.</div>
      </div>

      <div className="card">
        <div className="section-title">Ajouter un gestionnaire</div>
        <div className="grid-2">
          <label className="field">
            Prénom
            <input
              value={prenom}
              onChange={(event) => setPrenom(event.target.value)}
              placeholder="Ex. Marie"
              disabled={saving}
            />
          </label>
          <label className="field">
            Nom
            <input
              value={nom}
              onChange={(event) => setNom(event.target.value)}
              placeholder="Ex. Dupont"
              disabled={saving}
            />
          </label>
        </div>
        <div className="actions" style={{ marginTop: 16 }}>
          <button type="button" onClick={() => void createManager()} disabled={saving}>
            {saving ? "Ajout..." : "Ajouter"}
          </button>
        </div>
        {notice && <div className="note note--success">{notice}</div>}
        {error && <div className="note">{error}</div>}
      </div>

      <div className="card">
        <div className="settings-managers-header">
          <div className="section-title">Gestionnaires</div>
          <div className="field-hint">
            {gestionnaires.length} gestionnaire(s), {linkedGitesCount} gîte(s) associé(s)
          </div>
        </div>
        {loading ? (
          <div className="field-hint">Chargement...</div>
        ) : gestionnaires.length === 0 ? (
          <div className="field-hint">Aucun gestionnaire enregistré.</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Prénom</th>
                <th>Nom</th>
                <th>Gîtes associés</th>
                <th className="table-actions-cell">Action</th>
              </tr>
            </thead>
            <tbody>
              {gestionnaires.map((manager) => (
                <tr key={manager.id}>
                  <td>{manager.prenom}</td>
                  <td>{manager.nom}</td>
                  <td>
                    <span className="badge">{manager.gites_count ?? 0}</span>
                  </td>
                  <td className="table-actions-cell">
                    <button
                      type="button"
                      className="table-action table-action--danger"
                      onClick={() => void removeManager(manager)}
                      disabled={deletingId === manager.id}
                    >
                      {deletingId === manager.id ? "Suppression..." : "Supprimer"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

export default SettingsPage;
