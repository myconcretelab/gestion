import fs from "node:fs";
import path from "node:path";
import { chromium, type Browser, type BrowserContext, type Page, type Response as PlaywrightResponse, type Request as PlaywrightRequest } from "playwright";
import { getPumpStorageStateId, type PumpAutomationConfig, type PumpFilterRule } from "./pumpAutomationConfig.js";

const DEFAULT_MULTI_STEP_SELECTORS = {
  continueWithEmail: [
    'button:has-text("Continuer avec un email")',
    'button:has-text("Continuer avec un e-mail")',
    '[role="button"]:has-text("Continuer avec un email")',
    '[role="button"]:has-text("Continuer avec un e-mail")',
    'button:has-text("Continue with email")',
    '[role="button"]:has-text("Continue with email")',
  ],
  continueAfterUsername: [
    'button:has-text("Continuer")',
    'button:has-text("Continue")',
    'button:has-text("Suivant")',
    'button:has-text("Next")',
    'button[type="submit"]',
  ],
  submitPassword: [
    'button:has-text("Connexion")',
    'button:has-text("Se connecter")',
    'button:has-text("Continuer")',
    'button:has-text("Continue")',
    'button:has-text("Sign in")',
    'button:has-text("Log in")',
    'button[type="submit"]',
  ],
};

type CapturedResponse = {
  url: string;
  method: string;
  status: number;
  headers: Record<string, string>;
  contentType: string;
  body: unknown;
  isJson: boolean;
  timestamp: string;
  context: string;
  keptByFilters: boolean;
  filterExplanation: string;
  requestHeaders: Record<string, string>;
  filename?: string;
};

type PendingResponse = {
  startedAt: number;
  url: string;
  method: string;
};

type ResolvedScrollTarget = {
  exists: boolean;
  found: boolean;
  relation?: string;
  depth?: number;
  selector: string | null;
  tagName?: string;
  overflowX?: string;
  isVisible?: boolean;
  scrollWidth?: number;
  clientWidth?: number;
  scrollHeight?: number;
  clientHeight?: number;
  isHorizontallyScrollable: boolean;
  isVerticallyScrollable?: boolean;
  canScrollProgrammatically?: boolean;
  score?: number;
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const logInfo = (message: string, data?: unknown) =>
  console.log(`[pump-local] ${message}`, data ?? "");
const logWarn = (message: string, data?: unknown) =>
  console.warn(`[pump-local] ${message}`, data ?? "");
const logError = (message: string, data?: unknown) =>
  console.error(`[pump-local] ${message}`, data ?? "");

const resolveBooleanSetting = (value: string | undefined, fallback: boolean) => {
  if (!value) return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
};

const hasDisplayServer = () => Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY);
const shouldForceHeadlessWithoutDisplay = () => process.platform === "linux" && !hasDisplayServer();

const resolvePlaywrightLaunchOptions = () => {
  const requestedHeadless = resolveBooleanSetting(process.env.PLAYWRIGHT_HEADLESS, process.env.NODE_ENV === "production");
  const disableSandbox = resolveBooleanSetting(process.env.PLAYWRIGHT_DISABLE_SANDBOX, false);
  const headless = shouldForceHeadlessWithoutDisplay() ? true : requestedHeadless;

  return {
    headless,
    args: disableSandbox ? ["--no-sandbox", "--disable-setuid-sandbox"] : [],
  };
};

const getStorageStatePath = (config: PumpAutomationConfig, storageStatesRoot: string) => {
  if (!config.persistSession) return null;
  fs.mkdirSync(storageStatesRoot, { recursive: true });
  return path.join(storageStatesRoot, `${getPumpStorageStateId(config)}.json`);
};

const ensureUsernameAvailable = (config: PumpAutomationConfig) => {
  if (!config.username) {
    throw new Error("Authentification requise mais username/email absent.");
  }
};

const ensurePasswordAvailable = (password: string | undefined | null, config: PumpAutomationConfig) => {
  if (password) return;
  if (config.persistSession === false) {
    throw new Error("Authentification requise mais mot de passe absent.");
  }
  throw new Error("Session Airbnb expirée ou indisponible. Fournissez PUMP_SESSION_PASSWORD pour la rafraîchir.");
};

const waitForElement = async (page: Page, selector: string, timeout = 10_000, visible = true) => {
  try {
    await page.waitForSelector(selector, { timeout, state: visible ? "visible" : "attached" });
    return true;
  } catch {
    return false;
  }
};

const waitForNavigation = async (page: Page, timeout = 30_000) => {
  try {
    await page.waitForLoadState("networkidle", { timeout });
    return true;
  } catch {
    return false;
  }
};

const findFirstSelector = async (page: Page, selectors: Array<string | null | undefined>, timeout = 5_000) => {
  for (const selector of selectors.filter(Boolean) as string[]) {
    const found = await waitForElement(page, selector, timeout, true);
    if (found) return selector;
  }
  return null;
};

const clickFirstSelector = async (page: Page, selectors: Array<string | null | undefined>, timeout = 5_000) => {
  const selector = await findFirstSelector(page, selectors, timeout);
  if (!selector) return null;
  await page.click(selector);
  return selector;
};

const fillRequiredField = async (
  page: Page,
  selectors: Array<string | null | undefined>,
  value: string,
  fieldName: string,
  timeout = 10_000
) => {
  const selector = await findFirstSelector(page, selectors, timeout);
  if (!selector) {
    throw new Error(`${fieldName} introuvable.`);
  }
  await page.fill(selector, value);
  return selector;
};

export const checkIfLoginRequired = async (page: Page, config: PumpAutomationConfig) => {
  const selectors = [
    config.advancedSelectors.usernameInput,
    config.advancedSelectors.passwordInput,
    config.advancedSelectors.emailFirstButton,
  ].filter(Boolean);

  for (const selector of selectors) {
    const exists = await page.locator(selector).first().isVisible().catch(() => false);
    if (exists) return true;
  }

  const currentUrl = page.url().toLowerCase();
  if (currentUrl.includes("login") || currentUrl.includes("auth")) {
    return true;
  }

  return false;
};

const waitForLoginCompletion = async (page: Page, config: PumpAutomationConfig, method: string, timeout = 180_000) => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeout) {
    const loginRequired = await checkIfLoginRequired(page, config);
    if (!loginRequired) {
      await waitForNavigation(page, 5_000).catch(() => false);
      return { success: true, method };
    }
    await wait(1_000);
  }
  throw new Error("La connexion Airbnb n'a pas été finalisée à temps.");
};

const performSimpleLogin = async (page: Page, config: PumpAutomationConfig, password: string) => {
  ensureUsernameAvailable(config);
  ensurePasswordAvailable(password, config);

  await fillRequiredField(page, [config.advancedSelectors.usernameInput], config.username, "Champ username");
  await fillRequiredField(page, [config.advancedSelectors.passwordInput], password, "Champ mot de passe");
  const submitSelector = await clickFirstSelector(page, [config.advancedSelectors.submitButton, ...DEFAULT_MULTI_STEP_SELECTORS.submitPassword], 10_000);
  if (!submitSelector) {
    throw new Error("Bouton de validation de connexion introuvable.");
  }

  if (config.hasOTP) {
    return waitForLoginCompletion(page, config, "otp");
  }

  await waitForNavigation(page, 30_000);
  return { success: true, method: "simple" };
};

const performMultiStepLogin = async (page: Page, config: PumpAutomationConfig, password: string) => {
  ensureUsernameAvailable(config);
  ensurePasswordAvailable(password, config);

  const usernameSelector = await findFirstSelector(page, [config.advancedSelectors.usernameInput], 3_000);

  if (!usernameSelector) {
    const emailButton = await clickFirstSelector(
      page,
      [config.advancedSelectors.emailFirstButton, ...DEFAULT_MULTI_STEP_SELECTORS.continueWithEmail],
      5_000
    );
    if (!emailButton) {
      throw new Error("Bouton 'continuer avec email' introuvable.");
    }
    await waitForNavigation(page, 10_000);
  }

  await fillRequiredField(page, [config.advancedSelectors.usernameInput], config.username, "Champ username");

  const passwordVisible = await findFirstSelector(page, [config.advancedSelectors.passwordInput], 1_500);
  if (!passwordVisible) {
    const continueSelector = await clickFirstSelector(
      page,
      [config.advancedSelectors.continueAfterUsernameButton, config.advancedSelectors.submitButton, ...DEFAULT_MULTI_STEP_SELECTORS.continueAfterUsername],
      10_000
    );
    if (!continueSelector) {
      throw new Error("Bouton continuer après username introuvable.");
    }
    await waitForNavigation(page, 10_000);
  }

  await fillRequiredField(page, [config.advancedSelectors.passwordInput], password, "Champ mot de passe");
  const submitSelector = await clickFirstSelector(
    page,
    [config.advancedSelectors.finalSubmitButton, config.advancedSelectors.submitButton, ...DEFAULT_MULTI_STEP_SELECTORS.submitPassword],
    10_000
  );
  if (!submitSelector) {
    throw new Error("Bouton final de connexion introuvable.");
  }

  if (config.hasOTP) {
    return waitForLoginCompletion(page, config, "otp");
  }

  await waitForNavigation(page, 30_000);
  return { success: true, method: "multi-step" };
};

const getTriangularOffset = () => Math.random() - Math.random();

const getHumanizedValue = (baseValue: number, jitterRatio: number, minimumValue: number) => {
  const safeBaseValue = Math.max(minimumValue, Math.round(baseValue));
  const jitterRange = Math.max(1, Math.round(safeBaseValue * jitterRatio));
  const randomizedValue = safeBaseValue + Math.round(getTriangularOffset() * jitterRange);
  return Math.max(minimumValue, randomizedValue);
};

const getElementBounds = async (page: Page, selector: string) => {
  try {
    const element = await page.$(selector);
    if (!element) return null;
    return await element.boundingBox();
  } catch {
    return null;
  }
};

const getScrollableInfo = async (page: Page, selector: string) =>
  page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    return {
      scrollLeft: el.scrollLeft,
      scrollTop: el.scrollTop,
      scrollWidth: el.scrollWidth,
      scrollHeight: el.scrollHeight,
      clientWidth: el.clientWidth,
      clientHeight: el.clientHeight,
    };
  }, selector);

// Keep this callback free of named inner helpers: tsx/esbuild injects `__name(...)`
// for nested functions, and Playwright executes the serialized callback in the page.
const resolveHorizontalScrollTarget = async (page: Page, selector: string): Promise<ResolvedScrollTarget> =>
  page.evaluate((sel): ResolvedScrollTarget => {
    const root = document.querySelector(sel);
    if (!root) {
      return { exists: false, found: false, selector: null, isHorizontallyScrollable: false };
    }

    const candidatesToInspect: Array<{ el: Element; relation: string; depth: number }> = [{ el: root, relation: "self", depth: 0 }];

    let current = root.parentElement;
    let parentDepth = 1;
    while (current && parentDepth <= 6) {
      candidatesToInspect.push({ el: current, relation: "parent", depth: parentDepth });
      current = current.parentElement;
      parentDepth += 1;
    }

    const queue = Array.from(root.children).map((child) => ({ el: child as Element, depth: 1 }));
    while (queue.length > 0) {
      const item = queue.shift();
      if (!item) break;
      candidatesToInspect.push({ el: item.el, relation: "child", depth: item.depth });
      if (item.depth < 6) {
        queue.push(...Array.from(item.el.children).map((child) => ({ el: child as Element, depth: item.depth + 1 })));
      }
    }

    const candidates = candidatesToInspect.map(({ el, relation, depth }) => {
      const style = window.getComputedStyle(el);
      const overflowX = style.overflowX;
      const isHorizontallyScrollable = el.scrollWidth > el.clientWidth + 1;
      const rect = el.getBoundingClientRect();
      const isVisible = rect.width > 0 && rect.height > 0;
      const initialScrollLeft = el.scrollLeft;
      let canScrollProgrammatically = false;

      if (isHorizontallyScrollable) {
        const probeDistance = Math.min(32, Math.max(1, el.scrollWidth - el.clientWidth));
        try {
          el.scrollLeft = initialScrollLeft + probeDistance;
          canScrollProgrammatically = el.scrollLeft !== initialScrollLeft;
        } catch {
          canScrollProgrammatically = false;
        } finally {
          el.scrollLeft = initialScrollLeft;
        }
      }

      const relationWeight = relation === "self" ? 30 : relation === "parent" ? Math.max(0, 24 - depth) : 12 - depth;
      const overflowWeight = ["auto", "scroll", "overlay", "hidden"].includes(overflowX) ? 8 : 0;
      const score =
        (canScrollProgrammatically ? 1000 : 0) +
        (isHorizontallyScrollable ? 200 : 0) +
        (isVisible ? 50 : 0) +
        Math.max(relationWeight, 0) +
        overflowWeight;

      const cssSelector = ((node: Element | null): string | null => {
        if (!node) return null;
        if (node.id) return `#${CSS.escape(node.id)}`;

        const parts: string[] = [];
        let selectorNode: Element | null = node;
        while (selectorNode && selectorNode !== document.body) {
          const currentNode: Element = selectorNode;
          let part = currentNode.tagName.toLowerCase();
          if (currentNode.classList.length > 0) {
            part += `.${Array.from(currentNode.classList)
              .slice(0, 3)
              .map((name: string) => CSS.escape(name))
              .join(".")}`;
          }

          const parentElement: Element | null = currentNode.parentElement;
          if (parentElement) {
            const siblings = Array.from(parentElement.children).filter(
              (child): child is Element => child instanceof Element && child.tagName === currentNode.tagName
            );
            if (siblings.length > 1) {
              part += `:nth-of-type(${siblings.indexOf(currentNode) + 1})`;
            }
          }

          parts.unshift(part);
          selectorNode = parentElement;
        }

        return parts.join(" > ");
      })(el);

      return {
        exists: true,
        found: true,
        relation,
        depth,
        selector: cssSelector,
        tagName: el.tagName.toLowerCase(),
        overflowX,
        isVisible,
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
        isHorizontallyScrollable,
        isVerticallyScrollable: el.scrollHeight > el.clientHeight + 1,
        canScrollProgrammatically,
        score,
      } satisfies ResolvedScrollTarget;
    });

    const selfInfo = candidates[0] as ResolvedScrollTarget;
    const bestCandidate = candidates
      .filter((candidate) => candidate.isHorizontallyScrollable)
      .sort((left, right) => right.score - left.score)[0];

    return bestCandidate || selfInfo;
  }, selector);

const scrollWithDirectModification = async (page: Page, selector: string, config: PumpAutomationConfig) => {
  for (let i = 0; i < config.scrollCount; i += 1) {
    const initialScroll = await getScrollableInfo(page, selector);
    const distance = getHumanizedValue(config.scrollDistance, 0.12, 1);
    const delay = getHumanizedValue(config.scrollDelay, 0.18, 0);

    await page.evaluate(
      ({ sel, dist }) => {
        const el = document.querySelector(sel);
        if (el) {
          el.scrollLeft += dist;
        }
      },
      { sel: selector, dist: distance }
    );

    if (i < config.scrollCount - 1 && delay > 0) {
      await wait(delay);
    }

    const finalScroll = await getScrollableInfo(page, selector);
    if (initialScroll && finalScroll && finalScroll.scrollLeft === initialScroll.scrollLeft) {
      throw new Error(`Le scroll n'a pas bougé pour ${selector}.`);
    }
  }
};

const scrollWithMouseWheel = async (page: Page, selector: string, config: PumpAutomationConfig) => {
  const bounds = await getElementBounds(page, selector);
  if (!bounds) {
    throw new Error("Impossible de lire les dimensions de la zone de scroll.");
  }

  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;

  for (let i = 0; i < config.scrollCount; i += 1) {
    const distance = getHumanizedValue(config.scrollDistance, 0.12, 1);
    const delay = getHumanizedValue(config.scrollDelay, 0.18, 0);
    const pointerOffsetX = getTriangularOffset() * Math.min(18, Math.max(6, bounds.width * 0.08));
    const pointerOffsetY = getTriangularOffset() * Math.min(12, Math.max(4, bounds.height * 0.08));

    await page.mouse.move(centerX + pointerOffsetX, centerY + pointerOffsetY, {
      steps: 6 + Math.floor(Math.random() * 7),
    });
    await page.mouse.wheel(distance, 0);

    if (i < config.scrollCount - 1 && delay > 0) {
      await wait(delay);
    }
  }
};

const shouldKeepResponse = (
  request: { url: string; method: string },
  response: { status: number; headers: Record<string, string>; body: unknown },
  filters: PumpAutomationConfig["filterRules"]
) => {
  const evaluateRule = (rule: PumpFilterRule) => {
    let result = false;
    switch (rule.type) {
      case "url-contains":
        result = request.url.includes(rule.pattern || "");
        break;
      case "url-starts-with":
        result = request.url.startsWith(rule.pattern || "");
        break;
      case "method":
        result = request.method === String(rule.pattern || "").toUpperCase();
        break;
      case "content-type":
        result = String(response.headers["content-type"] || "").includes(rule.pattern || "");
        break;
      case "status-code":
        result = response.status === Number.parseInt(String(rule.pattern || ""), 10);
        break;
      case "status-range": {
        const [minStatus, maxStatus] = String(rule.pattern || "")
          .split("-")
          .map(Number);
        result = Number.isFinite(minStatus) && Number.isFinite(maxStatus) && response.status >= minStatus && response.status <= maxStatus;
        break;
      }
      case "response-contains":
        result =
          typeof response.body === "string"
            ? response.body.includes(rule.pattern || "")
            : JSON.stringify(response.body ?? "").includes(rule.pattern || "");
        break;
      case "json-only":
        result = String(response.headers["content-type"] || "").includes("application/json");
        break;
      case "exclude-assets": {
        const url = request.url.toLowerCase();
        result =
          !url.includes(".png") &&
          !url.includes(".jpg") &&
          !url.includes(".gif") &&
          !url.includes(".svg") &&
          !url.includes(".webp") &&
          !url.includes(".css") &&
          !url.includes(".woff") &&
          !url.includes(".ttf") &&
          !url.includes(".eot") &&
          !url.includes(".otf");
        break;
      }
      case "exclude-tracking": {
        const trackingDomains = ["google-analytics", "analytics", "doubleclick", "facebook.com/tr", "hotjar", "amplitude"];
        const lower = request.url.toLowerCase();
        result = !trackingDomains.some((domain) => lower.includes(domain));
        break;
      }
      default:
        result = false;
    }

    return rule.negate ? !result : result;
  };

  const { inclusive = [], exclusive = [] } = filters || { inclusive: [], exclusive: [] };
  let shouldInclude = inclusive.length === 0;

  if (inclusive.length > 0) {
    shouldInclude = inclusive.some(evaluateRule);
  }

  if (shouldInclude && exclusive.length > 0) {
    shouldInclude = !exclusive.some(evaluateRule);
  }

  return shouldInclude;
};

const getFilterExplanation = (
  request: { url: string; method: string },
  response: { status: number; headers: Record<string, string>; body: unknown },
  filters: PumpAutomationConfig["filterRules"]
) => {
  if (!filters || (!filters.inclusive.length && !filters.exclusive.length)) {
    return "No filters applied, keeping all responses";
  }

  const parts: string[] = [];
  const evaluateRule = (rule: PumpFilterRule) =>
    shouldKeepResponse(request, response, { inclusive: [rule], exclusive: [] });

  if (filters.inclusive.length > 0) {
    parts.push(filters.inclusive.some(evaluateRule) ? "Matched inclusive rule(s)" : "Did not match inclusive rules");
  }
  if (filters.exclusive.length > 0) {
    parts.push(filters.exclusive.some(evaluateRule) ? "Matched exclusive rule(s) - EXCLUDED" : "Did not match exclusive rules");
  }
  return parts.join(" | ");
};

const readResponseBodyWithTimeout = async (response: PlaywrightResponse, contentType: string, timeoutMs = 3_000) => {
  let bodyPromise: Promise<{ value: unknown; isJson: boolean }> | null = null;
  if (contentType.includes("application/json")) {
    bodyPromise = response.json().then((value) => ({ value, isJson: true }));
  } else if (contentType.includes("text/")) {
    bodyPromise = response.text().then((value) => ({ value, isJson: false }));
  } else {
    return { body: null, isJson: false, timedOut: false };
  }

  const result = (await Promise.race([
    bodyPromise.then((value) => ({ timedOut: false, ...value })).catch((error) => ({ error })),
    wait(timeoutMs).then(() => ({ timedOut: true })),
  ])) as { timedOut: false; value: unknown; isJson: boolean } | { timedOut: true } | { error: unknown };

  if ("error" in result) {
    throw result.error;
  }
  if (result.timedOut) {
    return { body: null, isJson: false, timedOut: true };
  }

  return {
    body: result.value ?? null,
    isJson: Boolean(result.isJson),
    timedOut: false,
  };
};

export class PumpNetworkCapture {
  page: Page | null;
  filters: PumpAutomationConfig["filterRules"];
  capturedResponses: CapturedResponse[];
  capturedRequests: Map<string, Record<string, unknown>>;
  context: string;
  isListening: boolean;
  pendingResponses: Map<Promise<void>, PendingResponse>;
  lastActivityAt: number;
  responseListener: ((response: PlaywrightResponse) => void) | null;
  requestListener: ((request: PlaywrightRequest) => void) | null;

  constructor(page: Page | null, filters: PumpAutomationConfig["filterRules"]) {
    this.page = page;
    this.filters = filters;
    this.capturedResponses = [];
    this.capturedRequests = new Map();
    this.context = "before-scroll";
    this.isListening = false;
    this.pendingResponses = new Map();
    this.lastActivityAt = Date.now();
    this.responseListener = null;
    this.requestListener = null;
  }

  async start() {
    if (!this.page || this.isListening) return;

    this.responseListener = (response) => {
      this.lastActivityAt = Date.now();
      const startedAt = Date.now();
      const pending = this.handleResponse(response).finally(() => {
        this.pendingResponses.delete(pending);
        this.lastActivityAt = Date.now();
      });
      this.pendingResponses.set(pending, {
        startedAt,
        url: response.url(),
        method: response.request().method(),
      });
    };

    this.requestListener = (request) => {
      this.lastActivityAt = Date.now();
      this.handleRequest(request);
    };

    this.page.on("response", this.responseListener);
    this.page.on("request", this.requestListener);
    this.isListening = true;
  }

  handleRequest(request: PlaywrightRequest) {
    const key = `${request.method()}:${request.url()}:${this.capturedRequests.size}`;
    this.capturedRequests.set(key, {
      url: request.url(),
      method: request.method(),
      headers: request.headers(),
      timestamp: new Date().toISOString(),
      context: this.context,
    });
  }

  async waitForSettled(options: { idleMs?: number; timeoutMs?: number; pollMs?: number; stalePendingMs?: number } = {}) {
    const idleMs = options.idleMs ?? 1_000;
    const timeoutMs = options.timeoutMs ?? 10_000;
    const pollMs = options.pollMs ?? 100;
    const stalePendingMs = options.stalePendingMs ?? 5_000;
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
      const idleFor = Date.now() - this.lastActivityAt;
      const pendingEntries = [...this.pendingResponses.entries()];

      if (pendingEntries.length === 0 && idleFor >= idleMs) {
        return true;
      }

      if (pendingEntries.length > 0) {
        const stalePending = pendingEntries.filter(([, metadata]) => Date.now() - metadata.startedAt >= stalePendingMs);
        if (idleFor >= idleMs && stalePending.length === pendingEntries.length) {
          logWarn("Finalizing with stale pending responses", {
            pendingResponses: pendingEntries.length,
            urls: stalePending.map(([, metadata]) => metadata.url).slice(0, 5),
          });
          return false;
        }
      }

      const remainingMs = timeoutMs - (Date.now() - startedAt);
      await Promise.race([
        Promise.allSettled(pendingEntries.map(([pending]) => pending)),
        wait(Math.min(pollMs, idleMs, remainingMs)),
      ]);
    }

    logWarn("Network capture settle timeout reached", {
      pendingResponses: this.pendingResponses.size,
      idleFor: Date.now() - this.lastActivityAt,
    });
    return false;
  }

  async handleResponse(response: PlaywrightResponse) {
    try {
      const url = response.url();
      const method = response.request().method();
      const status = response.status();
      const headers = response.headers();
      const contentType = headers["content-type"] || "";

      let body: unknown = null;
      let isJson = false;
      try {
        const bodyResult = await readResponseBodyWithTimeout(response, contentType);
        if (!bodyResult.timedOut) {
          body = bodyResult.body;
          isJson = bodyResult.isJson;
        }
      } catch {
        // Body parsing is best-effort.
      }

      const request = {
        url,
        method,
      };

      const shouldKeep = shouldKeepResponse(request, { status, headers, body }, this.filters);
      this.capturedResponses.push({
        url,
        method,
        status,
        headers,
        contentType,
        body,
        isJson,
        timestamp: new Date().toISOString(),
        context: this.context,
        keptByFilters: shouldKeep,
        filterExplanation: getFilterExplanation(request, { status, headers, body }, this.filters),
        requestHeaders: response.request().headers(),
      });
    } catch (error) {
      logWarn("Error handling captured response", error);
    }
  }

  setContext(context: string) {
    this.context = context;
  }

  getResponses() {
    return [...this.capturedResponses];
  }

  getResponseCount() {
    return this.capturedResponses.length;
  }

  getKeptResponses() {
    return this.capturedResponses.filter((response) => response.keptByFilters);
  }

  getKeptResponseCount() {
    return this.getKeptResponses().length;
  }

  getFilteredResponseCount() {
    return this.capturedResponses.filter((response) => !response.keptByFilters).length;
  }

  getTotalRequestsCount() {
    return this.capturedRequests.size;
  }

  getSummary() {
    return {
      totalRequests: this.getTotalRequestsCount(),
      totalResponses: this.getResponseCount(),
      keptResponses: this.getKeptResponseCount(),
      filteredResponses: this.getFilteredResponseCount(),
    };
  }

  stop() {
    if (!this.page) return;
    if (this.responseListener) {
      this.page.off("response", this.responseListener);
    }
    if (this.requestListener) {
      this.page.off("request", this.requestListener);
    }
    this.responseListener = null;
    this.requestListener = null;
    this.isListening = false;
  }
}

export class PumpPlaywrightSession {
  config: PumpAutomationConfig;
  browser: Browser | null;
  page: Page | null;
  context: BrowserContext | null;
  storageStatePath: string | null;
  loadedPersistedState: boolean;
  isAuthenticated: boolean;

  constructor(config: PumpAutomationConfig, storageStatesRoot: string) {
    this.config = config;
    this.browser = null;
    this.page = null;
    this.context = null;
    this.storageStatePath = getStorageStatePath(config, storageStatesRoot);
    this.loadedPersistedState = false;
    this.isAuthenticated = false;
  }

  async initialize(
    launchOverrides: Partial<{
      headless: boolean;
      args: string[];
    }> = {}
  ) {
    const launchOptions = resolvePlaywrightLaunchOptions();
    this.browser = await chromium.launch({
      ...launchOptions,
      ...launchOverrides,
      args: launchOverrides.args ?? launchOptions.args,
    });
    this.context = await this.createContext();
    this.page = await this.context.newPage();
    if (shouldForceHeadlessWithoutDisplay() && launchOptions.headless) {
      logInfo("No display detected, forcing headless mode.");
    }
  }

  async createContext() {
    if (!this.browser) {
      throw new Error("Le navigateur Playwright n'est pas initialisé.");
    }
    if (!this.storageStatePath || !fs.existsSync(this.storageStatePath)) {
      this.loadedPersistedState = false;
      return this.browser.newContext();
    }

    try {
      const context = await this.browser.newContext({ storageState: this.storageStatePath });
      this.loadedPersistedState = true;
      return context;
    } catch (error) {
      this.loadedPersistedState = false;
      logWarn("Failed to load persisted Airbnb session.", error);
      return this.browser.newContext();
    }
  }

  async navigate(url: string) {
    if (!this.page) throw new Error("La page Playwright n'est pas initialisée.");
    await this.page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
  }

  async performLogin(password: string) {
    if (!this.page) throw new Error("La page Playwright n'est pas initialisée.");

    const loginRequired = await checkIfLoginRequired(this.page, this.config);
    if (!loginRequired && this.loadedPersistedState) {
      this.isAuthenticated = true;
      return { success: true, method: "persisted" };
    }

    if (this.config.authMode === "persisted-only") {
      throw new Error(
        "Session Airbnb expirée ou absente. Le mode phase 1 utilise uniquement une session persistée importée depuis le local."
      );
    }

    const result =
      this.config.loginStrategy === "multi-step"
        ? await performMultiStepLogin(this.page, this.config, password)
        : await performSimpleLogin(this.page, this.config, password);

    this.isAuthenticated = Boolean(result.success);
    return result;
  }

  async waitBeforeAction() {
    await wait(this.config.waitBeforeScroll || 2_000);
  }

  async performScrollSequence() {
    if (!this.page) throw new Error("La page Playwright n'est pas initialisée.");

    await this.waitBeforeAction();

    if (this.config.manualScrollMode) {
      await wait(this.config.manualScrollDuration || 20_000);
      return { mode: "manual", duration: this.config.manualScrollDuration || 20_000 };
    }

    const selectorReady = await waitForElement(this.page, this.config.scrollSelector, 15_000, true);
    if (!selectorReady) {
      throw new Error(`Zone de scroll introuvable: ${this.config.scrollSelector}`);
    }

    const resolvedTarget = await resolveHorizontalScrollTarget(this.page, this.config.scrollSelector);
    if (!resolvedTarget.exists || !resolvedTarget.selector || !resolvedTarget.isHorizontallyScrollable) {
      throw new Error(`Zone ${this.config.scrollSelector} non scrollable horizontalement.`);
    }

    try {
      await scrollWithDirectModification(this.page, resolvedTarget.selector, this.config);
    } catch (error) {
      logWarn("Direct scrolling failed, trying mouse wheel fallback.", error);
      await scrollWithMouseWheel(this.page, resolvedTarget.selector, this.config);
    }

    return getScrollableInfo(this.page, resolvedTarget.selector);
  }

  async testLogin(password: string) {
    await this.initialize();
    try {
      await this.navigate(this.config.baseUrl);
      await this.waitBeforeAction();
      return await this.performLogin(password);
    } finally {
      await this.close();
    }
  }

  async testScrollTarget(password: string) {
    await this.initialize();
    try {
      await this.navigate(this.config.baseUrl);
      await this.waitBeforeAction();
      await this.performLogin(password);
      if (!this.page) throw new Error("La page Playwright n'est pas initialisée.");

      const resolvedTarget = await resolveHorizontalScrollTarget(this.page, this.config.scrollSelector);
      if (!resolvedTarget.exists || !resolvedTarget.selector) {
        throw new Error(`Zone introuvable: ${this.config.scrollSelector}`);
      }
      if (!resolvedTarget.isHorizontallyScrollable) {
        throw new Error(`Zone non scrollable horizontalement: ${this.config.scrollSelector}`);
      }
      return resolvedTarget;
    } finally {
      await this.close();
    }
  }

  getPage() {
    return this.page;
  }

  async saveStorageState() {
    if (!this.storageStatePath || !this.context || !this.isAuthenticated) return;
    fs.mkdirSync(path.dirname(this.storageStatePath), { recursive: true });
    await this.context.storageState({ path: this.storageStatePath });
  }

  async close() {
    try {
      await this.saveStorageState();
      await this.page?.close().catch(() => undefined);
      await this.context?.close().catch(() => undefined);
      await this.browser?.close().catch(() => undefined);
    } catch (error) {
      logWarn("Error while closing Playwright session.", error);
    } finally {
      this.page = null;
      this.context = null;
      this.browser = null;
    }
  }
}

const sanitizeFilename = (str: string) =>
  str
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 200);

const generateResponseFilename = (response: CapturedResponse, index: number) => {
  try {
    const url = new URL(response.url);
    const pathname = url.pathname.split("/").pop() || "api-response";
    return `${String(index).padStart(4, "0")}_${response.method.toLowerCase()}_${sanitizeFilename(pathname || "response")}.json`;
  } catch {
    return `${String(index).padStart(4, "0")}_${response.method.toLowerCase()}_response.json`;
  }
};

export const generatePumpSessionId = () => {
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, "");
  const timeStr = now.toTimeString().slice(0, 8).replace(/:/g, "");
  const random = Math.random().toString(36).slice(2, 8);
  return `session_${dateStr}_${timeStr}_${random}`;
};

const buildResponseSearchText = (response: CapturedResponse) =>
  [
    response.url,
    response.method,
    response.contentType,
    response.context,
    response.filterExplanation,
    typeof response.body === "string" ? response.body : JSON.stringify(response.body ?? ""),
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, 4_000);

export class PumpSessionSaver {
  sessionId: string;
  config: PumpAutomationConfig;
  baseDir: string;
  responsesDir: string;
  logsDir: string;

  constructor(sessionId: string, config: PumpAutomationConfig, sessionsRoot: string) {
    this.sessionId = sessionId;
    this.config = config;
    const rootDir = config.outputFolder ? path.join(config.outputFolder, "pump_sessions") : sessionsRoot;
    this.baseDir = path.join(rootDir, sessionId);
    this.responsesDir = path.join(this.baseDir, "responses");
    this.logsDir = path.join(this.baseDir, "logs");
    fs.mkdirSync(this.responsesDir, { recursive: true });
    fs.mkdirSync(this.logsDir, { recursive: true });
  }

  saveResponse(response: CapturedResponse, index: number) {
    const filename = generateResponseFilename(response, index);
    const filepath = path.join(this.responsesDir, filename);
    fs.writeFileSync(
      filepath,
      JSON.stringify(
        {
          filename,
          url: response.url,
          method: response.method,
          status: response.status,
          headers: response.headers,
          requestHeaders: response.requestHeaders,
          contentType: response.contentType,
          body: response.body,
          timestamp: response.timestamp,
          context: response.context,
          keptByFilters: response.keptByFilters,
          filterExplanation: response.filterExplanation,
        },
        null,
        2
      ),
      "utf-8"
    );
    return filename;
  }

  saveMetadata(networkCapture: PumpNetworkCapture) {
    const filepath = path.join(this.baseDir, "metadata.json");
    const responses = networkCapture.getResponses();
    fs.writeFileSync(
      filepath,
      JSON.stringify(
        {
          sessionId: this.sessionId,
          timestamp: new Date().toISOString(),
          config: {
            baseUrl: this.config.baseUrl,
            scrollSelector: this.config.scrollSelector,
          },
          responses: responses.map((response, index) => ({
            index,
            filename: response.filename || null,
            url: response.url,
            method: response.method,
            status: response.status,
            contentType: response.contentType,
            context: response.context,
            timestamp: response.timestamp,
            hasBody: Boolean(response.body),
            keptByFilters: response.keptByFilters !== false,
            filterExplanation: response.filterExplanation,
            searchText: buildResponseSearchText(response),
          })),
          totalCaptured: responses.length,
        },
        null,
        2
      ),
      "utf-8"
    );
  }

  saveSessionSummary(networkCapture: PumpNetworkCapture, errors: Array<{ message: string; timestamp: string }>, duration: number) {
    const filepath = path.join(this.baseDir, "session_summary.json");
    fs.writeFileSync(
      filepath,
      JSON.stringify(
        {
          session: {
            id: this.sessionId,
            startTime: new Date().toISOString(),
            duration,
            success: errors.length === 0,
          },
          configuration: {
            baseUrl: this.config.baseUrl,
            scrollSelector: this.config.scrollSelector,
            scrollConfig: {
              count: this.config.scrollCount,
              distance: this.config.scrollDistance,
              delay: this.config.scrollDelay,
            },
          },
          results: networkCapture.getSummary(),
          errors:
            errors.length > 0
              ? errors
              : [
                  {
                    message: "No errors",
                    timestamp: new Date().toISOString(),
                  },
                ],
        },
        null,
        2
      ),
      "utf-8"
    );
  }

  saveHAR(networkCapture: PumpNetworkCapture) {
    if (!this.config.enableHAR) return;
    const filepath = path.join(this.baseDir, "session.har");
    fs.writeFileSync(
      filepath,
      JSON.stringify(
        {
          log: {
            version: "1.2.0",
            creator: {
              name: "contrats-pump-local",
              version: "1.0.0",
            },
            entries: networkCapture.getResponses().map((response) => ({
              startedDateTime: response.timestamp,
              time: 0,
              request: {
                method: response.method,
                url: response.url,
                httpVersion: "HTTP/1.1",
                headers: Object.entries(response.requestHeaders || {}).map(([name, value]) => ({
                  name,
                  value: String(value),
                })),
                queryString: [],
                cookies: [],
                headersSize: -1,
                bodySize: -1,
              },
              response: {
                status: response.status,
                statusText: "",
                httpVersion: "HTTP/1.1",
                headers: Object.entries(response.headers || {}).map(([name, value]) => ({
                  name,
                  value: String(value),
                })),
                cookies: [],
                content: {
                  size: 0,
                  mimeType: response.contentType || "application/octet-stream",
                  text: response.body ? JSON.stringify(response.body) : "",
                },
                redirectURL: "",
                headersSize: -1,
                bodySize: -1,
              },
              cache: {},
              timings: {
                wait: 0,
                receive: 0,
                send: 0,
              },
            })),
          },
        },
        null,
        2
      ),
      "utf-8"
    );
  }

  saveResponsesLog(networkCapture: PumpNetworkCapture) {
    const filepath = path.join(this.logsDir, "responses.log");
    const lines = networkCapture.getResponses().map(
      (response, index) =>
        `${index + 1}. ${response.timestamp} | ${response.keptByFilters ? "KEPT" : "FILTERED"} | ${response.method} ${response.status} | ${response.context} | ${response.url}`
    );
    fs.writeFileSync(filepath, lines.join("\n"), "utf-8");
  }

  getSessionDir() {
    return this.baseDir;
  }
}

export const persistCapturedSession = (
  saver: PumpSessionSaver,
  networkCapture: PumpNetworkCapture,
  errors: Array<{ message: string; timestamp: string }>,
  duration: number
) => {
  const responses = networkCapture.getResponses();
  let savedResponses = 0;

  responses.forEach((response, index) => {
    response.filename = saver.saveResponse(response, index);
    savedResponses += 1;
  });

  saver.saveMetadata(networkCapture);
  saver.saveSessionSummary(networkCapture, errors, duration);
  saver.saveHAR(networkCapture);
  saver.saveResponsesLog(networkCapture);

  return {
    sessionId: saver.sessionId,
    savedResponses,
    totalRequests: networkCapture.getTotalRequestsCount(),
    totalResponses: networkCapture.getResponseCount(),
    keptResponses: networkCapture.getKeptResponseCount(),
    filteredResponses: networkCapture.getFilteredResponseCount(),
    sessionDir: saver.getSessionDir(),
    summary: networkCapture.getSummary(),
    persistenceErrors: [] as string[],
  };
};

export { logError, logInfo, logWarn };
