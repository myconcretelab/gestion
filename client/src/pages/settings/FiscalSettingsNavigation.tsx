import type { KeyboardEvent } from "react";

export const fiscalSettingsSections = [
  { id: "company", label: "Entreprise", description: "Identité et fiscalité" },
  {
    id: "establishments",
    label: "Établissements",
    description: "SIRET et adresses",
  },
  {
    id: "gites",
    label: "Gîtes rattachés",
    description: "Qui facture quel gîte ?",
  },
  { id: "superpdp", label: "SuperPDP", description: "Connexion de test" },
] as const;
export type FiscalSettingsSection =
  (typeof fiscalSettingsSections)[number]["id"];

export default function FiscalSettingsNavigation({
  active,
  hasCompany,
  canManageIntegrations,
  disabled,
  onChange,
}: {
  active: FiscalSettingsSection;
  hasCompany: boolean;
  canManageIntegrations: boolean;
  disabled: boolean;
  onChange: (section: FiscalSettingsSection) => void;
}) {
  const sections = fiscalSettingsSections.filter(
    (section) => section.id !== "superpdp" || canManageIntegrations,
  );
  const locked = (id: FiscalSettingsSection) =>
    disabled || (!hasCompany && id !== "company");
  const navigate = (event: KeyboardEvent<HTMLButtonElement>) => {
    const available = sections.filter((section) => !locked(section.id));
    if (
      !available.length ||
      !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
    )
      return;
    event.preventDefault();
    const index = available.findIndex((section) => section.id === active);
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? available.length - 1
          : (index + (event.key === "ArrowRight" ? 1 : -1) + available.length) %
            available.length;
    const id = available[next].id;
    onChange(id);
    event.currentTarget.parentElement
      ?.querySelector<HTMLButtonElement>(`#fiscal-tab-${id}`)
      ?.focus();
  };
  return (
    <div
      className="fiscal-section-nav"
      role="tablist"
      aria-label="Volets de l’entreprise"
    >
      {sections.map((section, index) => (
        <button
          key={section.id}
          id={`fiscal-tab-${section.id}`}
          type="button"
          role="tab"
          aria-selected={active === section.id}
          aria-controls={`fiscal-panel-${section.id}`}
          tabIndex={active === section.id ? 0 : -1}
          disabled={locked(section.id)}
          onClick={() => onChange(section.id)}
          onKeyDown={navigate}
        >
          <span className="fiscal-section-nav__number" aria-hidden="true">
            {index + 1}
          </span>
          <span>
            <strong>{section.label}</strong>
            <small>{section.description}</small>
          </span>
        </button>
      ))}
    </div>
  );
}
