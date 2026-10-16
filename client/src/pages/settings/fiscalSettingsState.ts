/** Drafts here contain only flat text fields; key order must not create a false dirty state. */
export const isFiscalDraftDirty = (
  draft: Record<string, string>,
  baseline: Record<string, string>,
) =>
  new Set([...Object.keys(draft), ...Object.keys(baseline)]).size !==
    Object.keys(draft).length ||
  Object.keys(draft).some((key) => draft[key] !== baseline[key]);
