import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../utils/api";
import type { AppUser } from "../utils/auth";
import type { Gestionnaire } from "../utils/types";

type ManagedUser = AppUser & {
  gestionnaire?: {
    id: string;
    prenom: string;
    nom: string;
    gitesCount: number;
  } | null;
};

type UserDraft = {
  displayName: string;
  gestionnaireId: string;
  canWrite: boolean;
  canViewAmounts: boolean;
  isOwner: boolean;
  isActive: boolean;
};

const emptyDraft = (): UserDraft => ({
  displayName: "",
  gestionnaireId: "",
  canWrite: false,
  canViewAmounts: false,
  isOwner: false,
  isActive: true,
});

const toDraft = (user: ManagedUser): UserDraft => ({
  displayName: user.displayName,
  gestionnaireId: user.gestionnaireId ?? "",
  canWrite: user.permissions.canWrite,
  canViewAmounts: user.permissions.canViewAmounts,
  isOwner: user.permissions.isOwner,
  isActive: user.isActive,
});

const payload = (draft: UserDraft) => ({
  ...draft,
  gestionnaireId: draft.gestionnaireId || null,
});

const PermissionFields = ({ draft, onChange }: { draft: UserDraft; onChange: (draft: UserDraft) => void }) => (
  <div className="user-permissions">
    <label className="checkbox-row">
      <input type="checkbox" checked={draft.canWrite} onChange={(event) => onChange({ ...draft, canWrite: event.target.checked })} />
      <span><strong>Écriture</strong><small>Créer, modifier, supprimer et lancer les synchronisations.</small></span>
    </label>
    <label className="checkbox-row">
      <input type="checkbox" checked={draft.canViewAmounts} onChange={(event) => onChange({ ...draft, canViewAmounts: event.target.checked })} />
      <span><strong>Montants en euros</strong><small>Afficher les prix, revenus, frais, contrats, factures et statistiques.</small></span>
    </label>
    <label className="checkbox-row">
      <input type="checkbox" checked={draft.isOwner} onChange={(event) => onChange({ ...draft, isOwner: event.target.checked })} />
      <span><strong>Propriétaire</strong><small>Gérer les utilisateurs et leurs privilèges.</small></span>
    </label>
    <label className="checkbox-row">
      <input type="checkbox" checked={draft.isActive} onChange={(event) => onChange({ ...draft, isActive: event.target.checked })} />
      <span><strong>Compte actif</strong><small>Proposer cet utilisateur sur l’écran de connexion.</small></span>
    </label>
  </div>
);

const UserSettings = ({ currentUserId }: { currentUserId: string | null }) => {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [managers, setManagers] = useState<Gestionnaire[]>([]);
  const [drafts, setDrafts] = useState<Record<string, UserDraft>>({});
  const [newDraft, setNewDraft] = useState<UserDraft>(emptyDraft);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const linkedManagerIds = useMemo(
    () => new Set(users.map((user) => user.gestionnaireId).filter(Boolean)),
    [users],
  );

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [userRows, managerRows] = await Promise.all([
        apiFetch<ManagedUser[]>("/users"),
        apiFetch<Gestionnaire[]>("/managers"),
      ]);
      setUsers(userRows);
      setManagers(managerRows);
      setDrafts(Object.fromEntries(userRows.map((user) => [user.id, toDraft(user)])));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Impossible de charger les utilisateurs.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const save = async (userId: string) => {
    const draft = drafts[userId];
    if (!draft?.displayName.trim()) return;
    setBusyId(userId);
    setError(null);
    setNotice(null);
    try {
      await apiFetch(`/users/${userId}`, { method: "PUT", json: payload(draft) });
      setNotice("Utilisateur mis à jour. Les nouveaux droits s’appliqueront à sa prochaine connexion.");
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Impossible d’enregistrer l’utilisateur.");
    } finally {
      setBusyId(null);
    }
  };

  const create = async () => {
    if (!newDraft.displayName.trim()) return;
    setBusyId("new");
    setError(null);
    setNotice(null);
    try {
      await apiFetch("/users", { method: "POST", json: payload(newDraft) });
      setNewDraft(emptyDraft());
      setNotice("Utilisateur ajouté.");
      await load();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Impossible d’ajouter l’utilisateur.");
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (user: ManagedUser) => {
    if (!window.confirm(`Supprimer l’utilisateur « ${user.displayName} » ?`)) return;
    setBusyId(user.id);
    setError(null);
    try {
      await apiFetch(`/users/${user.id}`, { method: "DELETE" });
      setNotice("Utilisateur supprimé.");
      await load();
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : "Impossible de supprimer l’utilisateur.");
    } finally {
      setBusyId(null);
    }
  };

  const managerOptions = (selectedId: string) => managers.filter((manager) =>
    manager.id === selectedId || !linkedManagerIds.has(manager.id),
  );

  return (
    <section id="settings-users" className="settings-cluster" aria-labelledby="nav-settings-users">
      <div className="settings-cluster__header">
        <div><div className="settings-cluster__eyebrow">Accès</div><h2 className="settings-cluster__title">Utilisateurs et privilèges</h2></div>
        <p className="settings-cluster__text">Chaque connexion identifie une personne. Un utilisateur peut être relié à un propriétaire/gestionnaire déjà associé aux gîtes.</p>
      </div>
      <div className="settings-cluster__grid">
        <div className="card settings-card settings-card--blue settings-card--span-12">
          <div className="section-title">Ajouter un utilisateur</div>
          <div className="grid-2 user-settings-form">
            <label className="field">Nom affiché<input value={newDraft.displayName} onChange={(event) => setNewDraft({ ...newDraft, displayName: event.target.value })} /></label>
            <label className="field">Propriétaire / gestionnaire lié<select value={newDraft.gestionnaireId} onChange={(event) => setNewDraft({ ...newDraft, gestionnaireId: event.target.value })}><option value="">Aucun lien</option>{managerOptions(newDraft.gestionnaireId).map((manager) => <option key={manager.id} value={manager.id}>{manager.prenom} {manager.nom}</option>)}</select></label>
          </div>
          <PermissionFields draft={newDraft} onChange={setNewDraft} />
          <div className="actions"><button type="button" disabled={busyId === "new" || !newDraft.displayName.trim()} onClick={() => void create()}>{busyId === "new" ? "Ajout..." : "Ajouter"}</button></div>
        </div>
        <div className="settings-card--span-12 user-settings-list">
          {loading ? <div className="card">Chargement...</div> : users.map((user) => {
            const draft = drafts[user.id] ?? toDraft(user);
            return <article key={user.id} className="card settings-card settings-card--neutral user-settings-card">
              <div className="settings-card__topline"><span className="settings-card__tag">{user.permissions.isOwner ? "Propriétaire" : "Utilisateur"}</span><span className="settings-card__badge">{user.isActive ? "Actif" : "Inactif"}</span></div>
              <div className="grid-2 user-settings-form">
                <label className="field">Nom affiché<input value={draft.displayName} onChange={(event) => setDrafts((current) => ({ ...current, [user.id]: { ...draft, displayName: event.target.value } }))} /></label>
                <label className="field">Propriétaire / gestionnaire lié<select value={draft.gestionnaireId} onChange={(event) => setDrafts((current) => ({ ...current, [user.id]: { ...draft, gestionnaireId: event.target.value } }))}><option value="">Aucun lien</option>{managerOptions(draft.gestionnaireId).map((manager) => <option key={manager.id} value={manager.id}>{manager.prenom} {manager.nom}</option>)}</select></label>
              </div>
              <PermissionFields draft={draft} onChange={(next) => setDrafts((current) => ({ ...current, [user.id]: next }))} />
              <div className="actions"><button type="button" disabled={busyId === user.id} onClick={() => void save(user.id)}>{busyId === user.id ? "Enregistrement..." : "Enregistrer"}</button><button type="button" className="secondary" disabled={busyId === user.id || user.id === currentUserId} onClick={() => void remove(user)}>Supprimer</button></div>
            </article>;
          })}
        </div>
      </div>
      {notice ? <div className="note note--success">{notice}</div> : null}
      {error ? <div className="note">{error}</div> : null}
    </section>
  );
};

export default UserSettings;
