import { useEffect, useMemo, useRef, useState, type CSSProperties, type ChangeEvent, type DragEvent } from "react";
import { apiFetch, isApiError } from "../utils/api";
import type { Gestionnaire, Gite, ReservationPlaceholder } from "../utils/types";
import { getGiteColor } from "../utils/giteColors";

const emptyForm = {
  nom: "",
  prefixe_contrat: "",
  adresse_ligne1: "",
  adresse_ligne2: "",
  capacite_max: 1,
  nb_adultes_habituel: 1,
  proprietaires_noms: "",
  proprietaires_adresse: "",
  site_web: "",
  email: "",
  caracteristiques: "",
  airbnb_listing_id: "",
  telephones: "",
  taxe_sejour_par_personne_par_nuit: 0,
  iban: "",
  bic: "",
  titulaire: "",
  regle_animaux_acceptes: false,
  regle_bois_premiere_flambee: false,
  regle_tiers_personnes_info: false,
  options_draps_par_lit: 0,
  options_linge_toilette_par_personne: 0,
  options_menage_forfait: 0,
  options_depart_tardif_forfait: 0,
  options_chiens_forfait: 0,
  heure_arrivee_defaut: "17:00",
  heure_depart_defaut: "12:00",
  caution_montant_defaut: 0,
  cheque_menage_montant_defaut: 0,
  arrhes_taux_defaut: 0.2,
  prix_nuit_liste: "",
  gestionnaire_id: "",
};

type FormState = typeof emptyForm;
type GitesExportPayload = {
  version?: number;
  exported_at?: string;
  gites: unknown[];
};
type GitesImportResult = {
  created_count: number;
  updated_count: number;
};
const PLACEHOLDER_FADE_OUT_MS = 320;

const formatManagerLabel = (gite: Gite) =>
  gite.gestionnaire ? `${gite.gestionnaire.prenom} ${gite.gestionnaire.nom}` : "Gestion directe";

const formatAddressLabel = (gite: Gite) =>
  [gite.adresse_ligne1, gite.adresse_ligne2].map((part) => part?.trim()).filter(Boolean).join(", ");

const getGiteHighlights = (gite: Gite) =>
  (gite.caracteristiques ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 2);

const GitesPage = () => {
  const [gites, setGites] = useState<Gite[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [importingGites, setImportingGites] = useState(false);
  const [exportingGites, setExportingGites] = useState(false);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [reordering, setReordering] = useState(false);
  const [placeholders, setPlaceholders] = useState<ReservationPlaceholder[]>([]);
  const [gestionnaires, setGestionnaires] = useState<Gestionnaire[]>([]);
  const [placeholderTargets, setPlaceholderTargets] = useState<Record<string, string>>({});
  const [attachingPlaceholderId, setAttachingPlaceholderId] = useState<string | null>(null);
  const [fadingPlaceholderIds, setFadingPlaceholderIds] = useState<string[]>([]);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const formCardRef = useRef<HTMLDivElement | null>(null);

  const selected = useMemo(() => gites.find((g) => g.id === selectedId) ?? null, [gites, selectedId]);

  const load = async () => {
    const [gitesData, placeholdersData, gestionnairesData] = await Promise.all([
      apiFetch<Gite[]>("/gites"),
      apiFetch<ReservationPlaceholder[]>("/reservations/placeholders"),
      apiFetch<Gestionnaire[]>("/managers"),
    ]);
    setGites(gitesData);
    setPlaceholders(placeholdersData);
    setGestionnaires(gestionnairesData);
    setPlaceholderTargets((prev) => {
      const next = { ...prev };
      for (const placeholder of placeholdersData) {
        if (!next[placeholder.id] && gitesData[0]?.id) {
          next[placeholder.id] = gitesData[0].id;
        }
      }
      return next;
    });
  };

  useEffect(() => {
    load().catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    if (!selected) {
      setForm(emptyForm);
      return;
    }
    setForm({
      nom: selected.nom,
      prefixe_contrat: selected.prefixe_contrat,
      adresse_ligne1: selected.adresse_ligne1,
      adresse_ligne2: selected.adresse_ligne2 ?? "",
      capacite_max: selected.capacite_max,
      nb_adultes_habituel: selected.nb_adultes_habituel,
      proprietaires_noms: selected.proprietaires_noms,
      proprietaires_adresse: selected.proprietaires_adresse,
      site_web: selected.site_web ?? "",
      email: selected.email ?? "",
      caracteristiques: selected.caracteristiques ?? "",
      airbnb_listing_id: selected.airbnb_listing_id ?? "",
      telephones: Array.isArray(selected.telephones) ? selected.telephones.join(", ") : "",
      taxe_sejour_par_personne_par_nuit: selected.taxe_sejour_par_personne_par_nuit,
      iban: selected.iban,
      bic: selected.bic ?? "",
      titulaire: selected.titulaire,
      regle_animaux_acceptes: selected.regle_animaux_acceptes,
      regle_bois_premiere_flambee: selected.regle_bois_premiere_flambee,
      regle_tiers_personnes_info: selected.regle_tiers_personnes_info,
      options_draps_par_lit: selected.options_draps_par_lit,
      options_linge_toilette_par_personne: selected.options_linge_toilette_par_personne,
      options_menage_forfait: selected.options_menage_forfait,
      options_depart_tardif_forfait: selected.options_depart_tardif_forfait,
      options_chiens_forfait: selected.options_chiens_forfait,
      heure_arrivee_defaut: selected.heure_arrivee_defaut ?? "17:00",
      heure_depart_defaut: selected.heure_depart_defaut ?? "12:00",
      caution_montant_defaut: selected.caution_montant_defaut ?? 0,
      cheque_menage_montant_defaut: selected.cheque_menage_montant_defaut ?? 0,
      arrhes_taux_defaut: selected.arrhes_taux_defaut ?? 0.2,
      prix_nuit_liste: Array.isArray(selected.prix_nuit_liste) ? selected.prix_nuit_liste.join(", ") : "",
      gestionnaire_id: selected.gestionnaire_id ?? "",
    });
  }, [selected]);

  const handleChange = (key: keyof FormState, value: string | number | boolean) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleDragStart = (event: DragEvent<HTMLButtonElement>, id: string) => {
    if (reordering) return;
    setDraggedId(id);
    setDragOverId(id);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", id);
  };

  const handleDragOver = (event: DragEvent<HTMLElement>, targetId: string) => {
    if (reordering) return;
    const sourceId = draggedId ?? event.dataTransfer.getData("text/plain");
    if (!sourceId || sourceId === targetId) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    if (dragOverId !== targetId) setDragOverId(targetId);
  };

  const handleDrop = async (event: DragEvent<HTMLElement>, targetId: string) => {
    event.preventDefault();
    if (reordering) return;
    const sourceId = draggedId ?? event.dataTransfer.getData("text/plain");
    setDraggedId(null);
    setDragOverId(null);
    if (!sourceId || sourceId === targetId) return;

    const fromIndex = gites.findIndex((gite) => gite.id === sourceId);
    const targetIndex = gites.findIndex((gite) => gite.id === targetId);
    if (fromIndex < 0 || targetIndex < 0 || fromIndex === targetIndex) return;

    const reordered = [...gites];
    const [moved] = reordered.splice(fromIndex, 1);
    reordered.splice(targetIndex, 0, moved);
    setGites(reordered);

    setReordering(true);
    setError(null);
    try {
      const updated = await apiFetch<Gite[]>("/gites/reorder", {
        method: "POST",
        json: { ids: reordered.map((gite) => gite.id) },
      });
      setGites(updated);
    } catch (err: any) {
      setError(err.message);
      await load();
    } finally {
      setReordering(false);
    }
  };

  const handleDragEnd = () => {
    setDraggedId(null);
    setDragOverId(null);
  };

  const save = async () => {
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const prixNuitListe = form.prix_nuit_liste
        .split(/[,;\n]+/)
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value) && value >= 0);
      const payload = {
        ...form,
        heure_arrivee_defaut: form.heure_arrivee_defaut || "17:00",
        heure_depart_defaut: form.heure_depart_defaut || "12:00",
        gestionnaire_id: form.gestionnaire_id || null,
        prix_nuit_liste: prixNuitListe,
        telephones: form.telephones
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
      };
      let created: Gite | null = null;
      if (selectedId) {
        await apiFetch(`/gites/${selectedId}`, { method: "PUT", json: payload });
      } else {
        created = await apiFetch<Gite>(`/gites`, { method: "POST", json: payload });
      }
      await load();
      if (created) {
        setSelectedId(created.id);
        const matchingPlaceholder = placeholders.find(
          (placeholder) => placeholder.abbreviation === created.prefixe_contrat.toUpperCase()
        );
        if (
          matchingPlaceholder &&
          confirm(
            `Associer le nouveau gîte ${created.nom} au placeholder ${matchingPlaceholder.abbreviation} (${matchingPlaceholder.reservations_count} réservations) ?`
          )
        ) {
          await apiFetch(`/reservations/placeholders/${matchingPlaceholder.id}/assign`, {
            method: "POST",
            json: { gite_id: created.id },
          });
          await load();
        }
      } else {
        setSelectedId(null);
        setForm(emptyForm);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const duplicate = async (id: string) => {
    setError(null);
    setNotice(null);
    try {
      const created = await apiFetch<Gite>(`/gites/${id}/duplicate`, { method: "POST" });
      await load();
      setSelectedId(created.id);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const remove = async (gite: Gite) => {
    const contratsCount = gite.contrats_count ?? 0;
    const message =
      contratsCount > 0
        ? `Supprimer ce gîte et ses ${contratsCount} contrats ?`
        : "Supprimer ce gîte ?";
    if (!confirm(message)) return;
    setNotice(null);
    try {
      await apiFetch(`/gites/${gite.id}`, { method: "DELETE" });
      await load();
      if (selectedId === gite.id) setSelectedId(null);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const attachPlaceholder = async (placeholder: ReservationPlaceholder) => {
    const targetGiteId = placeholderTargets[placeholder.id] ?? selectedId ?? "";
    if (!targetGiteId) {
      setError("Choisissez un gîte cible avant de rattacher un placeholder.");
      return;
    }
    setError(null);
    setNotice(null);
    setAttachingPlaceholderId(placeholder.id);
    try {
      await apiFetch(`/reservations/placeholders/${placeholder.id}/assign`, {
        method: "POST",
        json: { gite_id: targetGiteId },
      });
      const targetGite = gites.find((gite) => gite.id === targetGiteId);
      setNotice(
        `Placeholder ${placeholder.abbreviation} rattaché à ${targetGite?.nom ?? "ce gîte"} (${placeholder.reservations_count} réservation(s)).`
      );
      setFadingPlaceholderIds((prev) => (prev.includes(placeholder.id) ? prev : [...prev, placeholder.id]));
      await new Promise((resolve) => setTimeout(resolve, PLACEHOLDER_FADE_OUT_MS));
      setPlaceholders((prev) => prev.filter((item) => item.id !== placeholder.id));
      setPlaceholderTargets((prev) => {
        const { [placeholder.id]: _removed, ...rest } = prev;
        return rest;
      });
      await load();
    } catch (err: any) {
      if (isApiError(err) && err.status === 409) {
        const conflicts = Array.isArray((err.payload as any).conflicts) ? (err.payload as any).conflicts : [];
        const deduplicated = Number((err.payload as any).skipped_duplicates_count ?? 0);
        const suffixParts: string[] = [];
        if (conflicts.length > 0) suffixParts.push(`${conflicts.length} conflit(s)`);
        if (deduplicated > 0) suffixParts.push(`${deduplicated} doublon(s) ignoré(s)`);
        const suffix = suffixParts.length > 0 ? ` (${suffixParts.join(", ")})` : "";
        setError(`${err.message}${suffix}`);
      } else {
        setError(err.message);
      }
    } finally {
      setFadingPlaceholderIds((prev) => prev.filter((id) => id !== placeholder.id));
      setAttachingPlaceholderId(null);
    }
  };

  const triggerImport = () => {
    importInputRef.current?.click();
  };

  const startCreate = () => {
    setSelectedId(null);
    setForm(emptyForm);
    requestAnimationFrame(() => formCardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  const selectGite = (id: string) => {
    setSelectedId(id);
    requestAnimationFrame(() => formCardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  const exportGites = async () => {
    setExportingGites(true);
    setError(null);
    setNotice(null);
    try {
      const payload = await apiFetch<GitesExportPayload>("/gites/export");
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const stamp = new Date().toISOString().slice(0, 10);
      const link = document.createElement("a");
      link.href = url;
      link.download = `gites-export-${stamp}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setNotice(`${payload.gites.length} fiche(s) exportée(s).`);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setExportingGites(false);
    }
  };

  const importGitesFromFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;

    setImportingGites(true);
    setError(null);
    setNotice(null);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as unknown;
      let payload: { gites: unknown[] };

      if (Array.isArray(parsed)) {
        payload = { gites: parsed };
      } else if (
        parsed &&
        typeof parsed === "object" &&
        Array.isArray((parsed as { gites?: unknown[] }).gites)
      ) {
        payload = { gites: (parsed as { gites: unknown[] }).gites };
      } else {
        throw new Error("Format invalide: utilisez un JSON exporté depuis l'application.");
      }

      const result = await apiFetch<GitesImportResult>("/gites/import", {
        method: "POST",
        json: payload,
      });
      await load();
      setNotice(`Import terminé: ${result.created_count} créé(s), ${result.updated_count} mis à jour.`);
    } catch (err: any) {
      if (err instanceof SyntaxError) {
        setError("Le fichier n'est pas un JSON valide.");
      } else {
        setError(err.message);
      }
    } finally {
      input.value = "";
      setImportingGites(false);
    }
  };

  return (
    <div>
      <div className="gites-listing-shell">
        <div className="gites-header gites-header--listing">
          <div className="gites-tools">
            <button type="button" className="gites-primary-action" onClick={startCreate} disabled={loading}>
              Nouveau gîte
            </button>
            <input
              ref={importInputRef}
              type="file"
              accept=".json,application/json"
              onChange={(event) => void importGitesFromFile(event)}
              style={{ display: "none" }}
            />
            <button
              type="button"
              className="table-action table-action--neutral gites-tool-button"
              onClick={() => void exportGites()}
              disabled={exportingGites || importingGites}
            >
              {exportingGites ? "Export..." : "Exporter"}
            </button>
            <button
              type="button"
              className="table-action table-action--neutral gites-tool-button"
              onClick={triggerImport}
              disabled={importingGites || exportingGites}
            >
              {importingGites ? "Import..." : "Importer"}
            </button>
          </div>
          {reordering && <div className="gites-header__status">Enregistrement de l'ordre...</div>}
        </div>
        {notice && <div className="note note--success">{notice}</div>}
        {error && <div className="note">{error}</div>}
        {gites.length > 0 ? (
          <div className="gites-listing-grid">
            {gites.map((gite, index) => {
              const accent = getGiteColor(gite, index);
              const accentStyle = { "--gite-card-accent": accent } as CSSProperties;
              const managerLabel = formatManagerLabel(gite);
              const addressLabel = formatAddressLabel(gite);
              const highlights = getGiteHighlights(gite);
              const tags = [
                `${gite.capacite_max} voyageurs`,
                `${gite.nb_adultes_habituel} adultes`,
                gite.regle_animaux_acceptes ? "Animaux ok" : null,
                gite.regle_bois_premiere_flambee ? "Bois inclus" : null,
              ].filter((tag): tag is string => Boolean(tag));

              return (
                <article
                  key={gite.id}
                  className={[
                    "gite-listing-card",
                    selectedId === gite.id ? "gite-listing-card--selected" : "",
                    draggedId === gite.id ? "gite-listing-card--dragging" : "",
                    dragOverId === gite.id && draggedId !== gite.id ? "gite-listing-card--drag-over" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  style={accentStyle}
                  onDragOver={(event) => handleDragOver(event, gite.id)}
                  onDrop={(event) => void handleDrop(event, gite.id)}
                >
                  <div className="gite-listing-card__visual">
                    <div className="gite-listing-card__visual-top">
                      <span className="gite-listing-card__pill">{gite.prefixe_contrat}</span>
                      <button
                        type="button"
                        className="drag-handle gite-listing-card__drag"
                        draggable={!reordering}
                        onDragStart={(event) => handleDragStart(event, gite.id)}
                        onDragEnd={handleDragEnd}
                        aria-label={`Réorganiser ${gite.nom}`}
                        title="Glisser pour réorganiser"
                        disabled={reordering}
                      >
                        ≡
                      </button>
                    </div>
                    <div className="gite-listing-card__visual-content">
                      <div className="gite-listing-card__visual-label">Gîte</div>
                      <div className="gite-listing-card__visual-title">{gite.nom}</div>
                      <div className="gite-listing-card__visual-meta">{managerLabel}</div>
                    </div>
                  </div>

                  <div className="gite-listing-card__body">
                    <div className="gite-listing-card__heading">
                      <p>{addressLabel || "Adresse à compléter"}</p>
                    </div>

                    <div className="gite-listing-card__tags">
                      {tags.map((tag) => (
                        <span key={tag} className="gite-listing-card__tag">
                          {tag}
                        </span>
                      ))}
                    </div>

                    <div className="gite-listing-card__stats">
                      <div>
                        <strong>{gite.reservations_count ?? 0}</strong>
                        <span>Réservations</span>
                      </div>
                      <div>
                        <strong>{gite.contrats_count ?? 0}</strong>
                        <span>Contrats</span>
                      </div>
                      <div>
                        <strong>{gite.factures_count ?? 0}</strong>
                        <span>Factures</span>
                      </div>
                    </div>

                    <div className="gite-listing-card__highlights">
                      {highlights.length > 0 ? (
                        highlights.map((item) => (
                          <div key={item} className="gite-listing-card__highlight">
                            {item}
                          </div>
                        ))
                      ) : (
                        <div className="gite-listing-card__highlight gite-listing-card__highlight--muted">
                          Ajoutez des caractéristiques pour enrichir la fiche PDF.
                        </div>
                      )}
                    </div>

                    <div className="gite-listing-card__actions">
                      <button type="button" className="table-action table-action--primary" onClick={() => selectGite(gite.id)}>
                        Éditer
                      </button>
                      <button type="button" className="table-action table-action--neutral" onClick={() => duplicate(gite.id)}>
                        Dupliquer
                      </button>
                      <button
                        type="button"
                        className="table-action table-action--icon gite-listing-card__delete"
                        onClick={() => remove(gite)}
                        aria-label={`Supprimer ${gite.nom}`}
                        title={`Supprimer ${gite.nom}`}
                      >
                        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                          <path
                            d="M9 3h6m-9 3h12m-9 3v7m3-7v7m3-7v7M8 6l.7 11.2a2 2 0 0 0 2 1.8h2.6a2 2 0 0 0 2-1.8L16 6"
                            fill="none"
                            stroke="currentColor"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth="1.5"
                          />
                        </svg>
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="gites-empty-state">
            <div className="gites-empty-state__title">Aucun gîte pour le moment</div>
            <div className="field-hint">Créez votre premier gîte pour commencer à générer contrats et factures.</div>
          </div>
        )}
      </div>

      {placeholders.length > 0 && (
        <div className="card gites-placeholders-card">
          <div className="gites-placeholders-card__header">
            <div>
              <div className="section-title">Réservations non attribuées</div>
              <div className="field-hint gites-reorder-hint">
                Lorsqu'un gîte importé n'est pas reconnu, un placeholder est créé. Rattachez-le ici.
              </div>
            </div>
            <div className="gites-placeholders-card__count">{placeholders.length} en attente</div>
          </div>
          <table className="table">
            <thead>
              <tr>
                <th>Abréviation</th>
                <th>Libellé</th>
                <th>Réservations</th>
                <th>Gîte cible</th>
                <th className="table-actions-cell">Action</th>
              </tr>
            </thead>
            <tbody>
              {placeholders.map((placeholder) => (
                <tr
                  key={placeholder.id}
                  className={`placeholder-row ${fadingPlaceholderIds.includes(placeholder.id) ? "placeholder-row--fading" : ""}`}
                >
                  <td>{placeholder.abbreviation}</td>
                  <td>{placeholder.label ?? ""}</td>
                  <td>
                    <span className="badge">{placeholder.reservations_count}</span>
                  </td>
                  <td>
                    <select
                      className="placeholder-target-select"
                      value={placeholderTargets[placeholder.id] ?? selectedId ?? ""}
                      onChange={(event) =>
                        setPlaceholderTargets((prev) => ({
                          ...prev,
                          [placeholder.id]: event.target.value,
                        }))
                      }
                      disabled={attachingPlaceholderId === placeholder.id || fadingPlaceholderIds.includes(placeholder.id)}
                    >
                      <option value="">Choisir un gîte</option>
                      {gites.map((gite) => (
                        <option key={gite.id} value={gite.id}>
                          {gite.nom} ({gite.prefixe_contrat})
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="table-actions-cell">
                    <button
                      type="button"
                      className="table-action table-action--primary"
                      onClick={() => attachPlaceholder(placeholder)}
                      disabled={attachingPlaceholderId === placeholder.id || fadingPlaceholderIds.includes(placeholder.id)}
                    >
                      {attachingPlaceholderId === placeholder.id ? "Rattachement..." : "Rattacher"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div ref={formCardRef} className="card gites-editor-card">
        <div className="gites-editor-header">
          <div>
            <div className="gites-editor-header__eyebrow">{selected ? "Édition en cours" : "Nouveau gîte"}</div>
            <div className="section-title">{selected ? "Éditer" : "Créer"} un gîte</div>
          </div>
          {selected && <div className="gites-editor-header__badge">{selected.prefixe_contrat}</div>}
        </div>
        <div className="form-section">
          <div className="section-subtitle">Identité du gîte</div>
          <div className="grid-2">
            <label className="field">
              Nom
              <input value={form.nom} onChange={(e) => handleChange("nom", e.target.value)} />
            </label>
            <label className="field">
              Préfixe contrat
              <input
                value={form.prefixe_contrat}
                onChange={(e) => handleChange("prefixe_contrat", e.target.value.toUpperCase())}
              />
            </label>
            <label className="field">
              Capacité max
              <input
                type="number"
                value={form.capacite_max}
                onChange={(e) => handleChange("capacite_max", Number(e.target.value))}
              />
            </label>
            <label className="field">
              Nombre d'adultes habituel
              <input
                type="number"
                value={form.nb_adultes_habituel}
                onChange={(e) => handleChange("nb_adultes_habituel", Number(e.target.value))}
              />
            </label>
            <label className="field">
              Gestionnaire
              <select
                value={form.gestionnaire_id}
                onChange={(e) => handleChange("gestionnaire_id", e.target.value)}
              >
                <option value="">Aucun</option>
                {gestionnaires.map((gestionnaire) => (
                  <option key={gestionnaire.id} value={gestionnaire.id}>
                    {gestionnaire.prenom} {gestionnaire.nom}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              ID Airbnb
              <input
                value={form.airbnb_listing_id}
                onChange={(e) => handleChange("airbnb_listing_id", e.target.value)}
                placeholder="48504640"
              />
            </label>
          </div>
        </div>

        <div className="form-section">
          <div className="section-subtitle">Adresse du gîte</div>
          <div className="grid-2">
            <label className="field">
              Adresse ligne 1
              <input
                value={form.adresse_ligne1}
                onChange={(e) => handleChange("adresse_ligne1", e.target.value)}
              />
            </label>
            <label className="field">
              Adresse ligne 2
              <input
                value={form.adresse_ligne2}
                onChange={(e) => handleChange("adresse_ligne2", e.target.value)}
              />
            </label>
          </div>
        </div>

        <div className="form-section">
          <div className="section-subtitle">Propriétaires & contact</div>
          <div className="grid-2">
            <label className="field">
              Propriétaires
              <input
                value={form.proprietaires_noms}
                onChange={(e) => handleChange("proprietaires_noms", e.target.value)}
              />
            </label>
            <label className="field">
              Adresse propriétaires
              <input
                value={form.proprietaires_adresse}
                onChange={(e) => handleChange("proprietaires_adresse", e.target.value)}
              />
            </label>
            <label className="field">
              Site web
              <input value={form.site_web} onChange={(e) => handleChange("site_web", e.target.value)} />
            </label>
            <label className="field">
              Email
              <input value={form.email} onChange={(e) => handleChange("email", e.target.value)} />
            </label>
            <label className="field">
              Téléphones (séparés par des virgules)
              <input value={form.telephones} onChange={(e) => handleChange("telephones", e.target.value)} />
            </label>
          </div>
        </div>

        <div className="form-section">
          <div className="section-subtitle">Fiscalité & paiement</div>
          <div className="grid-2">
            <label className="field">
              Taxe de séjour / personne / nuit
              <input
                type="number"
                step="0.01"
                value={form.taxe_sejour_par_personne_par_nuit}
                onChange={(e) => handleChange("taxe_sejour_par_personne_par_nuit", Number(e.target.value))}
              />
            </label>
            <label className="field">
              IBAN
              <input value={form.iban} onChange={(e) => handleChange("iban", e.target.value)} />
            </label>
            <label className="field">
              BIC
              <input value={form.bic} onChange={(e) => handleChange("bic", e.target.value)} />
            </label>
            <label className="field">
              Titulaire
              <input value={form.titulaire} onChange={(e) => handleChange("titulaire", e.target.value)} />
            </label>
          </div>
        </div>

        <div className="form-section">
          <div className="section-subtitle">Options & services (tarifs par défaut)</div>
          <div className="grid-2">
            <label className="field">
              Draps / lit (par séjour)
              <input
                type="number"
                step={1}
                value={form.options_draps_par_lit}
                onChange={(e) => handleChange("options_draps_par_lit", Number(e.target.value))}
              />
            </label>
            <label className="field">
              Linge toilette / personne (par séjour)
              <input
                type="number"
                step={1}
                value={form.options_linge_toilette_par_personne}
                onChange={(e) => handleChange("options_linge_toilette_par_personne", Number(e.target.value))}
              />
            </label>
            <label className="field">
              Ménage forfait
              <input
                type="number"
                step={1}
                value={form.options_menage_forfait}
                onChange={(e) => handleChange("options_menage_forfait", Number(e.target.value))}
              />
            </label>
            <label className="field">
              Départ tardif forfait
              <input
                type="number"
                step={1}
                value={form.options_depart_tardif_forfait}
                onChange={(e) => handleChange("options_depart_tardif_forfait", Number(e.target.value))}
              />
            </label>
            <label className="field">
              Chiens / nuit
              <input
                type="number"
                step={1}
                value={form.options_chiens_forfait}
                onChange={(e) => handleChange("options_chiens_forfait", Number(e.target.value))}
              />
            </label>
            <label className="field">
              Heure d'arrivée par défaut
              <input
                type="time"
                value={form.heure_arrivee_defaut}
                onChange={(e) => handleChange("heure_arrivee_defaut", e.target.value)}
              />
            </label>
            <label className="field">
              Heure de départ par défaut
              <input
                type="time"
                value={form.heure_depart_defaut}
                onChange={(e) => handleChange("heure_depart_defaut", e.target.value)}
              />
            </label>
          </div>
        </div>

        <div className="form-section">
          <div className="section-subtitle">Garanties & arrhes</div>
          <div className="grid-2">
            <label className="field">
              Caution par défaut
              <input
                type="number"
                step={1}
                value={form.caution_montant_defaut}
                onChange={(e) => handleChange("caution_montant_defaut", Number(e.target.value))}
              />
            </label>
            <label className="field">
              Chèque ménage par défaut
              <input
                type="number"
                step={1}
                value={form.cheque_menage_montant_defaut}
                onChange={(e) => handleChange("cheque_menage_montant_defaut", Number(e.target.value))}
              />
            </label>
            <label className="field">
              Arrhes par défaut (%)
              <input
                type="number"
                step="0.1"
                value={Math.round((form.arrhes_taux_defaut ?? 0) * 1000) / 10}
                onChange={(e) => handleChange("arrhes_taux_defaut", Number(e.target.value) / 100)}
              />
            </label>
          </div>
        </div>

        <div className="form-section">
          <div className="section-subtitle">Caractéristiques</div>
          <div className="grid-2">
            <label className="field" style={{ gridColumn: "1 / -1" }}>
              Caractéristiques (1 ligne = 1 bullet PDF)
              <textarea
                value={form.caracteristiques}
                onChange={(e) => handleChange("caracteristiques", e.target.value)}
                rows={3}
              />
            </label>
          </div>
        </div>

        <div className="form-section">
          <div className="section-subtitle">Tarifs de nuit</div>
          <div className="grid-2">
            <label className="field">
              Prix/nuit (liste séparée par virgules ou retours ligne)
              <textarea
                value={form.prix_nuit_liste}
                onChange={(e) => handleChange("prix_nuit_liste", e.target.value)}
                rows={3}
              />
            </label>
          </div>
        </div>

        <div className="form-section">
          <div className="section-subtitle">Règles du gîte</div>
          <div className="rules-grid">
            <div className="rule-card">
              <div>
                <div className="rule-title">Animaux acceptés</div>
                <div className="rule-sub">Autoriser la présence d'animaux dans le gîte.</div>
              </div>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={form.regle_animaux_acceptes}
                  onChange={(e) => handleChange("regle_animaux_acceptes", e.target.checked)}
                />
                <span className="slider" />
              </label>
            </div>
            <div className="rule-card">
              <div>
                <div className="rule-title">Bois première flambée</div>
                <div className="rule-sub">Inclure du bois pour l'arrivée des locataires.</div>
              </div>
              <label className="switch switch--pink">
                <input
                  type="checkbox"
                  checked={form.regle_bois_premiere_flambee}
                  onChange={(e) => handleChange("regle_bois_premiere_flambee", e.target.checked)}
                />
                <span className="slider" />
              </label>
            </div>
            <div className="rule-card">
              <div>
                <div className="rule-title">Info tiers personnes</div>
                <div className="rule-sub">Informer des passages éventuels de tiers.</div>
              </div>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={form.regle_tiers_personnes_info}
                  onChange={(e) => handleChange("regle_tiers_personnes_info", e.target.checked)}
                />
                <span className="slider" />
              </label>
            </div>
          </div>
        </div>

        <div className="actions" style={{ marginTop: 16 }}>
          <button type="button" onClick={save} disabled={loading}>
            {loading ? "Enregistrement..." : "Enregistrer"}
          </button>
          {selected && (
            <button type="button" className="secondary" onClick={startCreate}>
              Annuler
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default GitesPage;
