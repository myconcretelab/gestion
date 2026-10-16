import { useEffect, useState, type FormEvent } from "react";
import {
  fiscalEntitySchema,
  fiscalEstablishmentSchema,
  vatRegimeLabels,
  fiscalEntityMissingFields,
  type VatRegime,
} from "@contrats/shared";
import { apiFetch } from "../../utils/api";
import type { FiscalEntity, FiscalEstablishment } from "../../utils/types";
import { canCurrentUserManageIntegrations } from "../../utils/auth";
import SuperPdpConnectionSettings from "./SuperPdpConnectionSettings";
import FiscalSettingsNavigation, {
  type FiscalSettingsSection,
} from "./FiscalSettingsNavigation";
import "./fiscalEntitiesSettings.css";
import FiscalUnsavedChangesNotice from "./FiscalUnsavedChangesNotice";
import { isFiscalDraftDirty } from "./fiscalSettingsState";

const emptyAddress = {
  address_line1: "",
  address_line2: "",
  postal_code: "",
  city: "",
  country_code: "FR",
};
type AddressDraft = typeof emptyAddress;
const emptyEntity = () => ({
  ...emptyAddress,
  legal_name: "",
  gestionnaire_id: "",
  siren: "",
  vat_number: "",
  vat_regime: "unknown" as VatRegime,
  email: "",
});
const emptyEstablishment = () => ({ ...emptyAddress, name: "", siret: "" });
const addressDraft = (
  value: FiscalEntity | FiscalEstablishment,
): AddressDraft => ({
  address_line1: value.address_line1 ?? "",
  address_line2: value.address_line2 ?? "",
  postal_code: value.postal_code ?? "",
  city: value.city ?? "",
  country_code: value.country_code,
});
const entityToDraft = (entity: FiscalEntity) => ({
  ...addressDraft(entity),
  legal_name: entity.legal_name,
  gestionnaire_id: entity.gestionnaire_id ?? "",
  siren: entity.siren ?? "",
  vat_number: entity.vat_number ?? "",
  vat_regime: entity.vat_regime,
  email: entity.email ?? "",
});
type Inventory = {
  managers: Array<{
    id: string;
    prenom: string;
    nom: string;
    _count: { fiscal_entities: number; gites: number };
  }>;
  gites: Array<{
    id: string;
    nom: string;
    gestionnaire_id: string | null;
    missing_fields: string[];
    fiscal_establishment: {
      name: string;
      siret: string | null;
      fiscal_entity: { legal_name: string };
    } | null;
  }>;
};

function AddressFields({
  value,
  onChange,
}: {
  value: AddressDraft;
  onChange: (key: keyof AddressDraft, value: string) => void;
}) {
  return (
    <div className="fiscal-form-grid fiscal-address-grid">
      {(
        [
          ["address_line1", "Adresse"],
          ["address_line2", "Complément d’adresse"],
          ["postal_code", "Code postal"],
          ["city", "Ville"],
          ["country_code", "Code pays (FR, …)"],
        ] as const
      ).map(([key, label]) => (
        <label className="field" key={key}>
          {label}
          <input
            value={value[key]}
            maxLength={
              key === "country_code"
                ? 2
                : key === "postal_code"
                  ? 20
                  : key === "city"
                    ? 120
                    : 250
            }
            onChange={(event) => onChange(key, event.target.value)}
          />
        </label>
      ))}
    </div>
  );
}

export default function FiscalEntitiesSettings() {
  const [entities, setEntities] = useState<FiscalEntity[]>([]);
  const [inventory, setInventory] = useState<Inventory | null>(null);
  const [entityId, setEntityId] = useState("");
  const [entityDraft, setEntityDraft] = useState(emptyEntity);
  const [establishmentId, setEstablishmentId] = useState("");
  const [establishmentDraft, setEstablishmentDraft] =
    useState(emptyEstablishment);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [section, setSection] = useState<FiscalSettingsSection>(() =>
    new URLSearchParams(window.location.search).has("superpdp")
      ? "superpdp"
      : "company",
  );
  const [showAllGites, setShowAllGites] = useState(false);
  const [connectionDirty, setConnectionDirty] = useState(false);
  const [connectionBusy, setConnectionBusy] = useState(false);
  const [pendingSelection, setPendingSelection] = useState<{
    target: "company" | "establishment";
    id: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(() => {
    const result = new URLSearchParams(window.location.search).get("superpdp");
    return result === "connected"
      ? "Connexion SuperPDP de test vérifiée."
      : result === "pending"
        ? "Consentement reçu. L’entreprise reste bloquée jusqu’à sa vérification par SuperPDP."
        : result === "error"
          ? "Le retour OAuth n’a pas été confirmé. Sélectionnez l’entreprise pour consulter son état ; reconnectez-vous à l’application si nécessaire."
          : null;
  });
  const selected = entities.find((entity) => entity.id === entityId);
  const canManageIntegrations = canCurrentUserManageIntegrations();
  const entityDirty = isFiscalDraftDirty(
    entityDraft,
    selected ? entityToDraft(selected) : emptyEntity(),
  );
  const currentEstablishment = selected?.establishments.find(
    (item) => item.id === establishmentId,
  );
  const establishmentDirty = isFiscalDraftDirty(
    establishmentDraft,
    currentEstablishment
      ? {
          ...addressDraft(currentEstablishment),
          name: currentEstablishment.name,
          siret: currentEstablishment.siret ?? "",
        }
      : emptyEstablishment(),
  );
  const unsaved = entityDirty || establishmentDirty || connectionDirty;
  const selectedGiteIds = new Set(
    selected?.establishments.flatMap((item) =>
      item.gites.map((gite) => gite.id),
    ) ?? [],
  );
  const visibleGites =
    inventory?.gites.filter(
      (gite) => showAllGites || selectedGiteIds.has(gite.id),
    ) ?? [];
  useEffect(() => {
    if (!unsaved) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [unsaved]);

  const load = async () => {
    const [data, overview] = await Promise.all([
      apiFetch<FiscalEntity[]>("/fiscal-entities"),
      apiFetch<Inventory>("/fiscal-entities/inventory"),
    ]);
    setEntities(data);
    setInventory(overview);
  };
  useEffect(() => {
    let active = true;
    Promise.all([
      apiFetch<FiscalEntity[]>("/fiscal-entities"),
      apiFetch<Inventory>("/fiscal-entities/inventory"),
    ])
      .then(([data, overview]) => {
        if (active) {
          setEntities(data);
          setInventory(overview);
          const returnedId = new URLSearchParams(window.location.search).get(
            "entreprise",
          );
          const returned = returnedId
            ? data.find((entity) => entity.id === returnedId)
            : data[0];
          if (returned) {
            setEntityId(returned.id);
            setEntityDraft(entityToDraft(returned));
          } else {
            setSection("company");
            if (returnedId) {
              setNotice(null);
              setError(
                "L’entreprise indiquée dans le retour n’est pas accessible. Sélectionnez une entreprise pour continuer.",
              );
            }
          }
          if (!canManageIntegrations) setSection("company");
        }
      })
      .catch((error: Error) => {
        if (active) setError(error.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [canManageIntegrations]);

  const chooseEntity = (id: string, discard = false) => {
    if (id === entityId) return;
    if (unsaved && !discard) {
      setPendingSelection({ target: "company", id });
      return;
    }
    setPendingSelection(null);
    const entity = entities.find((item) => item.id === id);
    setEntityId(id);
    setEntityDraft(
      entity
        ? {
            ...addressDraft(entity),
            legal_name: entity.legal_name,
            gestionnaire_id: entity.gestionnaire_id ?? "",
            siren: entity.siren ?? "",
            vat_number: entity.vat_number ?? "",
            vat_regime: entity.vat_regime,
            email: entity.email ?? "",
          }
        : emptyEntity(),
    );
    setEstablishmentId("");
    setEstablishmentDraft(emptyEstablishment());
    setConnectionDirty(false);
    setShowAllGites(false);
    if (!id) setSection("company");
    setError(null);
    setNotice(null);
  };
  const chooseEstablishment = (id: string, discard = false) => {
    if (id === establishmentId) return;
    if (establishmentDirty && !discard) {
      setPendingSelection({ target: "establishment", id });
      return;
    }
    setPendingSelection(null);
    const item = selected?.establishments.find((item) => item.id === id);
    setEstablishmentId(id);
    setEstablishmentDraft(
      item
        ? { ...addressDraft(item), name: item.name, siret: item.siret ?? "" }
        : emptyEstablishment(),
    );
  };

  const saveEntity = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setNotice(null);
    const parsed = fiscalEntitySchema.safeParse(entityDraft);
    if (!parsed.success) {
      setError(parsed.error.issues.map((issue) => issue.message).join(" "));
      return;
    }
    setSaving(true);
    try {
      const saved = await apiFetch<FiscalEntity>(
        entityId ? `/fiscal-entities/${entityId}` : "/fiscal-entities",
        {
          method: entityId ? "PUT" : "POST",
          json: parsed.data,
        },
      );
      setEntityId(saved.id);
      setEntityDraft(entityToDraft(saved));
      setNotice(
        "Entreprise enregistrée. Le volet Établissements permet de poursuivre la préparation.",
      );
      await load();
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Enregistrement impossible.",
      );
    } finally {
      setSaving(false);
    }
  };
  const saveEstablishment = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setNotice(null);
    const parsed = fiscalEstablishmentSchema.safeParse(establishmentDraft);
    if (!parsed.success) {
      setError(parsed.error.issues.map((issue) => issue.message).join(" "));
      return;
    }
    setSaving(true);
    try {
      const saved = await apiFetch<FiscalEstablishment>(
        `/fiscal-entities/${entityId}/establishments${establishmentId ? `/${establishmentId}` : ""}`,
        {
          method: establishmentId ? "PUT" : "POST",
          json: parsed.data,
        },
      );
      setEstablishmentId(saved.id);
      setEstablishmentDraft({
        ...addressDraft(saved),
        name: saved.name,
        siret: saved.siret ?? "",
      });
      await load();
      setNotice(
        "Établissement enregistré. Sélectionnez-le dans la fiche des gîtes concernés.",
      );
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Enregistrement impossible.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fiscal-settings">
      <header className="fiscal-page-header">
        <div className="fiscal-eyebrow">Organisation · Facturation</div>
        <h2>Entreprises et facturation</h2>
        <p>
          Une entreprise, ses établissements, puis les gîtes qu’elle facture.
          Avancez à votre rythme, volet par volet.
        </p>
      </header>
      {pendingSelection && (
        <FiscalUnsavedChangesNotice
          target={pendingSelection.target}
          onCancel={() => setPendingSelection(null)}
          onDiscard={() =>
            pendingSelection.target === "company"
              ? chooseEntity(pendingSelection.id, true)
              : chooseEstablishment(pendingSelection.id, true)
          }
        />
      )}
      {error && (
        <div className="note" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="note note--success" role="status">
          {notice}
        </div>
      )}
      {loading ? (
        <p>Chargement des entreprises…</p>
      ) : (
        <>
          <div className="fiscal-company-picker">
            <label className="field">
              Entreprise sélectionnée
              <select
                value={entityId}
                onChange={(event) => chooseEntity(event.target.value)}
                disabled={saving || connectionBusy}
              >
                <option value="">Nouvelle entreprise</option>
                {entities.map((entity) => (
                  <option key={entity.id} value={entity.id}>
                    {entity.legal_name}
                    {entity.siren
                      ? ` — ${entity.siren}`
                      : " — SIREN à compléter"}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="secondary"
              disabled={saving || connectionBusy || !entityId}
              onClick={() => chooseEntity("")}
            >
              + Ajouter une entreprise
            </button>
          </div>
          <div className="fiscal-company-summary">
            <div>
              <strong>{selected?.legal_name || "Nouvelle entreprise"}</strong>
              <span>
                {selected
                  ? `${selected.establishments.length} établissement(s) · ${selectedGiteIds.size} gîte(s) rattaché(s)`
                  : "Commencez par la raison sociale, puis enregistrez la fiche."}
              </span>
            </div>
            <span className="fiscal-badge">
              {unsaved
                ? "Modifications non enregistrées"
                : selected
                  ? fiscalEntityMissingFields(selected).length
                    ? "Fiche à compléter"
                    : "Informations de base renseignées"
                  : "À créer"}
            </span>
          </div>
          <FiscalSettingsNavigation
            active={section}
            hasCompany={!!selected}
            canManageIntegrations={canManageIntegrations}
            disabled={saving}
            onChange={setSection}
          />
          <section
            id="fiscal-panel-company"
            role="tabpanel"
            aria-labelledby="fiscal-tab-company"
            hidden={section !== "company"}
            className="fiscal-panel"
          >
            <div className="fiscal-panel-header">
              <h3>1. L’entreprise qui facture</h3>
              <p>
                Les coordonnées et informations fiscales utilisées pour vos
                factures.
              </p>
            </div>
            <form onSubmit={saveEntity}>
              <fieldset disabled={saving} className="fiscal-form-fieldset">
                <legend className="sr-only">
                  {entityId
                    ? "Modifier l’entreprise"
                    : "Ajouter une entreprise"}
                </legend>
                <h4 className="fiscal-group-title">Identité et contact</h4>
                <div className="fiscal-form-grid fiscal-form-grid--identity">
                  <label className="field">
                    Raison sociale
                    <input
                      required
                      maxLength={250}
                      value={entityDraft.legal_name}
                      onChange={(event) =>
                        setEntityDraft({
                          ...entityDraft,
                          legal_name: event.target.value,
                        })
                      }
                    />
                  </label>
                  <label className="field">
                    Gestionnaire associé
                    <select
                      value={entityDraft.gestionnaire_id}
                      onChange={(event) =>
                        setEntityDraft({
                          ...entityDraft,
                          gestionnaire_id: event.target.value,
                        })
                      }
                    >
                      <option value="">À associer</option>
                      {inventory?.managers.map((manager) => (
                        <option key={manager.id} value={manager.id}>
                          {manager.prenom} {manager.nom}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    Email de facturation
                    <input
                      type="email"
                      value={entityDraft.email}
                      onChange={(event) =>
                        setEntityDraft({
                          ...entityDraft,
                          email: event.target.value,
                        })
                      }
                    />
                  </label>
                </div>
                <h4 className="fiscal-group-title">Informations fiscales</h4>
                <p className="fiscal-hint">
                  À renseigner selon votre situation, sans choisir un régime de
                  TVA par défaut.
                </p>
                <div className="fiscal-form-grid fiscal-form-grid--tax">
                  <label className="field">
                    SIREN (9 chiffres)
                    <input
                      inputMode="numeric"
                      value={entityDraft.siren}
                      onChange={(event) =>
                        setEntityDraft({
                          ...entityDraft,
                          siren: event.target.value,
                        })
                      }
                    />
                  </label>
                  <label className="field">
                    Numéro de TVA intracommunautaire
                    <input
                      value={entityDraft.vat_number}
                      onChange={(event) =>
                        setEntityDraft({
                          ...entityDraft,
                          vat_number: event.target.value,
                        })
                      }
                    />
                  </label>
                  <label className="field">
                    Régime de TVA
                    <select
                      value={entityDraft.vat_regime}
                      onChange={(event) =>
                        setEntityDraft({
                          ...entityDraft,
                          vat_regime: event.target.value as VatRegime,
                        })
                      }
                    >
                      {Object.entries(vatRegimeLabels).map(([key, label]) => (
                        <option value={key} key={key}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <details className="fiscal-help">
                  <summary>Je prépare seulement une connexion de test</summary>
                  <p>
                    La raison sociale suffit à créer la fiche. Laissez le SIREN
                    vide si aucune identité légale de test n’est fournie : le
                    numéro sandbox se saisit dans le volet SuperPDP. N’inventez
                    pas de SIREN/SIRET. L’émission reste bloquée tant que les
                    informations fiscales requises ne sont pas qualifiées.
                  </p>
                </details>
                <h4 className="fiscal-group-title">Adresse du siège</h4>
                <AddressFields
                  value={entityDraft}
                  onChange={(key, value) =>
                    setEntityDraft({ ...entityDraft, [key]: value })
                  }
                />
                <div className="fiscal-save-bar">
                  <span>
                    {entityDirty
                      ? "Les modifications de cette fiche ne sont pas encore enregistrées."
                      : "Enregistrez cette fiche indépendamment des autres volets."}
                  </span>
                  <button type="submit">
                    {saving ? "Enregistrement…" : "Enregistrer l’entreprise"}
                  </button>
                </div>
              </fieldset>
            </form>
          </section>
          <section
            id="fiscal-panel-establishments"
            role="tabpanel"
            aria-labelledby="fiscal-tab-establishments"
            hidden={section !== "establishments"}
            className="fiscal-panel"
          >
            <div className="fiscal-panel-header">
              <h3>2. Les établissements de l’entreprise</h3>
              <p>
                Chaque établissement porte un SIRET. Vous pourrez ensuite le
                sélectionner dans les fiches des gîtes concernés.
              </p>
            </div>
            {selected && (
              <>
                <div
                  className="fiscal-establishment-list"
                  aria-label="Établissements enregistrés"
                >
                  {selected.establishments.map((item) => (
                    <button
                      type="button"
                      className="fiscal-establishment-item"
                      aria-pressed={establishmentId === item.id}
                      disabled={saving}
                      key={item.id}
                      onClick={() => chooseEstablishment(item.id)}
                    >
                      <strong>{item.name}</strong>
                      <span>
                        {item.siret
                          ? `SIRET ${item.siret}`
                          : "SIRET à compléter"}{" "}
                        · {item.gites.length} gîte(s)
                      </span>
                    </button>
                  ))}
                  <button
                    type="button"
                    className="fiscal-establishment-item fiscal-establishment-item--add"
                    disabled={saving}
                    aria-pressed={!establishmentId}
                    onClick={() => chooseEstablishment("")}
                  >
                    + Nouvel établissement
                  </button>
                </div>
                <form onSubmit={saveEstablishment}>
                  <fieldset disabled={saving} className="fiscal-form-fieldset">
                    <legend className="section-subtitle">
                      {establishmentId
                        ? "Modifier l’établissement"
                        : "Ajouter un établissement"}
                    </legend>
                    <div className="fiscal-form-grid">
                      <label className="field">
                        Nom de l’établissement
                        <input
                          required
                          maxLength={250}
                          value={establishmentDraft.name}
                          onChange={(event) =>
                            setEstablishmentDraft({
                              ...establishmentDraft,
                              name: event.target.value,
                            })
                          }
                        />
                      </label>
                      <label className="field">
                        SIRET (14 chiffres)
                        <input
                          inputMode="numeric"
                          value={establishmentDraft.siret}
                          onChange={(event) =>
                            setEstablishmentDraft({
                              ...establishmentDraft,
                              siret: event.target.value,
                            })
                          }
                        />
                      </label>
                    </div>
                    <h4 className="fiscal-group-title">
                      Adresse de l’établissement
                    </h4>
                    <AddressFields
                      value={establishmentDraft}
                      onChange={(key, value) =>
                        setEstablishmentDraft({
                          ...establishmentDraft,
                          [key]: value,
                        })
                      }
                    />
                    <div className="fiscal-save-bar">
                      <span>
                        Le rattachement des gîtes se fait depuis leur fiche.
                      </span>
                      <button type="submit">
                        {saving
                          ? "Enregistrement…"
                          : "Enregistrer l’établissement"}
                      </button>
                    </div>
                  </fieldset>
                </form>
              </>
            )}
          </section>
          <section
            id="fiscal-panel-gites"
            role="tabpanel"
            aria-labelledby="fiscal-tab-gites"
            hidden={section !== "gites"}
            className="fiscal-panel"
          >
            <div className="fiscal-panel-header">
              <h3>3. Les gîtes et leur entreprise facturante</h3>
              <p>
                Ouvrez une fiche gîte pour choisir son établissement facturant.
                Le gestionnaire de contact ne détermine pas à lui seul qui
                facture.
              </p>
            </div>
            {inventory && (
              <>
                <div className="fiscal-inventory-toolbar">
                  <strong>
                    {visibleGites.length} gîte(s){" "}
                    {showAllGites
                      ? "dans l’application"
                      : "pour cette entreprise"}
                  </strong>
                  <label>
                    <input
                      type="checkbox"
                      checked={showAllGites}
                      onChange={(event) =>
                        setShowAllGites(event.target.checked)
                      }
                    />{" "}
                    Afficher tous les gîtes
                  </label>
                </div>
                {!visibleGites.length && (
                  <div className="fiscal-empty">
                    <strong>
                      Aucun gîte rattaché à cette entreprise pour le moment.
                    </strong>
                    <p>
                      Créez un établissement, puis associez-le au gîte concerné.
                    </p>
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => setShowAllGites(true)}
                    >
                      Voir les gîtes à rattacher
                    </button>
                  </div>
                )}
                {!!visibleGites.length && (
                  <div className="fiscal-table-scroll">
                    <table className="table">
                      <caption className="sr-only">
                        Rattachements des gîtes et informations de base à
                        compléter
                      </caption>
                      <thead>
                        <tr>
                          <th>Gîte</th>
                          <th>Entreprise / établissement</th>
                          <th>Informations à compléter</th>
                        </tr>
                      </thead>
                      <tbody>
                        {visibleGites.map((gite) => (
                          <tr key={gite.id}>
                            <td>
                              <a
                                href={`/gites?gite=${encodeURIComponent(gite.id)}&section=base-fiche`}
                              >
                                {gite.nom}
                              </a>
                            </td>
                            <td>
                              {gite.fiscal_establishment
                                ? `${gite.fiscal_establishment.fiscal_entity.legal_name} / ${gite.fiscal_establishment.name}`
                                : "À rattacher"}
                            </td>
                            <td>
                              {gite.missing_fields.length ? (
                                <details className="fiscal-missing">
                                  <summary>
                                    {gite.missing_fields.length} information(s)
                                    à compléter
                                  </summary>
                                  <ul>
                                    {gite.missing_fields.map((field) => (
                                      <li key={field}>{field}</li>
                                    ))}
                                  </ul>
                                </details>
                              ) : (
                                "Informations de base renseignées"
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <p className="field-hint">
                  Ce relevé vérifie la présence des informations de base, pas
                  l’éligibilité fiscale ni la conformité à SuperPDP.
                </p>
                {inventory.managers.filter(
                  (manager) => !manager._count.fiscal_entities,
                ).length > 0 && (
                  <details className="fiscal-help">
                    <summary>Gestionnaires sans entreprise associée</summary>
                    <p>
                      {inventory.managers
                        .filter((manager) => !manager._count.fiscal_entities)
                        .map((manager) => `${manager.prenom} ${manager.nom}`)
                        .join(", ")}
                      .
                    </p>
                  </details>
                )}
              </>
            )}
          </section>
          {canManageIntegrations && (
            <section
              id="fiscal-panel-superpdp"
              role="tabpanel"
              aria-labelledby="fiscal-tab-superpdp"
              hidden={section !== "superpdp"}
              className="fiscal-panel"
            >
              <div className="fiscal-panel-header">
                <div className="fiscal-heading-line">
                  <h3>4. La facturation électronique</h3>
                  <span className="fiscal-badge">Bac à sable uniquement</span>
                </div>
                <p>
                  Connectez cette entreprise à SuperPDP, puis vérifiez la
                  préparation des tests. Aucun envoi automatique ni activation
                  de production.
                </p>
              </div>
              {selected && (
                <SuperPdpConnectionSettings
                  key={selected.id}
                  entityId={selected.id}
                  hasLocalSiren={!!selected.siren}
                  onDirtyChange={setConnectionDirty}
                  onBusyChange={setConnectionBusy}
                />
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}
