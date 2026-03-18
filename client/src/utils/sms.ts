const isAppleMobileDevice = () => {
  if (typeof navigator === "undefined") return false;

  const userAgent = navigator.userAgent || "";
  const platform = navigator.platform || "";
  const maxTouchPoints = Number(navigator.maxTouchPoints || 0);

  return /iPhone|iPad|iPod/i.test(userAgent) || (/Mac/i.test(platform) && maxTouchPoints > 1);
};

export const buildSmsHref = (phone: string, body?: string) => {
  const recipient = String(phone ?? "").replace(/[^+\d]/g, "");
  if (!recipient) return null;

  const message = String(body ?? "");
  if (!message) return `sms:${recipient}`;

  const separator = isAppleMobileDevice() ? "&" : "?";
  return `sms:${recipient}${separator}body=${encodeURIComponent(message)}`;
};
