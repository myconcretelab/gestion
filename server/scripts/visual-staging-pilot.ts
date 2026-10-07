import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { chromium, type BrowserContext, type Page } from "playwright";
import { systemPrisma } from "../src/db/prisma.js";
import { HISTORICAL_ORGANIZATION_ID } from "../src/modules/organizations/context.js";
import { createServerAuthSession } from "../src/services/serverAuth.js";

const baseURL = (process.env.STAGING_BASE_URL ?? "http://localhost:4000").replace(/\/$/, "");
const credentialsPath = path.resolve(process.cwd(), "..", "data", "pilot-staging-credentials.json");
const outputDir = process.env.STAGING_VISUAL_OUTPUT_DIR ?? "/tmp";

const captureMainPaths = async (page: Page, prefix: string, expectedPlan: RegExp) => {
  await page.goto(`${baseURL}/abonnement`, { waitUntil: "networkidle" });
  await page.getByText(expectedPlan).first().waitFor();
  const subscription = path.join(outputDir, `${prefix}-abonnement.png`);
  await page.screenshot({ path: subscription, fullPage: true });
  await page.goto(baseURL, { waitUntil: "networkidle" });
  const home = path.join(outputDir, `${prefix}-accueil.png`);
  await page.screenshot({ path: home, fullPage: true });
  return { subscription, home };
};

const authenticatePilot = async (context: BrowserContext) => {
  if (!fs.existsSync(credentialsPath)) throw new Error("Identifiants du pilote de staging introuvables.");
  const credentials = JSON.parse(fs.readFileSync(credentialsPath, "utf8")) as { login: string; password: string };
  const page = await context.newPage();
  await page.goto(baseURL, { waitUntil: "networkidle" });
  await page.getByLabel("Identifiant ou e-mail").fill(credentials.login);
  await page.getByLabel("Mot de passe", { exact: true }).fill(credentials.password);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.getByLabel("Identifiant ou e-mail").waitFor({ state: "detached" });
  return page;
};

const removeContextSession = async (context: BrowserContext) => {
  const cookie = (await context.cookies(baseURL)).find((item) => item.name === "contrats_session");
  if (!cookie?.value) return;
  await removeSessionToken(cookie.value);
};

const removeSessionToken = async (token: string) => {
  const id = crypto.createHash("sha256").update(token).digest("hex");
  await systemPrisma.authSession.deleteMany({ where: { id } });
};

const main = async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const pilotContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    let pilot: Awaited<ReturnType<typeof captureMainPaths>>;
    try {
      const pilotPage = await authenticatePilot(pilotContext);
      pilot = await captureMainPaths(pilotPage, "contrats-phase3-pilot", /Pilote provisoire/i);
    } finally {
      await removeContextSession(pilotContext);
      await pilotContext.close();
    }

    const historicalOwner = await systemPrisma.appUser.findFirst({
      where: { organization_id: HISTORICAL_ORGANIZATION_ID, is_owner: true, is_active: true },
      orderBy: { createdAt: "asc" },
    });
    if (!historicalOwner) throw new Error("Aucun propriétaire historique actif n’est disponible pour le contrôle visuel.");
    const historicalSession = await createServerAuthSession(historicalOwner.id, 1, HISTORICAL_ORGANIZATION_ID);
    let historicalContext: BrowserContext | null = null;
    let historical: Awaited<ReturnType<typeof captureMainPaths>>;
    try {
      historicalContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
      await historicalContext.addCookies([{ name: "contrats_session", value: historicalSession.id, url: baseURL, httpOnly: true, sameSite: "Lax" }]);
      const historicalPage = await historicalContext.newPage();
      historical = await captureMainPaths(historicalPage, "contrats-phase3-historique", /Historique illimité/i);
    } finally {
      if (historicalContext) {
        await removeContextSession(historicalContext);
        await historicalContext.close();
      } else {
        await removeSessionToken(historicalSession.id);
      }
    }

    console.log(JSON.stringify({ checked: true, baseURL, pilot, historical }, null, 2));
  } finally {
    await browser.close();
    await systemPrisma.$disconnect();
  }
};

await main();
