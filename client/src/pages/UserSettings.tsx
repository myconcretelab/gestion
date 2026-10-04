import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../utils/api";
import { APP_PAGES, type AppPageId, type AppUser, type AppUserStatus } from "../utils/auth";
import type { Gestionnaire } from "../utils/types";

type WorkerProfile = { id?: string; telephone: string; email: string | null; adresse: string | null; telegramChatId: string | null; hourlyRate: number; showOnToday: boolean };
type ManagedUser = AppUser & {
  gestionnaire?: { id: string; prenom: string; nom: string; gitesCount: number } | null;
  intervenant?: WorkerProfile | null;
};
type UserDraft = {
  displayName: string; gestionnaireId: string; status: AppUserStatus; canWrite: boolean;
  canViewAmounts: boolean; isActive: boolean; pageAccess: AppPageId[]; telephone: string;
  email: string; adresse: string; telegramChatId: string; hourlyRate: string; showOnToday: boolean;
};

const ALL_PAGES = APP_PAGES.map(({ id }) => id);
const STATUS_LABELS: Record<AppUserStatus, string> = { owner: "Propriétaire", worker: "Intervenant", custom: "Personnalisé" };
const STATUS_PRESETS: Record<AppUserStatus, Pick<UserDraft, "canWrite" | "canViewAmounts" | "pageAccess">> = {
  owner: { canWrite: true, canViewAmounts: true, pageAccess: ALL_PAGES },
  worker: { canWrite: true, canViewAmounts: false, pageAccess: ["today", "calendar", "planning_relay"] },
  custom: { canWrite: false, canViewAmounts: false, pageAccess: [] },
};
const emptyDraft = (): UserDraft => ({
  displayName: "", gestionnaireId: "", status: "custom", isActive: true, ...STATUS_PRESETS.custom,
  telephone: "", email: "", adresse: "", telegramChatId: "", hourlyRate: "", showOnToday: true,
});
const toDraft = (user: ManagedUser): UserDraft => ({
  displayName: user.displayName, gestionnaireId: user.gestionnaireId ?? "", status: user.status,
  canWrite: user.permissions.canWrite, canViewAmounts: user.permissions.canViewAmounts, isActive: user.isActive,
  pageAccess: user.permissions.isOwner ? ALL_PAGES : user.pageAccess, telephone: user.intervenant?.telephone ?? "",
  email: user.intervenant?.email ?? "", adresse: user.intervenant?.adresse ?? "", telegramChatId: user.intervenant?.telegramChatId ?? "",
  hourlyRate: user.intervenant?.hourlyRate ? String(user.intervenant.hourlyRate).replace(".", ",") : "", showOnToday: user.intervenant?.showOnToday ?? true,
});
const buildPayload = (draft: UserDraft) => ({
  displayName: draft.displayName.trim(), gestionnaireId: draft.gestionnaireId || null, status: draft.status,
  canWrite: draft.status === "owner" ? true : draft.canWrite, canViewAmounts: draft.status === "owner" ? true : draft.canViewAmounts,
  isActive: draft.isActive, pageAccess: draft.status === "owner" ? ALL_PAGES : draft.pageAccess,
  workerProfile: draft.status === "worker" ? {
    telephone: draft.telephone.trim(), email: draft.email.trim() || null, adresse: draft.adresse.trim() || null,
    telegramChatId: draft.telegramChatId.trim() || null, hourlyRate: Number(draft.hourlyRate.replace(",", ".")) || 0,
    showOnToday: draft.showOnToday,
  } : null,
});
const applyStatus = (draft: UserDraft, status: AppUserStatus): UserDraft => ({ ...draft, status, ...STATUS_PRESETS[status] });

function UserEditor({ draft, managers, linkedManagerIds, disabled, submitLabel, onChange, onSubmit }: {
  draft: UserDraft; managers: Gestionnaire[]; linkedManagerIds: Set<string | null>; disabled: boolean;
  submitLabel: string; onChange: (draft: UserDraft) => void; onSubmit: () => void;
}) {
  const owner = draft.status === "owner";
  const managerOptions = managers.filter((manager) => manager.id === draft.gestionnaireId || !linkedManagerIds.has(manager.id));
  const togglePage = (page: AppPageId, checked: boolean) => onChange({
    ...draft, pageAccess: checked ? [...new Set([...draft.pageAccess, page])] : draft.pageAccess.filter((item) => item !== page),
  });
  return <div className="user-editor">
    <div className="grid-2 user-settings-form">
      <label className="field">Nom affiché<input value={draft.displayName} disabled={disabled} onChange={(e) => onChange({ ...draft, displayName: e.target.value })} /></label>
      <label className="field">Statut<select value={draft.status} disabled={disabled} onChange={(e) => onChange(applyStatus(draft, e.target.value as AppUserStatus))}>
        <option value="owner">Propriétaire</option><option value="worker">Intervenant</option><option value="custom">Personnalisé</option>
      </select></label>
      <label className="field">Propriétaire / gestionnaire lié<select value={draft.gestionnaireId} disabled={disabled} onChange={(e) => onChange({ ...draft, gestionnaireId: e.target.value })}>
        <option value="">Aucun lien</option>{managerOptions.map((manager) => <option key={manager.id} value={manager.id}>{manager.prenom} {manager.nom}</option>)}
      </select></label>
    </div>
    {draft.status === "worker" ? <fieldset className="user-editor__fieldset"><legend>Profil intervenant</legend><div className="grid-2">
      <label className="field">Téléphone<input type="tel" value={draft.telephone} disabled={disabled} onChange={(e) => onChange({ ...draft, telephone: e.target.value })} /></label>
      <label className="field">Email<input type="email" value={draft.email} disabled={disabled} onChange={(e) => onChange({ ...draft, email: e.target.value })} /></label>
      <label className="field">Identifiant Telegram<input value={draft.telegramChatId} disabled={disabled} onChange={(e) => onChange({ ...draft, telegramChatId: e.target.value })} /></label>
      <label className="field">Taux horaire (€)<input inputMode="decimal" value={draft.hourlyRate} disabled={disabled} onChange={(e) => onChange({ ...draft, hourlyRate: e.target.value })} /></label>
      <label className="field">Adresse<textarea rows={2} value={draft.adresse} disabled={disabled} onChange={(e) => onChange({ ...draft, adresse: e.target.value })} /></label>
      <label className="checkbox-row"><input type="checkbox" checked={draft.showOnToday} disabled={disabled} onChange={(e) => onChange({ ...draft, showOnToday: e.target.checked })} /><span>Afficher sur Aujourd’hui pour saisir les heures</span></label>
    </div></fieldset> : null}
    <fieldset className="user-editor__fieldset"><legend>Droits</legend><div className="user-permissions">
      <label className="checkbox-row"><input type="checkbox" checked={owner || draft.canWrite} disabled={disabled || owner} onChange={(e) => onChange({ ...draft, canWrite: e.target.checked })} /><span><strong>Écriture</strong><small>Créer, modifier et supprimer.</small></span></label>
      <label className="checkbox-row"><input type="checkbox" checked={owner || draft.canViewAmounts} disabled={disabled || owner} onChange={(e) => onChange({ ...draft, canViewAmounts: e.target.checked })} /><span><strong>Montants en euros</strong><small>Afficher tous les chiffres financiers.</small></span></label>
      <label className="checkbox-row"><input type="checkbox" checked={draft.isActive} disabled={disabled} onChange={(e) => onChange({ ...draft, isActive: e.target.checked })} /><span><strong>Compte actif</strong><small>Disponible sur l’écran de connexion.</small></span></label>
    </div></fieldset>
    <fieldset className="user-editor__fieldset"><legend>Pages visibles</legend><div className="user-page-access">
      {APP_PAGES.map((page) => <label className="checkbox-row" key={page.id}><input type="checkbox" checked={owner || draft.pageAccess.includes(page.id)} disabled={disabled || owner} onChange={(e) => togglePage(page.id, e.target.checked)} /><span>{page.label}</span></label>)}
    </div>{owner ? <p className="field-hint">Les propriétaires ont toujours accès à toutes les pages.</p> : null}</fieldset>
    <div className="actions"><button type="button" disabled={disabled || !draft.displayName.trim() || (draft.status === "worker" && !draft.telephone.trim())} onClick={onSubmit}>{submitLabel}</button></div>
  </div>;
}

const UserSettings = ({ currentUserId }: { currentUserId: string | null }) => {
  const [users, setUsers] = useState<ManagedUser[]>([]); const [managers, setManagers] = useState<Gestionnaire[]>([]);
  const [drafts, setDrafts] = useState<Record<string, UserDraft>>({}); const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newDraft, setNewDraft] = useState<UserDraft>(emptyDraft); const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(true); const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null); const [notice, setNotice] = useState<string | null>(null);
  const linkedManagerIds = useMemo(() => new Set(users.map((user) => user.gestionnaireId)), [users]);
  const load = async () => {
    setLoading(true); setError(null);
    try {
      const [userRows, managerRows] = await Promise.all([apiFetch<ManagedUser[]>("/users"), apiFetch<Gestionnaire[]>("/managers")]);
      setUsers(userRows); setManagers(managerRows); setDrafts(Object.fromEntries(userRows.map((user) => [user.id, toDraft(user)])));
      setSelectedId((current) => current && userRows.some((user) => user.id === current) ? current : null);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Impossible de charger les utilisateurs."); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);
  const save = async (id: string) => {
    setBusyId(id); setError(null); setNotice(null);
    try { await apiFetch(`/users/${id}`, { method: "PUT", json: buildPayload(drafts[id]) }); setNotice("Utilisateur mis à jour."); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Impossible d’enregistrer l’utilisateur."); } finally { setBusyId(null); }
  };
  const create = async () => {
    setBusyId("new"); setError(null); setNotice(null);
    try { await apiFetch("/users", { method: "POST", json: buildPayload(newDraft) }); setNewDraft(emptyDraft()); setCreating(false); setNotice("Utilisateur ajouté."); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Impossible d’ajouter l’utilisateur."); } finally { setBusyId(null); }
  };
  const remove = async (user: ManagedUser) => {
    if (!confirm(`Supprimer l’utilisateur « ${user.displayName} » ?`)) return;
    setBusyId(user.id); setError(null);
    try { await apiFetch(`/users/${user.id}`, { method: "DELETE" }); setNotice("Utilisateur supprimé."); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Impossible de supprimer l’utilisateur."); } finally { setBusyId(null); }
  };
  const selected = users.find((user) => user.id === selectedId) ?? null;
  return <section id="settings-users" className="settings-cluster" aria-labelledby="nav-settings-users">
    <div className="settings-cluster__header"><div><div className="settings-cluster__eyebrow">Accès</div><h2 className="settings-cluster__title">Utilisateurs et privilèges</h2></div><p className="settings-cluster__text">Les statuts proposent des droits par défaut, ensuite modifiables. Les profils intervenants et leurs coordonnées sont gérés ici.</p></div>
    {notice ? <div className="note note--success">{notice}</div> : null}{error ? <div className="note">{error}</div> : null}
    <div className="card user-list-card"><div className="user-list-toolbar"><div><div className="section-title">Utilisateurs</div><span className="field-hint">{users.filter((user) => user.isActive).length} actif(s) sur {users.length}</span></div><button type="button" onClick={() => { setCreating(true); setSelectedId(null); }}>Ajouter un utilisateur</button></div>
      {loading ? <div className="field-hint">Chargement…</div> : <div className="table-wrap"><table className="table user-list-table"><thead><tr><th>Utilisateur</th><th>Statut</th><th>Droits</th><th>Pages</th><th>État</th><th className="table-actions-cell">Actions</th></tr></thead><tbody>
        {users.map((user) => <tr key={user.id} className={selectedId === user.id ? "is-selected" : ""}><td><strong>{user.displayName}</strong>{user.intervenant?.telephone ? <small>{user.intervenant.telephone}</small> : null}</td><td><span className="badge">{STATUS_LABELS[user.status]}</span></td><td>{user.permissions.canWrite ? "Écriture" : "Lecture"}{user.permissions.canViewAmounts ? " · €" : " · sans €"}</td><td>{user.permissions.isOwner ? "Toutes" : `${user.pageAccess.length} / ${APP_PAGES.length}`}</td><td>{user.isActive ? "Actif" : "Inactif"}</td><td className="table-actions-cell"><button type="button" className="table-action" onClick={() => { setSelectedId(user.id); setCreating(false); }}>Modifier</button><button type="button" className="table-action table-action--danger" disabled={busyId === user.id || user.id === currentUserId} onClick={() => void remove(user)}>Supprimer</button></td></tr>)}
      </tbody></table></div>}
    </div>
    {creating ? <div className="card user-editor-card"><div className="section-title">Nouvel utilisateur</div><UserEditor draft={newDraft} managers={managers} linkedManagerIds={linkedManagerIds} disabled={busyId === "new"} submitLabel={busyId === "new" ? "Ajout…" : "Ajouter"} onChange={setNewDraft} onSubmit={() => void create()} /></div> : null}
    {selected ? <div className="card user-editor-card"><div className="user-editor-card__header"><div><span className="settings-card__tag">{STATUS_LABELS[selected.status]}</span><div className="section-title">Modifier {selected.displayName}</div></div><button type="button" className="secondary" onClick={() => setSelectedId(null)}>Fermer</button></div><UserEditor draft={drafts[selected.id] ?? toDraft(selected)} managers={managers} linkedManagerIds={linkedManagerIds} disabled={busyId === selected.id} submitLabel={busyId === selected.id ? "Enregistrement…" : "Enregistrer"} onChange={(draft) => setDrafts((current) => ({ ...current, [selected.id]: draft }))} onSubmit={() => void save(selected.id)} /></div> : null}
  </section>;
};
export default UserSettings;
