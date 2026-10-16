import type { FiscalSettingsSection } from "./FiscalSettingsNavigation";

/** Saving a step never authorizes SuperPDP or loops back from the last step. */
export const nextFiscalSettingsSection = (
  section: FiscalSettingsSection,
  canManageIntegrations: boolean,
): FiscalSettingsSection | null => {
  if (section === "company") return "establishments";
  if (section === "establishments") return "gites";
  if (section === "gites" && canManageIntegrations) return "superpdp";
  return null;
};

/** Drafts here contain only flat text fields; key order must not create a false dirty state. */
export const isFiscalDraftDirty = (
  draft: Record<string, string>,
  baseline: Record<string, string>,
) =>
  new Set([...Object.keys(draft), ...Object.keys(baseline)]).size !==
    Object.keys(draft).length ||
  Object.keys(draft).some((key) => draft[key] !== baseline[key]);
