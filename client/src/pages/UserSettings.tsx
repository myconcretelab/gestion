import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../utils/api";
import { APP_PAGES, type AppPageId, type AppUser, type AppUserStatus } from "../utils/auth";
import type { Gestionnaire } from "../utils/types";
import ReservationDetailsDrawer from "./shared/ReservationDetailsDrawer";

type WorkerProfile = { id?: string; telephone: string; email: string | null; adresse: string | null; telegramChatId: string | null; hourlyRate: number; showOnToday: boolean };
type ManagedUser = AppUser & {
  gestionnaire?: { id: string; prenom: string; nom: string; gitesCount: number } | null;
  intervenant?: WorkerProfile | null;
};
type UserDraft = {
  displayName: string; gestionnaireId: string; status: AppUserStatus; canWrite: boolean;
  canViewAmounts: boolean; isActive: boolean; pageAccess: AppPageId[]; telephone: string;
  email: string; adresse: string; telegramChatId: string; hourlyRate: string; showOnToday: boolean;
  hasWorkerProfile: boolean;
};
type StatusPreset = {
  status: AppUserStatus; canWrite: boolean; canViewAmounts: boolean; pageAccess: AppPageId[]; locked: boolean;
};
type StatusPresetMap = Record<AppUserStatus, StatusPreset>;

const ALL_PAGES = APP_PAGES.map(({ id }) => id);
const STATUS_LABELS: Record<AppUserStatus, string> = { owner: "Propriétaire", worker: "Intervenant", custom: "Personnalisé" };
const DEFAULT_STATUS_PRESETS: StatusPresetMap = {
  owner: { status: "owner", canWrite: true, canViewAmounts: true, pageAccess: ALL_PAGES, locked: true },
  worker: { status: "worker", canWrite: true, canViewAmounts: false, pageAccess: ["today", "calendar", "planning_relay"], locked: false },
  custom: { status: "custom", canWrite: false, canViewAmounts: false, pageAccess: [], locked: false },
};
const emptyDraft = (presets: StatusPresetMap = DEFAULT_STATUS_PRESETS): UserDraft => ({
  displayName: "", gestionnaireId: "", status: "custom", isActive: true,
  canWrite: presets.custom.canWrite, canViewAmounts: presets.custom.canViewAmounts, pageAccess: presets.custom.pageAccess,
  telephone: "", email: "", adresse: "", telegramChatId: "", hourlyRate: "", showOnToday: true,
  hasWorkerProfile: false,
});
const toDraft = (user: ManagedUser): UserDraft => ({
  displayName: user.displayName, gestionnaireId: user.gestionnaireId ?? "", status: user.status,
  canWrite: user.permissions.canWrite, canViewAmounts: user.permissions.canViewAmounts, isActive: user.isActive,
  pageAccess: user.permissions.isOwner ? ALL_PAGES : user.pageAccess, telephone: user.intervenant?.telephone ?? "",
  email: user.intervenant?.email ?? "", adresse: user.intervenant?.adresse ?? "", telegramChatId: user.intervenant?.telegramChatId ?? "",
  hourlyRate: user.intervenant?.hourlyRate ? String(user.intervenant.hourlyRate).replace(".", ",") : "", showOnToday: user.intervenant?.showOnToday ?? true,
  hasWorkerProfile: Boolean(user.intervenant),
});
const buildPayload = (draft: UserDraft) => ({
  displayName: draft.displayName.trim(), gestionnaireId: draft.gestionnaireId || null, status: draft.status,
  canWrite: draft.status === "owner" ? true : draft.canWrite, canViewAmounts: draft.status === "owner" ? true : draft.canViewAmounts,
  isActive: draft.isActive, pageAccess: draft.status === "owner" ? ALL_PAGES : draft.pageAccess,
  workerProfile: draft.status === "worker" || draft.hasWorkerProfile ? {
    telephone: draft.telephone.trim(), email: draft.email.trim() || null, adresse: draft.adresse.trim() || null,
    telegramChatId: draft.telegramChatId.trim() || null, hourlyRate: Number(draft.hourlyRate.replace(",", ".")) || 0,
    showOnToday: draft.showOnToday,
  } : null,
});
const applyStatus = (draft: UserDraft, status: AppUserStatus, presets: StatusPresetMap): UserDraft => ({
  ...draft, status, canWrite: presets[status].canWrite, canViewAmounts: presets[status].canViewAmounts,
  pageAccess: presets[status].pageAccess, hasWorkerProfile: status === "worker" ? true : draft.hasWorkerProfile,
});

function StatusPresetEditor({ preset, disabled, onChange }: {
  preset: StatusPreset; disabled: boolean; onChange: (preset: StatusPreset) => void;
}) {
  const togglePage = (page: AppPageId, checked: boolean) => onChange({
    ...preset, pageAccess: checked ? [...new Set([...preset.pageAccess, page])] : preset.pageAccess.filter((item) => item !== page),
  });
  return <div className="user-editor status-preset-editor">
    <p className="contract-return-drawer__intro">L’enregistrement applique ces droits à tous les utilisateurs ayant ce statut.</p>
    <fieldset className="user-editor__fieldset contract-return-drawer__section"><legend>Droits</legend><div className="user-permissions">
      <label className="checkbox-row"><input type="checkbox" checked={preset.canWrite} disabled={disabled} onChange={(e) => onChange({ ...preset, canWrite: e.target.checked })} /><span><strong>Écriture</strong><small>Créer, modifier et supprimer.</small></span></label>
      <label className="checkbox-row"><input type="checkbox" checked={preset.canViewAmounts} disabled={disabled} onChange={(e) => onChange({ ...preset, canViewAmounts: e.target.checked })} /><span><strong>Montants en euros</strong><small>Afficher tous les chiffres financiers.</small></span></label>
    </div></fieldset>
    <fieldset className="user-editor__fieldset contract-return-drawer__section"><legend>Pages visibles</legend><div className="user-page-access">
      {APP_PAGES.map((page) => <label className="checkbox-row" key={page.id}><input type="checkbox" checked={preset.pageAccess.includes(page.id)} disabled={disabled} onChange={(e) => togglePage(page.id, e.target.checked)} /><span>{page.label}</span></label>)}
    </div></fieldset>
  </div>;
}

function UserEditor({ draft, managers, linkedManagerIds, statusPresets, disabled, onChange }: {
  draft: UserDraft; managers: Gestionnaire[]; linkedManagerIds: Set<string | null>; disabled: boolean;
  statusPresets: StatusPresetMap; onChange: (draft: UserDraft) => void;
}) {
  const owner = draft.status === "owner";
  const managerOptions = managers.filter((manager) => manager.id === draft.gestionnaireId || !linkedManagerIds.has(manager.id));
  const togglePage = (page: AppPageId, checked: boolean) => onChange({
    ...draft, pageAccess: checked ? [...new Set([...draft.pageAccess, page])] : draft.pageAccess.filter((item) => item !== page),
  });
  return <div className="user-editor">
    <div className="grid-2 user-settings-form">
      <label className="field">Nom affiché<input value={draft.displayName} disabled={disabled} onChange={(e) => onChange({ ...draft, displayName: e.target.value })} /></label>
      <label className="field">Statut<select value={draft.status} disabled={disabled} onChange={(e) => onChange(applyStatus(draft, e.target.value as AppUserStatus, statusPresets))}>
        <option value="owner">Propriétaire</option><option value="worker">Intervenant</option><option value="custom">Personnalisé</option>
      </select></label>
      <label className="field">Propriétaire / gestionnaire lié<select value={draft.gestionnaireId} disabled={disabled} onChange={(e) => onChange({ ...draft, gestionnaireId: e.target.value })}>
        <option value="">Aucun lien</option>{managerOptions.map((manager) => <option key={manager.id} value={manager.id}>{manager.prenom} {manager.nom}</option>)}
      </select></label>
    </div>
    {draft.status !== "worker" ? <label className="checkbox-row user-worker-profile-toggle"><input type="checkbox" checked={draft.hasWorkerProfile} disabled={disabled} onChange={(e) => onChange({ ...draft, hasWorkerProfile: e.target.checked })} /><span><strong>Cette personne est aussi intervenante</strong><small>Ajouter ses coordonnées au planning relais et à la saisie des heures.</small></span></label> : null}
    {draft.status === "worker" || draft.hasWorkerProfile ? <fieldset className="user-editor__fieldset"><legend>Profil intervenant</legend><div className="grid-2">
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
  </div>;
}

const isUserDraftValid = (draft: UserDraft) =>
  Boolean(draft.displayName.trim()) && (!((draft.status === "worker" || draft.hasWorkerProfile) && !draft.telephone.trim()));

const UserSettings = ({ currentUserId }: { currentUserId: string | null }) => {
  const [users, setUsers] = useState<ManagedUser[]>([]); const [managers, setManagers] = useState<Gestionnaire[]>([]);
  const [statusPresets, setStatusPresets] = useState<StatusPresetMap>(DEFAULT_STATUS_PRESETS);
  const [presetDrafts, setPresetDrafts] = useState<StatusPresetMap>(DEFAULT_STATUS_PRESETS); const [selectedStatus, setSelectedStatus] = useState<AppUserStatus | null>(null);
  const [drafts, setDrafts] = useState<Record<string, UserDraft>>({}); const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newDraft, setNewDraft] = useState<UserDraft>(emptyDraft); const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(true); const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null); const [notice, setNotice] = useState<string | null>(null);
  const linkedManagerIds = useMemo(() => new Set(users.map((user) => user.gestionnaireId)), [users]);
  const load = async () => {
    setLoading(true); setError(null);
    try {
      const [userRows, managerRows, presetRows] = await Promise.all([apiFetch<ManagedUser[]>("/users"), apiFetch<Gestionnaire[]>("/managers"), apiFetch<StatusPreset[]>("/users/status-presets")]);
      const nextPresets = { ...DEFAULT_STATUS_PRESETS, ...Object.fromEntries(presetRows.map((preset) => [preset.status, preset])) } as StatusPresetMap;
      setUsers(userRows); setManagers(managerRows); setStatusPresets(nextPresets); setPresetDrafts(nextPresets); setNewDraft(emptyDraft(nextPresets)); setDrafts(Object.fromEntries(userRows.map((user) => [user.id, toDraft(user)])));
      setSelectedId((current) => current && userRows.some((user) => user.id === current) ? current : null);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Impossible de charger les utilisateurs."); }
    finally { setLoading(false); }
  };
  const savePreset = async (status: AppUserStatus) => {
    if (status === "owner") return;
    setBusyId(`status-${status}`); setError(null); setNotice(null);
    try {
      const preset = presetDrafts[status];
      await apiFetch(`/users/status-presets/${status}`, { method: "PUT", json: { canWrite: preset.canWrite, canViewAmounts: preset.canViewAmounts, pageAccess: preset.pageAccess } });
      setSelectedStatus(null); setNotice(`Droits du statut ${STATUS_LABELS[status]} mis à jour.`); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Impossible d’enregistrer les droits du statut."); }
    finally { setBusyId(null); }
  };
  useEffect(() => { void load(); }, []);
  const save = async (id: string) => {
    setBusyId(id); setError(null); setNotice(null);
    try { await apiFetch(`/users/${id}`, { method: "PUT", json: buildPayload(drafts[id]) }); setSelectedId(null); setNotice("Utilisateur mis à jour."); await load(); }
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
    <div className="card user-list-card"><div className="user-list-toolbar"><div><div className="section-title">Droits par statut</div><span className="field-hint">Les propriétaires ont toujours tous les droits.</span></div></div>
      <div className="table-wrap"><table className="table user-list-table status-preset-table"><thead><tr><th>Statut</th><th>Droits</th><th>Pages</th><th className="table-actions-cell">Actions</th></tr></thead><tbody>
        {(["owner", "worker", "custom"] as AppUserStatus[]).map((status) => { const preset = statusPresets[status]; return <tr key={status} className={selectedStatus === status ? "is-selected" : ""}><td><strong>{STATUS_LABELS[status]}</strong></td><td>{preset.canWrite ? "Écriture" : "Lecture"}{preset.canViewAmounts ? " · €" : " · sans €"}</td><td>{status === "owner" ? "Toutes" : `${preset.pageAccess.length} / ${APP_PAGES.length}`}</td><td className="table-actions-cell">{preset.locked ? <span className="field-hint">Fixe</span> : <button type="button" className="table-action" onClick={() => { setError(null); setSelectedStatus(status); setSelectedId(null); setCreating(false); }}>Modifier</button>}</td></tr>; })}
      </tbody></table></div>
    </div>
    <div className="card user-list-card"><div className="user-list-toolbar"><div><div className="section-title">Utilisateurs</div><span className="field-hint">{users.filter((user) => user.isActive).length} actif(s) sur {users.length}</span></div><button type="button" onClick={() => { setError(null); setCreating(true); setSelectedId(null); setSelectedStatus(null); }}>Ajouter un utilisateur</button></div>
      {loading ? <div className="field-hint">Chargement…</div> : <div className="table-wrap"><table className="table user-list-table"><thead><tr><th>Utilisateur</th><th>Statut</th><th>Droits</th><th>Pages</th><th>État</th><th className="table-actions-cell">Actions</th></tr></thead><tbody>
        {users.map((user) => <tr key={user.id} className={selectedId === user.id ? "is-selected" : ""}><td><strong>{user.displayName}</strong>{user.intervenant?.telephone ? <small>{user.intervenant.telephone}</small> : null}</td><td><span className="badge">{STATUS_LABELS[user.status]}</span></td><td>{user.permissions.canWrite ? "Écriture" : "Lecture"}{user.permissions.canViewAmounts ? " · €" : " · sans €"}</td><td>{user.permissions.isOwner ? "Toutes" : `${user.pageAccess.length} / ${APP_PAGES.length}`}</td><td>{user.isActive ? "Actif" : "Inactif"}</td><td className="table-actions-cell"><button type="button" className="table-action" onClick={() => { setError(null); setSelectedId(user.id); setCreating(false); setSelectedStatus(null); }}>Modifier</button><button type="button" className="table-action table-action--danger" disabled={busyId === user.id || user.id === currentUserId} onClick={() => void remove(user)}>Supprimer</button></td></tr>)}
      </tbody></table></div>}
    </div>
    <ReservationDetailsDrawer
      open={Boolean(selectedStatus && selectedStatus !== "owner")}
      title={selectedStatus ? `Droits du statut ${STATUS_LABELS[selectedStatus]}` : "Droits du statut"}
      eyebrow="Statut utilisateur"
      summary={["Modèle appliqué à tous les utilisateurs concernés"]}
      busy={Boolean(selectedStatus && busyId === `status-${selectedStatus}`)}
      onClose={() => { setSelectedStatus(null); setPresetDrafts(statusPresets); }}
      footer={selectedStatus && selectedStatus !== "owner" ? <>
        <button type="button" className="secondary" disabled={busyId === `status-${selectedStatus}`} onClick={() => { setSelectedStatus(null); setPresetDrafts(statusPresets); }}>Annuler</button>
        <button type="button" disabled={busyId === `status-${selectedStatus}`} onClick={() => void savePreset(selectedStatus)}>{busyId === `status-${selectedStatus}` ? "Enregistrement…" : "Enregistrer"}</button>
      </> : null}
    >
      {error ? <div className="note">{error}</div> : null}
      {selectedStatus && selectedStatus !== "owner" ? <StatusPresetEditor preset={presetDrafts[selectedStatus]} disabled={busyId === `status-${selectedStatus}`} onChange={(preset) => setPresetDrafts((current) => ({ ...current, [selectedStatus]: preset }))} /> : null}
    </ReservationDetailsDrawer>
    <ReservationDetailsDrawer
      open={creating}
      title="Nouvel utilisateur"
      eyebrow="Utilisateurs et privilèges"
      summary={[`Droits proposés par le statut ${STATUS_LABELS[newDraft.status]}`]}
      busy={busyId === "new"}
      onClose={() => { setCreating(false); setNewDraft(emptyDraft(statusPresets)); }}
      footer={<>
        <button type="button" className="secondary" disabled={busyId === "new"} onClick={() => { setCreating(false); setNewDraft(emptyDraft(statusPresets)); }}>Annuler</button>
        <button type="button" disabled={busyId === "new" || !isUserDraftValid(newDraft)} onClick={() => void create()}>{busyId === "new" ? "Ajout…" : "Ajouter"}</button>
      </>}
    >
      {error ? <div className="note">{error}</div> : null}
      <UserEditor draft={newDraft} managers={managers} linkedManagerIds={linkedManagerIds} statusPresets={statusPresets} disabled={busyId === "new"} onChange={setNewDraft} />
    </ReservationDetailsDrawer>
    <ReservationDetailsDrawer
      open={Boolean(selected)}
      title={selected?.displayName ?? "Utilisateur"}
      eyebrow={selected ? STATUS_LABELS[selected.status] : "Utilisateur"}
      summary={selected ? [selected.isActive ? "Compte actif" : "Compte inactif", selected.permissions.isOwner ? "Toutes les pages" : `${selected.pageAccess.length} page(s) visible(s)`] : []}
      busy={Boolean(selected && busyId === selected.id)}
      onClose={() => setSelectedId(null)}
      footer={selected ? <>
        <button type="button" className="secondary" disabled={busyId === selected.id} onClick={() => setSelectedId(null)}>Annuler</button>
        <button type="button" disabled={busyId === selected.id || !isUserDraftValid(drafts[selected.id] ?? toDraft(selected))} onClick={() => void save(selected.id)}>{busyId === selected.id ? "Enregistrement…" : "Enregistrer"}</button>
      </> : null}
    >
      {error ? <div className="note">{error}</div> : null}
      {selected ? <UserEditor draft={drafts[selected.id] ?? toDraft(selected)} managers={managers} linkedManagerIds={linkedManagerIds} statusPresets={statusPresets} disabled={busyId === selected.id} onChange={(draft) => setDrafts((current) => ({ ...current, [selected.id]: draft }))} /> : null}
    </ReservationDetailsDrawer>
  </section>;
};
export default UserSettings;
