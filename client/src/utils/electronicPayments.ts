// Exact decimal padding only. Invalid precision is never silently rounded.
export const normalizeReceiptAmount = (value: string) => {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) return value;
  const [whole, fraction = ""] = value.split(".");
  return `${whole.replace(/^0+(?=\d)/, "")}.${fraction.padEnd(2, "0")}`;
};
