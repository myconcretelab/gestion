export const DEFAULT_PAYMENT_SOURCE_COLORS: Record<string, string> = {
  Airbnb: "#FF1920",
  Abritel: "#2D8CFF",
  "Gites de France": "#FFD700",
  HomeExchange: "#7C3AED",
  Virement: "#247595",
  "Chèque": "#258AA0",
  "Espèces": "#EF18C8",
  "A définir": "#D3D3D3",
};

export const normalizePaymentLabel = (value: string | null | undefined) =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");

export const normalizePaymentHexColor = (value: string | null | undefined) => {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return null;
  if (/^#[0-9a-f]{6}$/i.test(trimmed)) return trimmed.toUpperCase();
  if (/^#[0-9a-f]{3}$/i.test(trimmed)) {
    return `#${trimmed
      .slice(1)
      .split("")
      .map((char) => `${char}${char}`)
      .join("")
      .toUpperCase()}`;
  }
  return null;
};

export const buildPaymentColorMap = (overrides?: Record<string, string | null | undefined>) => {
  const map: Record<string, string> = {};

  Object.entries(DEFAULT_PAYMENT_SOURCE_COLORS).forEach(([label, color]) => {
    const normalizedColor = normalizePaymentHexColor(color);
    if (!normalizedColor) return;
    map[normalizePaymentLabel(label)] = normalizedColor;
  });

  Object.entries(overrides ?? {}).forEach(([label, color]) => {
    const normalizedLabel = normalizePaymentLabel(label);
    const normalizedColor = normalizePaymentHexColor(color);
    if (!normalizedLabel || !normalizedColor) return;
    map[normalizedLabel] = normalizedColor;
  });

  return map;
};

const DEFAULT_PAYMENT_COLOR_MAP = buildPaymentColorMap();

export const getPaymentColorFromMap = (label: string | null | undefined, paymentColorMap: Record<string, string>) => {
  const payment = normalizePaymentLabel(label);
  if (payment.includes("virmnt/chq")) return paymentColorMap[normalizePaymentLabel("Chèque")] ?? "#258AA0";
  if (payment.includes("chq")) return paymentColorMap[normalizePaymentLabel("Chèque")] ?? "#258AA0";
  if (payment.includes("indefini")) return paymentColorMap[normalizePaymentLabel("A définir")] ?? "#D3D3D3";

  if (payment.includes("airbnb")) return paymentColorMap[normalizePaymentLabel("Airbnb")] ?? "#FF1920";
  if (payment.includes("abritel")) return paymentColorMap[normalizePaymentLabel("Abritel")] ?? "#2D8CFF";
  if (payment.includes("gites de france")) return paymentColorMap[normalizePaymentLabel("Gites de France")] ?? "#FFD700";
  if (payment.includes("homeexchange")) return paymentColorMap[normalizePaymentLabel("HomeExchange")] ?? "#7C3AED";
  if (payment.includes("cheque")) return paymentColorMap[normalizePaymentLabel("Chèque")] ?? "#258AA0";
  if (payment.includes("virement")) return paymentColorMap[normalizePaymentLabel("Virement")] ?? "#247595";
  if (payment.includes("especes")) return paymentColorMap[normalizePaymentLabel("Espèces")] ?? "#EF18C8";
  if (payment.includes("a definir")) return paymentColorMap[normalizePaymentLabel("A définir")] ?? "#D3D3D3";

  return paymentColorMap[payment] ?? "#D3D3D3";
};

export const getPaymentColor = (label: string | null | undefined, overrides?: Record<string, string | null | undefined>) =>
  getPaymentColorFromMap(label, overrides ? buildPaymentColorMap(overrides) : DEFAULT_PAYMENT_COLOR_MAP);

const parseHexColor = (value: string) => {
  const sanitized = value.replace("#", "");
  const normalized =
    sanitized.length === 3
      ? sanitized
          .split("")
          .map((char) => `${char}${char}`)
          .join("")
      : sanitized;

  if (!/^[0-9a-f]{6}$/i.test(normalized)) return null;

  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16),
  };
};

export const getPaymentTextColorFromMap = (label: string | null | undefined, paymentColorMap: Record<string, string>) => {
  const rgb = parseHexColor(getPaymentColorFromMap(label, paymentColorMap));
  if (!rgb) return "#111827";
  const luminance = (rgb.r * 299 + rgb.g * 587 + rgb.b * 114) / 1000;
  return luminance >= 160 ? "#111827" : "#ffffff";
};

export const getPaymentTextColor = (label: string | null | undefined, overrides?: Record<string, string | null | undefined>) =>
  getPaymentTextColorFromMap(label, overrides ? buildPaymentColorMap(overrides) : DEFAULT_PAYMENT_COLOR_MAP);
