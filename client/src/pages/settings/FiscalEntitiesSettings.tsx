import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  fiscalEntitySchema,
  fiscalEstablishmentSchema,
  vatRegimeLabels,
  fiscalEntityMissingFields,
  type VatRegime,
} from "@contrats/shared";
import { apiFetch } from "../../utils/api";
import type { FiscalEntity, FiscalEstablishment } from "../../utils/types";
import {
  canCurrentUserManageIntegrations,
  canCurrentUserWritePage,
} from "../../utils/auth";
import SuperPdpConnectionSettings from "./SuperPdpConnectionSettings";
import FiscalSettingsNavigation, {
  type FiscalSettingsSection,
} from "./FiscalSettingsNavigation";
import "./fiscalEntitiesSettings.css";
import FiscalUnsavedChangesNotice from "./FiscalUnsavedChangesNotice";
import {
  isFiscalDraftDirty,
  nextFiscalSettingsSection,
} from "./fiscalSettingsState";
import EstablishmentGitePicker from "./EstablishmentGitePicker";
import {
  establishmentGiteChanges,
  linkedGiteIds,
  prefillEstablishmentFromGite,
  type FiscalInventoryGite,
} from "./establishmentGites";

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
  gites: FiscalInventoryGite[];
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
  const settingsRef = useRef<HTMLDivElement>(null);
  const focusNextSection = useRef(false);
  const [entities, setEntities] = useState<FiscalEntity[]>([]);
  const [inventory, setInventory] = useState<Inventory | null>(null);
  const [entityId, setEntityId] = useState("");
  const [entityDraft, setEntityDraft] = useState(emptyEntity);
  const [establishmentId, setEstablishmentId] = useState("");
  const [establishmentDraft, setEstablishmentDraft] =
    useState(emptyEstablishment);
  const [establishmentGiteIds, setEstablishmentGiteIds] = useState<string[]>(
    [],
  );
  const [sourceGiteId, setSourceGiteId] = useState("");
  const [confirmReassignment, setConfirmReassignment] = useState(false);
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
  const giteChanges = establishmentGiteChanges(
    inventory?.gites ?? [],
    establishmentId,
    establishmentGiteIds,
    confirmReassignment,
  );
  const reassignments = giteChanges.filter(
    (link) =>
      link.attach &&
      link.expected_establishment_id &&
      link.expected_establishment_id !== establishmentId,
  );
  const establishmentDirty =
    giteChanges.length > 0 ||
    isFiscalDraftDirty(
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
    if (!focusNextSection.current || saving) return;
    focusNextSection.current = false;
    settingsRef.current
      ?.querySelector<HTMLButtonElement>(`#fiscal-tab-${section}`)
      ?.focus();
  }, [section, saving]);
  const advanceFrom = (current: FiscalSettingsSection) => {
    const next = nextFiscalSettingsSection(current, canManageIntegrations);
    if (!next) return;
    focusNextSection.current = true;
    setSection(next);
  };
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
    return data;
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
          const giteId = new URLSearchParams(window.location.search).get(
            "gite",
          );
          const requestedGite = overview.gites.find(
            (gite) => gite.id === giteId,
          );
          const returned = returnedId
            ? data.find((entity) => entity.id === returnedId)
            : (data.find((entity) =>
                entity.establishments.some(
                  (item) => item.id === requestedGite?.fiscal_establishment_id,
                ),
              ) ?? data[0]);
          if (returned) {
            setEntityId(returned.id);
            setEntityDraft(entityToDraft(returned));
            if (requestedGite) {
              const establishment = returned.establishments.find(
                (item) => item.id === requestedGite.fiscal_establishment_id,
              );
              setEstablishmentId(establishment?.id ?? "");
              setEstablishmentGiteIds(
                establishment
                  ? linkedGiteIds(establishment)
                  : [requestedGite.id],
              );
              setEstablishmentDraft(
                establishment
                  ? {
                      ...addressDraft(establishment),
                      name: establishment.name,
                      siret: establishment.siret ?? "",
                    }
                  : prefillEstablishmentFromGite(
                      emptyEstablishment(),
                      requestedGite,
                    ),
              );
              setSourceGiteId(requestedGite.id);
              setSection("establishments");
            } else if (returned.establishments[0]) {
              const establishment = returned.establishments[0];
              setEstablishmentId(establishment.id);
              setEstablishmentGiteIds(linkedGiteIds(establishment));
              setEstablishmentDraft({
                ...addressDraft(establishment),
                name: establishment.name,
                siret: establishment.siret ?? "",
              });
            }
          } else {
            setSection("company");
            if (returnedId) {
              setNotice(null);
              setError(
                "L’entreprise indiquée dans le retour n’est pas accessible. Sélectionnez une entreprise pour continuer.",
              );
            }
          }
          if (!canManageIntegrations && !requestedGite) setSection("company");
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
    const establishment = entity?.establishments[0];
    setEstablishmentId(establishment?.id ?? "");
    setEstablishmentDraft(
      establishment
        ? {
            ...addressDraft(establishment),
            name: establishment.name,
            siret: establishment.siret ?? "",
          }
        : emptyEstablishment(),
    );
    setEstablishmentGiteIds(linkedGiteIds(establishment));
    setSourceGiteId("");
    setConfirmReassignment(false);
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
    setEstablishmentGiteIds(linkedGiteIds(item));
    setSourceGiteId("");
    setConfirmReassignment(false);
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
      const data = await load();
      if (!establishmentId && !establishmentDirty) {
        const existing = data.find((entity) => entity.id === saved.id)
          ?.establishments[0];
        if (existing) {
          setEstablishmentId(existing.id);
          setEstablishmentGiteIds(linkedGiteIds(existing));
          setEstablishmentDraft({
            ...addressDraft(existing),
            name: existing.name,
            siret: existing.siret ?? "",
          });
        }
      }
      setNotice(
        "Entreprise enregistrée. Étape suivante : ses établissements." +
          (fiscalEntityMissingFields(saved).length
            ? " Des informations fiscales restent à compléter avant l’émission de factures."
            : ""),
      );
      advanceFrom("company");
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
    if (reassignments.length && !confirmReassignment) {
      setError(
        "Confirmez le changement d’établissement des gîtes déjà rattachés avant d’enregistrer.",
      );
      return;
    }
    setSaving(true);
    try {
      const saved = await apiFetch<FiscalEstablishment>(
        `/fiscal-entities/${entityId}/establishments${establishmentId ? `/${establishmentId}` : ""}`,
        {
          method: establishmentId ? "PUT" : "POST",
          json: {
            ...parsed.data,
            expected_updated_at: currentEstablishment?.updatedAt,
            gite_links: giteChanges,
          },
        },
      );
      setEstablishmentId(saved.id);
      setEstablishmentDraft({
        ...addressDraft(saved),
        name: saved.name,
        siret: saved.siret ?? "",
      });
      const refreshed = await load();
      setEstablishmentGiteIds(
        linkedGiteIds(
          refreshed
            .find((entity) => entity.id === entityId)
            ?.establishments.find((item) => item.id === saved.id),
        ),
      );
      setConfirmReassignment(false);
      setNotice(
        "Établissement et rattachements enregistrés. Étape suivante : le récapitulatif." +
          (!saved.siret ? " Le SIRET reste à compléter avant émission." : ""),
      );
      advanceFrom("establishments");
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Enregistrement impossible.",
      );
    } finally {
      setSaving(false);
    }
  };

  const continueFromGites = async () => {
    if (!selected || !canManageIntegrations) return;
    if (establishmentDirty || entityDirty) {
      setError("Enregistrez d’abord vos modifications avant de continuer.");
      setSection(establishmentDirty ? "establishments" : "company");
      return;
    }
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const data = await load();
      const refreshed = data.find((entity) => entity.id === entityId);
      if (!refreshed)
        throw new Error("Cette entreprise n’est plus accessible.");
      const linked = new Set(
        refreshed.establishments.flatMap((item) =>
          item.gites.map((gite) => gite.id),
        ),
      ).size;
      setNotice(
        linked
          ? "Rattachements actualisés. Étape suivante : la connexion SuperPDP de test. Cette étape ne déclenche ni autorisation ni envoi de facture."
          : "Aucun gîte n’est encore rattaché. Vous pouvez néanmoins préparer la connexion SuperPDP de test, sans autorisation ni envoi automatique.",
      );
      advanceFrom("gites");
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Actualisation impossible.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fiscal-settings" ref={settingsRef}>
      <header className="fiscal-page-header">
        <div className="fiscal-eyebrow">Organisation · Facturation</div>
        <h2>Entreprises et facturation</h2>
        <p>
          Une entreprise, ses établissements avec leurs gîtes, puis un
          récapitulatif. Avancez à votre rythme, volet par volet.
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
                      : "Après l’enregistrement, vous passerez au volet Établissements."}
                  </span>
                  <button type="submit">
                    {saving ? "Enregistrement…" : "Enregistrer et continuer"}
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
                Choisissez les gîtes facturés ici, puis vérifiez le SIRET et
                l’adresse officielle de leur établissement facturant. Un même
                établissement peut facturer plusieurs gîtes.
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
                    <EstablishmentGitePicker
                      gites={inventory?.gites ?? []}
                      selectedIds={establishmentGiteIds}
                      establishmentId={establishmentId}
                      disabled={saving || !canCurrentUserWritePage("gites")}
                      onToggle={(gite, checked) => {
                        setEstablishmentGiteIds((ids) =>
                          checked
                            ? [...ids, gite.id]
                            : ids.filter((id) => id !== gite.id),
                        );
                        setConfirmReassignment(false);
                        if (checked && !establishmentId && !sourceGiteId) {
                          setSourceGiteId(gite.id);
                          setEstablishmentDraft((draft) =>
                            prefillEstablishmentFromGite(draft, gite),
                          );
                        }
                      }}
                    />
                    {!canCurrentUserWritePage("gites") && (
                      <p className="fiscal-hint">
                        Le droit de modification des gîtes est nécessaire pour
                        changer leurs rattachements.
                      </p>
                    )}
                    {reassignments.length > 0 && (
                      <div className="fiscal-callout">
                        <p>
                          Ces gîtes changeront d’établissement facturant :{" "}
                          {reassignments
                            .map(
                              (link) =>
                                inventory?.gites.find(
                                  (gite) => gite.id === link.gite_id,
                                )?.nom,
                            )
                            .join(", ")}
                          . Les factures déjà émises restent inchangées.
                        </p>
                        <label className="fiscal-check">
                          <input
                            type="checkbox"
                            checked={confirmReassignment}
                            onChange={(event) =>
                              setConfirmReassignment(event.target.checked)
                            }
                          />
                          Je confirme ce changement de rattachement.
                        </label>
                      </div>
                    )}
                    {establishmentGiteIds.length > 0 && (
                      <details
                        className="fiscal-prefill"
                        open={!establishmentId}
                      >
                        <summary>
                          Reprendre le nom et l’adresse d’un gîte (facultatif)
                        </summary>
                        <label className="field">
                          Reprendre les coordonnées d’un gîte
                          <select
                            value={sourceGiteId}
                            onChange={(event) =>
                              setSourceGiteId(event.target.value)
                            }
                          >
                            <option value="">
                              Choisir un gîte sélectionné
                            </option>
                            {inventory?.gites
                              .filter((gite) =>
                                establishmentGiteIds.includes(gite.id),
                              )
                              .map((gite) => (
                                <option value={gite.id} key={gite.id}>
                                  {gite.nom}
                                </option>
                              ))}
                          </select>
                        </label>
                        <button
                          type="button"
                          className="secondary"
                          disabled={
                            !establishmentGiteIds.includes(sourceGiteId)
                          }
                          onClick={() => {
                            const gite = inventory?.gites.find(
                              (item) => item.id === sourceGiteId,
                            );
                            if (gite)
                              setEstablishmentDraft((draft) =>
                                prefillEstablishmentFromGite(draft, gite),
                              );
                          }}
                        >
                          Préremplir les champs vides
                        </button>
                        <p className="fiscal-hint">
                          Le nom et l’adresse disponibles sont repris sans
                          écraser vos saisies. Vérifiez l’adresse officielle,
                          complétez la ville et le code postal. Le SIRET n’est
                          jamais déduit du nom du gîte.
                        </p>
                      </details>
                    )}
                    <h4 className="fiscal-group-title">
                      Identité de l’établissement facturant
                    </h4>
                    <div className="fiscal-form-grid">
                      <label className="field">
                        Nom de l’établissement (repère dans l’application)
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
                        <span className="field-hint">
                          Vous pouvez conserver le nom repris du gîte ou
                          utiliser un nom commun à plusieurs gîtes.
                        </span>
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
                        {establishmentGiteIds.length} gîte(s) sélectionné(s).
                        L’établissement et les rattachements seront enregistrés
                        ensemble.
                      </span>
                      <button type="submit">
                        {saving
                          ? "Enregistrement…"
                          : "Enregistrer et continuer"}
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
              <h3>3. Récapitulatif de facturation</h3>
              <p>
                Vérifiez qui facture chaque gîte et les informations restant à
                compléter. Les rattachements se modifient dans le volet
                Établissements.
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
                      Sélectionnez les gîtes dans le volet Établissements, puis
                      enregistrez.
                    </p>
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => setSection("establishments")}
                    >
                      Rattacher des gîtes
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
                          <th>SIRET facturant / informations à compléter</th>
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
                              <div>
                                {gite.fiscal_establishment?.siret
                                  ? `SIRET ${gite.fiscal_establishment.siret}`
                                  : "SIRET à compléter"}
                              </div>
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
                <button
                  type="button"
                  className="secondary"
                  disabled={saving}
                  onClick={() => setSection("establishments")}
                >
                  Modifier les établissements et les gîtes
                </button>
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
                {canManageIntegrations && (
                  <div className="fiscal-save-bar">
                    <span>
                      Votre configuration est enregistrée. SuperPDP est une
                      connexion de test facultative ; continuer ne transmet
                      aucune facture.
                    </span>
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => void continueFromGites()}
                    >
                      {saving
                        ? "Actualisation…"
                        : "Continuer vers SuperPDP (facultatif)"}
                    </button>
                  </div>
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
