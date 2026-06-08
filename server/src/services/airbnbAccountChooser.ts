import type { Locator, Page } from "playwright";

const ACCOUNT_CHOOSER_ACTION_LABELS = new Set([
  "continuer",
  "continue",
  "se connecter",
  "connexion",
  "sign in",
  "log in",
]);

const ACCOUNT_CHOOSER_FALLBACK_SELECTORS = [
  'button:has-text("Continuer")',
  '[role="button"]:has-text("Continuer")',
  'a:has-text("Continuer")',
  'button:has-text("Continue")',
  '[role="button"]:has-text("Continue")',
  'a:has-text("Continue")',
  'button:has-text("Se connecter")',
  '[role="button"]:has-text("Se connecter")',
  'a:has-text("Se connecter")',
  'button:has-text("Connexion")',
  '[role="button"]:has-text("Connexion")',
  'a:has-text("Connexion")',
  'button:has-text("Sign in")',
  '[role="button"]:has-text("Sign in")',
  'a:has-text("Sign in")',
  'button:has-text("Log in")',
  '[role="button"]:has-text("Log in")',
  'a:has-text("Log in")',
];

const normalizeActionLabel = (value: string | null | undefined) =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\u00a0/g, " ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

export const isAirbnbAccountChooserActionLabel = (value: string | null | undefined) =>
  ACCOUNT_CHOOSER_ACTION_LABELS.has(normalizeActionLabel(value));

const getVisibleLocator = async (locator: Locator) => {
  const count = await locator.count();
  for (let index = 0; index < count; index += 1) {
    const current = locator.nth(index);
    if (await current.isVisible().catch(() => false)) return current;
  }
  return null;
};

const getControlText = async (locator: Locator) => {
  const [innerText, ariaLabel, title] = await Promise.all([
    locator.innerText().catch(() => ""),
    locator.getAttribute("aria-label").catch(() => ""),
    locator.getAttribute("title").catch(() => ""),
  ]);
  return [innerText, ariaLabel, title].filter(Boolean).join(" ");
};

export const resolveAirbnbAccountChooserContinueButton = async (
  page: Page,
  configuredSelector: string | null | undefined
) => {
  if (configuredSelector) {
    const configuredButton = await getVisibleLocator(page.locator(configuredSelector));
    if (configuredButton) return configuredButton;
  }

  for (const selector of ACCOUNT_CHOOSER_FALLBACK_SELECTORS) {
    const button = await getVisibleLocator(page.locator(selector));
    if (button) return button;
  }

  const controls = page.locator('button, [role="button"], a[href]');
  const count = await controls.count();
  for (let index = 0; index < count; index += 1) {
    const control = controls.nth(index);
    if (!(await control.isVisible().catch(() => false))) continue;
    const text = await getControlText(control);
    if (isAirbnbAccountChooserActionLabel(text)) return control;
  }

  return null;
};
