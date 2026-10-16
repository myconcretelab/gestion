import { useEffect, useState, type FormEvent } from "react";
import {
  fiscalEntitySchema,
  fiscalEstablishmentSchema,
  vatRegimeLabels,
  type VatRegime,
} from "@contrats/shared";
import { apiFetch } from "../../utils/api";
import type { FiscalEntity, FiscalEstablishment } from "../../utils/types";

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
    <div className="grid-2">
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
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const selected = entities.find((entity) => entity.id === entityId);

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
  }, []);

  const chooseEntity = (id: string) => {
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
    setError(null);
    setNotice(null);
  };
  const chooseEstablishment = (id: string) => {
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
      setNotice(
        "Entreprise enregistrée. Vous pouvez renseigner ses établissements ci-dessous.",
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
    <div className="card settings-card settings-card--neutral">
      <h2 className="section-title">Entreprises et facturation</h2>
      <p>
        Renseignez l’entreprise qui facture et ses établissements, puis
        choisissez l’établissement facturant dans chaque fiche gîte.
      </p>
      <p className="field-hint">
        Le gestionnaire est un contact de l’entreprise. Le régime de TVA doit
        être renseigné selon votre situation ; ces informations ne changent pas
        encore le calcul ni les PDF des factures.
      </p>
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
          <label className="field">
            Entreprise à modifier
            <select
              value={entityId}
              onChange={(event) => chooseEntity(event.target.value)}
              disabled={saving}
            >
              <option value="">Nouvelle entreprise</option>
              {entities.map((entity) => (
                <option key={entity.id} value={entity.id}>
                  {entity.legal_name}
                  {entity.siren ? ` — ${entity.siren}` : " — SIREN à compléter"}
                </option>
              ))}
            </select>
          </label>
          <form onSubmit={saveEntity}>
            <fieldset
              disabled={saving}
              style={{ border: 0, padding: 0, margin: 0 }}
            >
              <legend className="section-subtitle">
                {entityId ? "Modifier l’entreprise" : "Ajouter une entreprise"}
              </legend>
              <div className="grid-2">
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
              <p className="section-subtitle">Adresse du siège</p>
              <AddressFields
                value={entityDraft}
                onChange={(key, value) =>
                  setEntityDraft({ ...entityDraft, [key]: value })
                }
              />
              <div className="actions">
                <button type="submit">
                  {saving ? "Enregistrement…" : "Enregistrer l’entreprise"}
                </button>
              </div>
            </fieldset>
          </form>
          {selected && (
            <form onSubmit={saveEstablishment}>
              <fieldset
                disabled={saving}
                style={{ border: 0, padding: 0, margin: "24px 0" }}
              >
                <legend className="section-subtitle">
                  Établissements de {selected.legal_name}
                </legend>
                <label className="field">
                  Établissement à modifier
                  <select
                    value={establishmentId}
                    onChange={(event) =>
                      chooseEstablishment(event.target.value)
                    }
                  >
                    <option value="">Nouvel établissement</option>
                    {selected.establishments.map((item) => (
                      <option value={item.id} key={item.id}>
                        {item.name} — {item.siret || "SIRET à compléter"} (
                        {item.gites.length} gîte(s))
                      </option>
                    ))}
                  </select>
                </label>
                <div className="grid-2">
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
                <AddressFields
                  value={establishmentDraft}
                  onChange={(key, value) =>
                    setEstablishmentDraft({
                      ...establishmentDraft,
                      [key]: value,
                    })
                  }
                />
                <div className="actions">
                  <button type="submit">
                    {saving ? "Enregistrement…" : "Enregistrer l’établissement"}
                  </button>
                </div>
              </fieldset>
            </form>
          )}
          {inventory && (
            <>
              <h3 className="section-subtitle">État des rattachements</h3>
              <p>
                {
                  inventory.gites.filter(
                    (gite) => gite.missing_fields.length > 0,
                  ).length
                }{" "}
                gîte(s) à compléter sur {inventory.gites.length}.
              </p>
              <div style={{ overflowX: "auto" }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Gîte</th>
                      <th>Entreprise / établissement</th>
                      <th>Informations à compléter</th>
                    </tr>
                  </thead>
                  <tbody>
                    {inventory.gites.map((gite) => (
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
                          {gite.missing_fields.join(", ") ||
                            "Informations de base renseignées"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="field-hint">
                Ce relevé vérifie la présence des informations de base, pas
                l’éligibilité fiscale ni la conformité à SuperPDP.
              </p>
              {inventory.managers.filter(
                (manager) => !manager._count.fiscal_entities,
              ).length > 0 && (
                <p className="field-hint">
                  Gestionnaires sans entreprise associée :{" "}
                  {inventory.managers
                    .filter((manager) => !manager._count.fiscal_entities)
                    .map((manager) => `${manager.prenom} ${manager.nom}`)
                    .join(", ")}
                  .
                </p>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
