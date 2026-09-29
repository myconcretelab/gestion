export const buildPhoneHref = (value?: string | null) => {
  const normalized = String(value ?? "").trim().replace(/[^+\d]/g, "");
  return normalized ? `tel:${normalized}` : null;
};

export const formatPhoneForDisplay = (value?: string | null) => {
  const original = String(value ?? "").trim();
  if (!original) return "";

  const digits = original.replace(/\D/g, "");
  if (digits.length === 10) return digits.match(/\d{2}/g)?.join(".") ?? original;

  if (original.startsWith("+") && digits.startsWith("33") && digits.length === 11) {
    const nationalNumber = digits.slice(2);
    return `+33.${nationalNumber[0]}.${nationalNumber.slice(1).match(/\d{2}/g)?.join(".")}`;
  }

  return original;
};
