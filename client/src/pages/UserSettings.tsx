import { useEffect, useState } from "react";
import { apiFetch } from "../utils/api";
import { APP_PAGES, type AppPageId, type AppUser, type AppUserRole, type AppUserStatus } from "../utils/auth";
import ReservationDetailsDrawer from "./shared/ReservationDetailsDrawer";

type WorkerProfile = { id?: string; showOnToday: boolean };
type ManagedUser = AppUser & {
  gestionnaire?: { id: string; prenom: string; nom: string; gitesCount: number } | null;
  intervenant?: WorkerProfile | null;
};
type UserDraft = {
  firstName: string; lastName: string; roles: AppUserRole[]; canWrite: boolean;
  canViewAmounts: boolean; isActive: boolean; pageAccess: AppPageId[]; telephone: string;
  email: string; adresse: string; telegramChatId: string; hourlyRate: string;
  cleaningCheckRate: string; fullCleaningRate: string; showOnToday: boolean;
  loginId: string; password: string;
};
type StatusPreset = {
  status: AppUserStatus; canWrite: boolean; canViewAmounts: boolean; pageAccess: AppPageId[]; locked: boolean;
};
type StatusPresetMap = Record<AppUserStatus, StatusPreset>;

const ALL_PAGES = APP_PAGES.map(({ id }) => id);
const STATUS_LABELS: Record<AppUserStatus, string> = { owner: "Propriétaire / administrateur", worker: "Intervenant", custom: "Personnalisé" };
const ROLE_LABELS: Record<AppUserRole, string> = { owner: "Propriétaire / administrateur", worker: "Intervenant" };
const DEFAULT_STATUS_PRESETS: StatusPresetMap = {
  owner: { status: "owner", canWrite: true, canViewAmounts: true, pageAccess: ALL_PAGES, locked: true },
  worker: { status: "worker", canWrite: true, canViewAmounts: false, pageAccess: ["today", "calendar", "planning_relay"], locked: false },
  custom: { status: "custom", canWrite: false, canViewAmounts: false, pageAccess: [], locked: false },
};
const emptyDraft = (presets: StatusPresetMap = DEFAULT_STATUS_PRESETS): UserDraft => ({
  firstName: "", lastName: "", roles: [], isActive: true,
  canWrite: presets.custom.canWrite, canViewAmounts: presets.custom.canViewAmounts, pageAccess: presets.custom.pageAccess,
  telephone: "", email: "", adresse: "", telegramChatId: "", hourlyRate: "",
  cleaningCheckRate: "", fullCleaningRate: "", showOnToday: true,
  loginId: "", password: "",
});
const toDraft = (user: ManagedUser): UserDraft => ({
  firstName: user.firstName, lastName: user.lastName, roles: user.roles,
  canWrite: user.permissions.canWrite, canViewAmounts: user.permissions.canViewAmounts, isActive: user.isActive,
  pageAccess: user.permissions.isOwner ? ALL_PAGES : user.pageAccess, telephone: user.telephone ?? "",
  email: user.email ?? "", adresse: user.adresse ?? "", telegramChatId: user.telegramChatId ?? "",
  hourlyRate: user.hourlyRate ? String(user.hourlyRate).replace(".", ",") : "",
  cleaningCheckRate: user.cleaningCheckRate ? String(user.cleaningCheckRate).replace(".", ",") : "",
  fullCleaningRate: user.fullCleaningRate ? String(user.fullCleaningRate).replace(".", ",") : "",
  showOnToday: user.intervenant?.showOnToday ?? true,
  loginId: user.loginId ?? "", password: "",
});
const buildPayload = (draft: UserDraft) => ({
  firstName: draft.firstName.trim(), lastName: draft.lastName.trim(), roles: draft.roles,
  telephone: draft.telephone.trim(), email: draft.email.trim() || null, adresse: draft.adresse.trim() || null,
  telegramChatId: draft.telegramChatId.trim() || null,
  hourlyRate: Number(draft.hourlyRate.replace(",", ".")) || 0,
  cleaningCheckRate: Number(draft.cleaningCheckRate.replace(",", ".")) || 0,
  fullCleaningRate: Number(draft.fullCleaningRate.replace(",", ".")) || 0,
  canWrite: draft.roles.includes("owner") ? true : draft.canWrite, canViewAmounts: draft.roles.includes("owner") ? true : draft.canViewAmounts,
  isActive: draft.isActive, pageAccess: draft.roles.includes("owner") ? ALL_PAGES : draft.pageAccess,
  workerProfile: draft.roles.includes("worker") ? {
    showOnToday: draft.showOnToday,
  } : null,
});
const statusForRoles = (roles: AppUserRole[]): AppUserStatus => roles.includes("owner") ? "owner" : roles.includes("worker") ? "worker" : "custom";
const rolesLabel = (roles: AppUserRole[]) => roles.length ? roles.map((role) => ROLE_LABELS[role]).join(" · ") : STATUS_LABELS.custom;
const applyRole = (draft: UserDraft, role: AppUserRole, checked: boolean, presets: StatusPresetMap): UserDraft => {
  const roles = checked ? [...new Set([...draft.roles, role])] : draft.roles.filter((candidate) => candidate !== role);
  const status = statusForRoles(roles);
  return {
    ...draft,
    roles,
    canWrite: presets[status].canWrite,
    canViewAmounts: presets[status].canViewAmounts,
    pageAccess: presets[status].pageAccess,
  };
};

function SwitchRow({ checked, disabled, title, description, onChange }: {
  checked: boolean; disabled?: boolean; title: string; description?: string; onChange: (checked: boolean) => void;
}) {
  return <label className="user-switch-row"><span><strong>{title}</strong>{description ? <small>{description}</small> : null}</span><span className="switch switch--compact"><input role="switch" type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} /><span className="slider" /></span></label>;
}

function StatusPresetEditor({ preset, disabled, onChange }: {
  preset: StatusPreset; disabled: boolean; onChange: (preset: StatusPreset) => void;
}) {
  const togglePage = (page: AppPageId, checked: boolean) => onChange({
    ...preset, pageAccess: checked ? [...new Set([...preset.pageAccess, page])] : preset.pageAccess.filter((item) => item !== page),
  });
  return <div className="user-editor status-preset-editor">
    <p className="contract-return-drawer__intro">L’enregistrement applique ces droits à tous les utilisateurs ayant ce statut.</p>
    <fieldset className="user-editor__fieldset contract-return-drawer__section"><legend>Droits</legend><div className="user-permissions">
      <SwitchRow title="Écriture" description="Créer, modifier et supprimer." checked={preset.canWrite} disabled={disabled} onChange={(checked) => onChange({ ...preset, canWrite: checked })} />
      <SwitchRow title="Montants en euros" description="Afficher tous les chiffres financiers." checked={preset.canViewAmounts} disabled={disabled} onChange={(checked) => onChange({ ...preset, canViewAmounts: checked })} />
    </div></fieldset>
    <fieldset className="user-editor__fieldset contract-return-drawer__section"><legend>Pages visibles</legend><div className="user-page-access">
      {APP_PAGES.map((page) => <SwitchRow key={page.id} title={page.label} checked={preset.pageAccess.includes(page.id)} disabled={disabled} onChange={(checked) => togglePage(page.id, checked)} />)}
    </div></fieldset>
  </div>;
}

function UserEditor({ draft, statusPresets, disabled, onChange }: {
  draft: UserDraft; disabled: boolean;
  statusPresets: StatusPresetMap; onChange: (draft: UserDraft) => void;
}) {
  const owner = draft.roles.includes("owner");
  const worker = draft.roles.includes("worker");
  const togglePage = (page: AppPageId, checked: boolean) => onChange({
    ...draft, pageAccess: checked ? [...new Set([...draft.pageAccess, page])] : draft.pageAccess.filter((item) => item !== page),
  });
  return <div className="user-editor">
    <fieldset className="user-editor__fieldset"><legend>Identité et coordonnées</legend>
    <div className="grid-2 user-settings-form">
      <label className="field">Prénom<input value={draft.firstName} disabled={disabled} onChange={(e) => onChange({ ...draft, firstName: e.target.value })} /></label>
      <label className="field">Nom<input value={draft.lastName} disabled={disabled} onChange={(e) => onChange({ ...draft, lastName: e.target.value })} /></label>
      <label className="field">Téléphone<input type="tel" value={draft.telephone} disabled={disabled} onChange={(e) => onChange({ ...draft, telephone: e.target.value })} /></label>
      <label className="field">Email<input type="email" value={draft.email} disabled={disabled} onChange={(e) => onChange({ ...draft, email: e.target.value })} /></label>
      <label className="field">Identifiant de chat Telegram<input value={draft.telegramChatId} disabled={disabled} onChange={(e) => onChange({ ...draft, telegramChatId: e.target.value })} /></label>
      <label className="field">Adresse<textarea rows={2} value={draft.adresse} disabled={disabled} onChange={(e) => onChange({ ...draft, adresse: e.target.value })} /></label>
    </div>
    </fieldset>
    <fieldset className="user-editor__fieldset"><legend>Connexion personnelle</legend><div className="grid-2 user-settings-form">
      <label className="field">Identifiant de connexion<input autoComplete="off" value={draft.loginId} disabled={disabled} onChange={(e) => onChange({ ...draft, loginId: e.target.value })} /></label>
      <label className="field">{draft.loginId ? "Nouveau mot de passe (facultatif)" : "Mot de passe initial"}<input type="password" autoComplete="new-password" value={draft.password} disabled={disabled} onChange={(e) => onChange({ ...draft, password: e.target.value })} placeholder="12 caractères minimum" /></label>
    </div><p className="field-hint">Les propriétaires / administrateurs peuvent définir un nouveau mot de passe pour n’importe quel utilisateur. Le changement révoque toutes les sessions de ce compte.</p></fieldset>
    <fieldset className="user-editor__fieldset"><legend>Statuts</legend><div className="user-role-grid">
      <SwitchRow title="Propriétaire / administrateur" description="Accès complet, gestion des comptes et réinitialisation de tous les mots de passe." checked={owner} disabled={disabled} onChange={(checked) => onChange(applyRole(draft, "owner", checked, statusPresets))} />
      <SwitchRow title="Intervenant" description="Planning relais, saisie des heures et taux horaire." checked={worker} disabled={disabled} onChange={(checked) => onChange(applyRole(draft, "worker", checked, statusPresets))} />
    </div>{draft.roles.length === 0 ? <p className="field-hint">Sans statut métier, cet utilisateur conserve des droits personnalisés.</p> : null}</fieldset>
    {worker ? <fieldset className="user-editor__fieldset"><legend>Paramètres intervenant</legend><div className="grid-2">
      <label className="field">Taux horaire (€)<input inputMode="decimal" value={draft.hourlyRate} disabled={disabled} onChange={(e) => onChange({ ...draft, hourlyRate: e.target.value })} /></label>
      <label className="field">Forfait par contrôle ménage (€)<input inputMode="decimal" value={draft.cleaningCheckRate} disabled={disabled} onChange={(e) => onChange({ ...draft, cleaningCheckRate: e.target.value })} /></label>
      <label className="field">Forfait par ménage complet (€)<input inputMode="decimal" value={draft.fullCleaningRate} disabled={disabled} onChange={(e) => onChange({ ...draft, fullCleaningRate: e.target.value })} /></label>
      <SwitchRow title="Afficher sur Aujourd’hui" description="Permettre la saisie rapide des heures." checked={draft.showOnToday} disabled={disabled} onChange={(checked) => onChange({ ...draft, showOnToday: checked })} />
    </div></fieldset> : null}
    <fieldset className="user-editor__fieldset"><legend>Droits</legend><div className="user-permissions">
      <SwitchRow title="Écriture" description="Créer, modifier et supprimer." checked={owner || draft.canWrite} disabled={disabled || owner} onChange={(checked) => onChange({ ...draft, canWrite: checked })} />
      <SwitchRow title="Montants en euros" description="Afficher tous les chiffres financiers." checked={owner || draft.canViewAmounts} disabled={disabled || owner} onChange={(checked) => onChange({ ...draft, canViewAmounts: checked })} />
      <SwitchRow title="Compte actif" description="Disponible sur l’écran de connexion." checked={draft.isActive} disabled={disabled} onChange={(checked) => onChange({ ...draft, isActive: checked })} />
    </div></fieldset>
    <fieldset className="user-editor__fieldset"><legend>Pages visibles</legend><div className="user-page-access">
      {APP_PAGES.map((page) => <SwitchRow key={page.id} title={page.label} checked={owner || draft.pageAccess.includes(page.id)} disabled={disabled || owner} onChange={(checked) => togglePage(page.id, checked)} />)}
    </div>{owner ? <p className="field-hint">Les propriétaires ont toujours accès à toutes les pages.</p> : null}</fieldset>
  </div>;
}

const isUserDraftValid = (draft: UserDraft) =>
  Boolean(draft.firstName.trim()) && Boolean(draft.loginId.trim()) && (!draft.password || draft.password.length >= 12) && (!draft.roles.includes("worker") || Boolean(draft.telephone.trim()));

const UserSettings = ({ currentUserId }: { currentUserId: string | null }) => {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [statusPresets, setStatusPresets] = useState<StatusPresetMap>(DEFAULT_STATUS_PRESETS);
  const [presetDrafts, setPresetDrafts] = useState<StatusPresetMap>(DEFAULT_STATUS_PRESETS); const [selectedStatus, setSelectedStatus] = useState<AppUserStatus | null>(null);
  const [drafts, setDrafts] = useState<Record<string, UserDraft>>({}); const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newDraft, setNewDraft] = useState<UserDraft>(emptyDraft); const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(true); const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null); const [notice, setNotice] = useState<string | null>(null);
  const load = async () => {
    setLoading(true); setError(null);
    try {
      const [userRows, presetRows] = await Promise.all([apiFetch<ManagedUser[]>("/users"), apiFetch<StatusPreset[]>("/users/status-presets")]);
      const nextPresets = { ...DEFAULT_STATUS_PRESETS, ...Object.fromEntries(presetRows.map((preset) => [preset.status, preset])) } as StatusPresetMap;
      setUsers(userRows); setStatusPresets(nextPresets); setPresetDrafts(nextPresets); setNewDraft(emptyDraft(nextPresets)); setDrafts(Object.fromEntries(userRows.map((user) => [user.id, toDraft(user)])));
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
    try {
      const draft = drafts[id];
      await apiFetch(`/users/${id}`, { method: "PUT", json: buildPayload(draft) });
      await apiFetch(`/users/${id}/credentials`, { method: "PUT", json: { loginId: draft.loginId.trim(), ...(draft.password ? { password: draft.password } : {}) } });
      setSelectedId(null); setNotice("Utilisateur mis à jour."); await load();
    }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Impossible d’enregistrer l’utilisateur."); } finally { setBusyId(null); }
  };
  const create = async () => {
    setBusyId("new"); setError(null); setNotice(null);
    try {
      if (newDraft.password.length < 12) throw new Error("Le mot de passe initial doit contenir au moins 12 caractères.");
      const created = await apiFetch<ManagedUser>("/users", { method: "POST", json: buildPayload(newDraft) });
      await apiFetch(`/users/${created.id}/credentials`, { method: "PUT", json: { loginId: newDraft.loginId.trim(), password: newDraft.password } });
      setNewDraft(emptyDraft()); setCreating(false); setNotice("Utilisateur ajouté."); await load();
    }
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
    <div className="settings-cluster__header"><div><div className="settings-cluster__eyebrow">Accès</div><h2 className="settings-cluster__title">Utilisateurs et privilèges</h2></div><p className="settings-cluster__text">Toutes les informations des personnes, leurs statuts et leurs droits sont gérés ici. Les utilisateurs propriétaires sont ensuite proposés dans les fiches des gîtes.</p></div>
    {notice ? <div className="note note--success">{notice}</div> : null}{error ? <div className="note">{error}</div> : null}
    <div className="card user-list-card"><div className="user-list-toolbar"><div><div className="section-title">Droits par statut</div><span className="field-hint">Les propriétaires / administrateurs ont tous les droits et peuvent gérer les accès des autres utilisateurs.</span></div></div>
      <div className="table-wrap"><table className="table user-list-table status-preset-table"><thead><tr><th>Statut</th><th>Droits</th><th>Pages</th><th className="table-actions-cell">Actions</th></tr></thead><tbody>
        {(["owner", "worker", "custom"] as AppUserStatus[]).map((status) => { const preset = statusPresets[status]; return <tr key={status} className={selectedStatus === status ? "is-selected" : ""}><td><strong>{STATUS_LABELS[status]}</strong></td><td>{preset.canWrite ? "Écriture" : "Lecture"}{preset.canViewAmounts ? " · €" : " · sans €"}</td><td>{status === "owner" ? "Toutes" : `${preset.pageAccess.length} / ${APP_PAGES.length}`}</td><td className="table-actions-cell">{preset.locked ? <span className="field-hint">Fixe</span> : <button type="button" className="table-action" onClick={() => { setError(null); setSelectedStatus(status); setSelectedId(null); setCreating(false); }}>Modifier</button>}</td></tr>; })}
      </tbody></table></div>
    </div>
    <div className="card user-list-card"><div className="user-list-toolbar"><div><div className="section-title">Utilisateurs</div><span className="field-hint">{users.filter((user) => user.isActive).length} actif(s) sur {users.length}</span></div><button type="button" onClick={() => { setError(null); setCreating(true); setSelectedId(null); setSelectedStatus(null); }}>Ajouter un utilisateur</button></div>
      {loading ? <div className="field-hint">Chargement…</div> : <div className="table-wrap"><table className="table user-list-table"><thead><tr><th>Utilisateur</th><th>Statut</th><th>Droits</th><th>Pages</th><th>État</th><th className="table-actions-cell">Actions</th></tr></thead><tbody>
        {users.map((user) => <tr key={user.id} className={selectedId === user.id ? "is-selected" : ""}><td><strong>{user.displayName}</strong>{user.telephone ? <small>{user.telephone}</small> : user.gestionnaire?.gitesCount ? <small>{user.gestionnaire.gitesCount} gîte(s)</small> : null}</td><td><span className="badge">{rolesLabel(user.roles)}</span></td><td>{user.permissions.canWrite ? "Écriture" : "Lecture"}{user.permissions.canViewAmounts ? " · €" : " · sans €"}</td><td>{user.permissions.isOwner ? "Toutes" : `${user.pageAccess.length} / ${APP_PAGES.length}`}</td><td>{user.isActive ? "Actif" : "Inactif"}</td><td className="table-actions-cell"><button type="button" className="table-action" onClick={() => { setError(null); setSelectedId(user.id); setCreating(false); setSelectedStatus(null); }}>Modifier</button><button type="button" className="table-action table-action--danger" disabled={busyId === user.id || user.id === currentUserId} onClick={() => void remove(user)}>Supprimer</button></td></tr>)}
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
      summary={[`Statuts : ${rolesLabel(newDraft.roles)}`]}
      busy={busyId === "new"}
      onClose={() => { setCreating(false); setNewDraft(emptyDraft(statusPresets)); }}
      footer={<>
        <button type="button" className="secondary" disabled={busyId === "new"} onClick={() => { setCreating(false); setNewDraft(emptyDraft(statusPresets)); }}>Annuler</button>
        <button type="button" disabled={busyId === "new" || !isUserDraftValid(newDraft)} onClick={() => void create()}>{busyId === "new" ? "Ajout…" : "Ajouter"}</button>
      </>}
    >
      {error ? <div className="note">{error}</div> : null}
      <UserEditor draft={newDraft} statusPresets={statusPresets} disabled={busyId === "new"} onChange={setNewDraft} />
    </ReservationDetailsDrawer>
    <ReservationDetailsDrawer
      open={Boolean(selected)}
      title={selected?.displayName ?? "Utilisateur"}
      eyebrow={selected ? rolesLabel(selected.roles) : "Utilisateur"}
      summary={selected ? [selected.isActive ? "Compte actif" : "Compte inactif", selected.permissions.isOwner ? "Toutes les pages" : `${selected.pageAccess.length} page(s) visible(s)`] : []}
      busy={Boolean(selected && busyId === selected.id)}
      onClose={() => setSelectedId(null)}
      footer={selected ? <>
        <button type="button" className="secondary" disabled={busyId === selected.id} onClick={() => setSelectedId(null)}>Annuler</button>
        <button type="button" disabled={busyId === selected.id || !isUserDraftValid(drafts[selected.id] ?? toDraft(selected))} onClick={() => void save(selected.id)}>{busyId === selected.id ? "Enregistrement…" : "Enregistrer"}</button>
      </> : null}
    >
      {error ? <div className="note">{error}</div> : null}
      {selected ? <UserEditor draft={drafts[selected.id] ?? toDraft(selected)} statusPresets={statusPresets} disabled={busyId === selected.id} onChange={(draft) => setDrafts((current) => ({ ...current, [selected.id]: draft }))} /> : null}
    </ReservationDetailsDrawer>
  </section>;
};
export default UserSettings;
