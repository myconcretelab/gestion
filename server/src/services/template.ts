const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

export const renderTemplate = (template: string, data: Record<string, string>) => {
  return template.replace(/{{{(\w+)}}}|{{(\w+)}}/g, (_match, rawKey, key) => {
    const value = data[rawKey ?? key] ?? "";
    if (rawKey) return value;
    return escapeHtml(value);
  });
};
