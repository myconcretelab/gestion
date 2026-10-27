export type CleaningBillingMode = "extra" | "included" | "gift";

export type CleaningBillingOption = {
  offert?: boolean;
  inclus?: boolean;
};

export const getCleaningBillingMode = (
  option?: CleaningBillingOption | null,
): CleaningBillingMode =>
  option?.inclus ? "included" : option?.offert ? "gift" : "extra";

export const cleaningBillingPatch = (mode: CleaningBillingMode) => ({
  inclus: mode === "included",
  offert: mode === "gift",
});

export const cleaningBillingSuffix = (option?: CleaningBillingOption | null) =>
  option?.inclus ? " inclus" : option?.offert ? " offert" : "";
