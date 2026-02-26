import fs from "fs/promises";
import path from "path";
import { chromium, Browser, Page } from "playwright";
import { renderTemplate } from "./template.js";
import { formatDate } from "../utils/dates.js";
import { formatEuro, round2, toNumber, type NumericLike } from "../utils/money.js";
import type { ContractTotals, OptionsInput } from "./contractCalculator.js";

let browser: Browser | null = null;
let browserLaunchPromise: Promise<Browser> | null = null;
let templateCache: { contractHtml: string; conditionsHtml: string } | null = null;
let invoiceTemplateCache: string | null = null;
const MAX_BROWSER_ATTEMPTS = 3;
const MINIMAL_PDF_BUFFER = Buffer.from("%PDF-1.1\n%%EOF\n", "utf-8");

const isPdfGenerationDisabled = () => process.env.SKIP_PDF_GENERATION === "1";

const writePlaceholderPdf = async (outputPath: string) => {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, MINIMAL_PDF_BUFFER);
};

type GiteLike = {
  nom: string;
  adresse_ligne1: string;
  adresse_ligne2?: string | null;
  proprietaires_noms: string;
  proprietaires_adresse: string;
  capacite_max: number;
  site_web?: string | null;
  email?: string | null;
  telephones: unknown;
  taxe_sejour_par_personne_par_nuit: NumericLike;
  iban: string;
  bic?: string | null;
  titulaire: string;
  caracteristiques?: string | null;
  regle_animaux_acceptes: boolean;
  regle_bois_premiere_flambee: boolean;
  regle_tiers_personnes_info: boolean;
  options_draps_par_lit: NumericLike;
  options_linge_toilette_par_personne: NumericLike;
  options_menage_forfait: NumericLike;
  options_depart_tardif_forfait: NumericLike;
  options_chiens_forfait: NumericLike;
};

export type ContractRenderInput = {
  numero_contrat: string;
  locataire_nom: string;
  locataire_adresse: string;
  locataire_tel: string;
  nb_adultes: number;
  nb_enfants_2_17: number;
  date_debut: Date | null;
  heure_arrivee: string;
  date_fin: Date | null;
  heure_depart: string;
  prix_par_nuit: NumericLike;
  remise_montant: NumericLike;
  arrhes_montant: NumericLike;
  arrhes_date_limite: Date;
  solde_montant: NumericLike;
  cheque_menage_montant: NumericLike;
  caution_montant: NumericLike;
  afficher_caution_phrase?: boolean;
  afficher_cheque_menage_phrase?: boolean;
  options: OptionsInput | string;
  clauses?: Record<string, unknown> | string | null;
  notes?: string | null;
};

export type InvoiceRenderInput = {
  numero_facture: string;
  locataire_nom: string;
  locataire_adresse: string;
  locataire_tel: string;
  nb_adultes: number;
  nb_enfants_2_17: number;
  date_debut: Date | null;
  heure_arrivee: string;
  date_fin: Date | null;
  heure_depart: string;
  prix_par_nuit: NumericLike;
  remise_montant: NumericLike;
  arrhes_montant: NumericLike;
  arrhes_date_limite: Date;
  solde_montant: NumericLike;
  cheque_menage_montant: NumericLike;
  caution_montant: NumericLike;
  afficher_caution_phrase?: boolean;
  afficher_cheque_menage_phrase?: boolean;
  options: OptionsInput | string;
  clauses?: Record<string, unknown> | string | null;
  statut_paiement?: "non_reglee" | "reglee";
  notes?: string | null;
};

const getBrowser = async () => {
  if (browser && browser.isConnected()) {
    return browser;
  }
  if (browser && !browser.isConnected()) {
    browser = null;
  }
  if (!browserLaunchPromise) {
    browserLaunchPromise = chromium
      .launch({ args: ["--no-sandbox"] })
      .then((launchedBrowser) => {
        browser = launchedBrowser;
        browserLaunchPromise = null;
        launchedBrowser.on("disconnected", () => {
          if (browser === launchedBrowser) {
            browser = null;
          }
        });
        return launchedBrowser;
      })
      .catch((error) => {
        browser = null;
        browserLaunchPromise = null;
        throw error;
      });
  }
  return browserLaunchPromise;
};

const resetBrowserState = async () => {
  const activeBrowser = browser ?? (browserLaunchPromise ? await browserLaunchPromise.catch(() => null) : null);
  browser = null;
  browserLaunchPromise = null;
  if (activeBrowser) {
    await activeBrowser.close().catch(() => undefined);
  }
};

export const closeBrowser = async () => {
  await resetBrowserState();
};

const isClosedBrowserError = (error: unknown) => {
  if (!(error instanceof Error)) return false;
  return /Target page, context or browser has been closed|Browser has been closed|has been closed/i.test(
    error.message
  );
};

const withPageRetry = async <T>(operation: (page: Page) => Promise<T>): Promise<T> => {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_BROWSER_ATTEMPTS; attempt += 1) {
    let page: Page | null = null;
    try {
      const activeBrowser = await getBrowser();
      page = await activeBrowser.newPage();
      return await operation(page);
    } catch (error) {
      lastError = error;
      const canRetry = isClosedBrowserError(error) && attempt < MAX_BROWSER_ATTEMPTS;
      if (!canRetry) throw error;
      await resetBrowserState();
    } finally {
      if (page) {
        await page.close().catch(() => undefined);
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Erreur Playwright inconnue");
};

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const formatTel = (telephones: unknown) => {
  if (Array.isArray(telephones)) {
    return telephones.filter(Boolean).join(" / ");
  }
  if (typeof telephones === "string") {
    try {
      const parsed = JSON.parse(telephones);
      if (Array.isArray(parsed)) return parsed.filter(Boolean).join(" / ");
    } catch {
      return telephones;
    }
    return telephones;
  }
  return "";
};

const resolveContractRules = (gite: GiteLike, options?: OptionsInput) => ({
  regle_animaux_acceptes: options?.regle_animaux_acceptes ?? gite.regle_animaux_acceptes,
  regle_bois_premiere_flambee:
    options?.regle_bois_premiere_flambee ?? gite.regle_bois_premiere_flambee,
  regle_tiers_personnes_info:
    options?.regle_tiers_personnes_info ?? gite.regle_tiers_personnes_info,
});

const buildGiteCaracteristiquesHtml = (value: string | null | undefined) => {
  if (!value) return "";
  const items = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!items.length) return "";
  return `<ul class="caracteristiques-list">${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
};

const formatOptionalDate = (value: Date | string | null | undefined, fallback = "À renseigner") => {
  if (!value) return fallback;
  const date = typeof value === "string" ? new Date(value) : value;
  if (!Number.isFinite(date.getTime())) return fallback;
  return formatDate(date);
};

const formatCountLabel = (count: number, singular: string, plural?: string) => {
  const resolvedPlural = plural ?? `${singular}s`;
  return `${count} ${count === 1 ? singular : resolvedPlural}`;
};

const buildProprietairesContactHtml = (gite: GiteLike) => {
  const lines: string[] = [];
  if (gite.site_web) {
    lines.push(`<div class="link">${escapeHtml(gite.site_web)}</div>`);
  }
  if (gite.email) {
    lines.push(`<div class="link">${escapeHtml(gite.email)}</div>`);
  }
  const tel = formatTel(gite.telephones);
  if (tel) {
    lines.push(`<div>T/ ${escapeHtml(tel)}</div>`);
  }
  return lines.join("");
};

const buildLocataireAdresseHtml = (value: string | null | undefined) => {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) {
    return '<span class="write-line write-line--address"></span><br /><span class="write-line write-line--address"></span>';
  }
  return normalized
    .split(/\r?\n/)
    .map((line) => escapeHtml(line))
    .join("<br />");
};

const buildNotesHtml = (params: { gite: GiteLike; options: OptionsInput }) => {
  const { gite, options } = params;
  const regles = resolveContractRules(gite, options);
  const notes: string[] = [];
  if (!regles.regle_animaux_acceptes) {
    notes.push("Les animaux ne sont pas acceptés.");
  }
  if (regles.regle_tiers_personnes_info) {
    notes.push("Les propriétaires doivent être informés de l'éventuel accès au gîte de tierces personnes.");
  }
  if (regles.regle_bois_premiere_flambee) {
    notes.push("En hiver, bois fourni pour une première flambée.");
  }
  if (!notes.length) {
    return "<p class=\"small muted\">Aucune mention particulière.</p>";
  }
  return `<ul>${notes.map((note) => `<li>${escapeHtml(note)}</li>`).join("")}</ul>`;
};

const buildPaiementSurPlaceHtml = (params: {
  soldeMontant: string;
  chequeMenageMontant: string;
  cautionMontant: string;
  afficherChequeMenagePhrase: boolean;
  afficherCautionPhrase: boolean;
}) => {
  const extras: string[] = [];
  if (params.afficherChequeMenagePhrase) {
    extras.push(
      `le chèque de ménage de ${params.chequeMenageMontant} (encaissé que si le ménage n’est pas correctement fait à votre départ)`
    );
  }
  if (params.afficherCautionPhrase) {
    extras.push(`le chèque de caution de ${params.cautionMontant}`);
  }

  let tail = ".";
  if (extras.length === 1) {
    tail = `, en même temps que ${extras[0]}.`;
  } else if (extras.length === 2) {
    tail = `, en même temps que ${extras[0]} et ${extras[1]}.`;
  }

  return `<p>Le montant restant de la location, soit ${params.soldeMontant} sera payé le jour de la remise des clés${tail}</p>`;
};

const parseJsonField = <T>(value: unknown, fallback: T): T => {
  if (value === null || value === undefined) return fallback;
  if (typeof value !== "string") return value as T;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

const formatSignedEuro = (value: number, sign: "+" | "-") =>
  `${sign} ${formatEuro(Math.abs(value))}`;

const buildClientOptionsFormHtml = (params: {
  options: OptionsInput;
  totals: ContractTotals;
  gite: GiteLike;
}) => {
  const { options, totals, gite } = params;
  const regles = resolveContractRules(gite, options);
  const rows: string[] = [];
  const line = (size: "line--xs" | "line--sm" | "line--md" | "line--lg") => `<span class="line ${size}"></span>`;
  const buildRow = (params: { label: string; meta: string; calcHtml?: string; metaInline?: boolean }) => `
    <div class="option-form__row">
      <div class="option-form__left">
        <span class="option-form__circle"></span>
        <div class="option-form__text${params.metaInline ? " option-form__text--inline" : ""}">
          <span class="option-form__label">${escapeHtml(params.label)}</span>
          ${
            params.metaInline
              ? `<span class="option-form__meta option-form__meta--inline">${escapeHtml(params.meta)}</span>`
              : `<span class="option-form__meta">${escapeHtml(params.meta)}</span>`
          }
        </div>
      </div>
      ${
        params.calcHtml
          ? `<div class="option-form__right">
        <span class="option-form__calc">${params.calcHtml}</span>
      </div>`
          : ""
      }
    </div>
  `;

  if (!options.draps?.enabled) {
    const tarif = toNumber(gite.options_draps_par_lit);
    const tarifDisplay = escapeHtml(formatEuro(tarif));
    rows.push(
      buildRow({
        label: "Draps",
        meta: `${formatEuro(tarif)} / lit / séjour`,
        calcHtml: `${tarifDisplay} × ${line("line--sm")} lits = ${line("line--md")} €`,
      })
    );
  }

  if (!options.linge_toilette?.enabled) {
    const tarif = toNumber(gite.options_linge_toilette_par_personne);
    const tarifDisplay = escapeHtml(formatEuro(tarif));
    rows.push(
      buildRow({
        label: "Linge de toilette",
        meta: `${formatEuro(tarif)} / personne / séjour`,
        calcHtml: `${tarifDisplay} × ${line("line--sm")} personnes = ${line("line--md")} €`,
      })
    );
  }

  if (!options.menage?.enabled) {
    const tarif = toNumber(gite.options_menage_forfait);
    rows.push(
      buildRow({
        label: "Ménage fin de séjour",
        meta: `Forfait ${formatEuro(tarif)}`,
        metaInline: true,
      })
    );
  }

  if (!options.depart_tardif?.enabled) {
    const tarif = toNumber(gite.options_depart_tardif_forfait);
    rows.push(
      buildRow({
        label: "Départ tardif",
        meta: `Forfait ${formatEuro(tarif)}`,
        metaInline: true,
      })
    );
  }

  if (regles.regle_animaux_acceptes && !options.chiens?.enabled) {
    const tarif = toNumber(gite.options_chiens_forfait);
    const tarifDisplay = escapeHtml(formatEuro(tarif));
    rows.push(
      buildRow({
        label: "Chiens",
        meta: `${formatEuro(tarif)} / nuit / chien`,
        calcHtml: `${tarifDisplay} × ${line("line--xs")} chiens × ${escapeHtml(
          String(totals.nbNuits)
        )} nuit(s) = ${line("line--md")} €`,
      })
    );
  }

  if (!rows.length) return "";

  return `
    <div class="option-form">
      <div class="option-form__title">
        Services annexes en option, à régler sur place (à entourer si souhaités) :
      </div>
      <div class="option-form__list">
        ${rows.join("\n")}
      </div>
    </div>
  `;
};

const buildOptionsBandRowsHtml = (params: {
  options: OptionsInput;
  totals: ContractTotals;
  gite: GiteLike;
}) => {
  const rows: string[] = [];
  const { options, totals, gite } = params;
  const regles = resolveContractRules(gite, options);
  const nbNuits = totals.nbNuits;
  const anyOption =
    options.draps?.enabled ||
    options.linge_toilette?.enabled ||
    options.menage?.enabled ||
    options.depart_tardif?.enabled ||
    (regles.regle_animaux_acceptes && options.chiens?.enabled);

  if (options.draps?.enabled) {
    const nbLits = options.draps.nb_lits ?? 0;
    const tarif = toNumber(gite.options_draps_par_lit);
    const base = round2(tarif * nbLits);
    rows.push(
      `<tr class="band-option"><td>Draps (${nbLits} lit(s) x ${formatEuro(tarif)} / séjour)</td><td>${formatSignedEuro(
        base,
        "+"
      )}</td></tr>`
    );
    if (options.draps?.offert) {
      rows.push(
        `<tr class="band-option band-discount"><td>Offre exeptionelle - Draps</td><td>${formatSignedEuro(
          base,
          "-"
        )}</td></tr>`
      );
    }
  }
  if (options.linge_toilette?.enabled) {
    const nbPersonnes = options.linge_toilette.nb_personnes ?? 0;
    const tarif = toNumber(gite.options_linge_toilette_par_personne);
    const base = round2(tarif * nbPersonnes);
    rows.push(
      `<tr class="band-option"><td>Linge de toilette (${nbPersonnes} pers. x ${formatEuro(
        tarif
      )} / séjour)</td><td>${formatSignedEuro(base, "+")}</td></tr>`
    );
    if (options.linge_toilette?.offert) {
      rows.push(
        `<tr class="band-option band-discount"><td>Offre exeptionelle - Linge de toilette</td><td>${formatSignedEuro(
          base,
          "-"
        )}</td></tr>`
      );
    }
  }
  if (options.menage?.enabled) {
    const tarif = toNumber(gite.options_menage_forfait);
    const base = round2(tarif);
    rows.push(
      `<tr class="band-option"><td>Ménage fin de séjour</td><td>${formatSignedEuro(base, "+")}</td></tr>`
    );
    if (options.menage?.offert) {
      rows.push(
        `<tr class="band-option band-discount"><td>Offre exeptionelle - Ménage fin de séjour</td><td>${formatSignedEuro(
          base,
          "-"
        )}</td></tr>`
      );
    }
  }
  if (options.depart_tardif?.enabled) {
    const tarif = toNumber(gite.options_depart_tardif_forfait);
    const base = round2(tarif);
    rows.push(
      `<tr class="band-option"><td>Départ tardif</td><td>${formatSignedEuro(base, "+")}</td></tr>`
    );
    if (options.depart_tardif?.offert) {
      rows.push(
        `<tr class="band-option band-discount"><td>Offre exeptionelle - Départ tardif</td><td>${formatSignedEuro(
          base,
          "-"
        )}</td></tr>`
      );
    }
  }
  if (regles.regle_animaux_acceptes && options.chiens?.enabled) {
    const nbChiens = options.chiens.nb ?? 1;
    const tarif = toNumber(gite.options_chiens_forfait);
    const base = round2(tarif * nbChiens * nbNuits);
    rows.push(
      `<tr class="band-option"><td>Chiens (${nbChiens} x ${nbNuits} nuit(s) x ${formatEuro(
        tarif
      )})</td><td>${formatSignedEuro(base, "+")}</td></tr>`
    );
    if (options.chiens?.offert) {
      rows.push(
        `<tr class="band-option band-discount"><td>Offre exeptionelle - Chiens</td><td>${formatSignedEuro(
          base,
          "-"
        )}</td></tr>`
      );
    }
  }

  if (!anyOption) {
    rows.push(`<tr class="band-option"><td>Options</td><td>${formatSignedEuro(0, "+")}</td></tr>`);
  }

  return rows.join("\n");
};

const buildClausesHtml = (params: {
  gite: GiteLike;
  options: OptionsInput;
  clauses: Record<string, unknown> | null;
}) => {
  const clauses: string[] = [];
  const { gite, options } = params;
  const regles = resolveContractRules(gite, options);

  if (regles.regle_animaux_acceptes && options.chiens?.enabled) {
    clauses.push(
      `Animaux acceptés sous réserve de respecter les lieux. Supplément chiens: ${formatEuro(
        toNumber(gite.options_chiens_forfait)
      )} / nuit.`
    );
  }

  if (!options.menage?.enabled) {
    clauses.push(
      "Le gîte doit être rendu propre; le chèque ménage pourra être encaissé si le nettoyage n'est pas effectué."
    );
  }

  if (options.depart_tardif?.enabled) {
    clauses.push("Départ tardif accordé selon l'horaire convenu avec le propriétaire.");
  }

  if (params.clauses && typeof params.clauses["texte_additionnel"] === "string") {
    clauses.push(String(params.clauses["texte_additionnel"]));
  }

  if (!clauses.length) {
    return "<p class=\"small muted\">Aucune clause particulière.</p>";
  }

  return `<ul>${clauses.map((c) => `<li>${escapeHtml(c)}</li>`).join("")}</ul>`;
};

const readTemplateFile = async (name: string) => {
  const paths = [
    path.join(process.cwd(), "templates", name),
    path.join(process.cwd(), "server", "templates", name),
  ];
  for (const candidate of paths) {
    try {
      return await fs.readFile(candidate, "utf-8");
    } catch {
      // try next candidate
    }
  }
  throw new Error(`Template introuvable: ${name}`);
};

const loadTemplates = async () => {
  if (templateCache) return templateCache;
  const [contractHtml, conditionsHtml] = await Promise.all([
    readTemplateFile("contract.html"),
    readTemplateFile("conditions.html"),
  ]);
  templateCache = { contractHtml, conditionsHtml };
  return templateCache;
};

const loadInvoiceTemplate = async () => {
  if (invoiceTemplateCache) return invoiceTemplateCache;
  invoiceTemplateCache = await readTemplateFile("invoice.html");
  return invoiceTemplateCache;
};

const pdfBaseOptions = {
  format: "A4" as const,
  printBackground: true,
  margin: {
    top: "0mm",
    right: "0mm",
    bottom: "0mm",
    left: "0mm",
  },
};

const A4_WIDTH_MM = 210;
const A4_HEIGHT_MM = 297;
const MM_TO_PX = 96 / 25.4;
const OVERFLOW_SAFETY_PX = 2;

const parseMm = (value: string | number | undefined) => {
  if (typeof value === "number") return value;
  if (!value) return 0;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const getPrintableHeightPx = () => {
  const marginTopMm = parseMm(pdfBaseOptions.margin.top);
  const marginBottomMm = parseMm(pdfBaseOptions.margin.bottom);
  const usableMm = A4_HEIGHT_MM - marginTopMm - marginBottomMm;
  return usableMm * MM_TO_PX;
};

const getPrintableWidthPx = () => {
  const marginLeftMm = parseMm(pdfBaseOptions.margin.left);
  const marginRightMm = parseMm(pdfBaseOptions.margin.right);
  const usableMm = A4_WIDTH_MM - marginLeftMm - marginRightMm;
  return usableMm * MM_TO_PX;
};

const getPrintableViewportPx = () => {
  const width = Math.max(1, Math.ceil(getPrintableWidthPx()));
  const height = Math.max(1, Math.ceil(getPrintableHeightPx()));
  return { width, height };
};

const measureOverflow = async (page: Page) => {
  const printableHeightPx = getPrintableHeightPx();
  return page.evaluate(({ heightPx, safetyPx }) => {
    const firstPage = document.querySelector(".page");
    if (!firstPage) return false;
    const renderedHeight = firstPage.getBoundingClientRect().height;
    return renderedHeight > heightPx + safetyPx;
  }, { heightPx: printableHeightPx, safetyPx: OVERFLOW_SAFETY_PX });
};

const compactClassSteps = [
  "compact-sections",
  "compact-density",
  "compact-text",
  "compact-final",
  "compact-spacing",
  "compact-margins",
] as const;

const applyCompactionIfOverflow = async (page: Page) => {
  const overflowBefore = await measureOverflow(page);
  if (!overflowBefore) {
    return { overflowBefore, overflowAfter: false, compactApplied: false };
  }

  let overflowAfter: boolean = overflowBefore;
  for (const className of compactClassSteps) {
    await page.evaluate((compactClass) => {
      document.body?.classList.add(compactClass);
    }, className);
    await page.waitForTimeout(0);
    overflowAfter = await measureOverflow(page);
    if (!overflowAfter) {
      return { overflowBefore, overflowAfter, compactApplied: true };
    }
  }

  return { overflowBefore, overflowAfter, compactApplied: true };
};

const prepareContractPage = async (page: Page, html: string) => {
  const viewport = getPrintableViewportPx();
  await page.setViewportSize(viewport);
  await page.setContent(html, { waitUntil: "load" });
  await page.emulateMedia({ media: "print" });
  return applyCompactionIfOverflow(page);
};

const buildContractHtml = async (params: {
  contract: ContractRenderInput;
  gite: GiteLike;
  totals: ContractTotals;
  bodyAttrs?: string;
}) => {
  const { contractHtml, conditionsHtml } = await loadTemplates();
  const options = parseJsonField<OptionsInput>(params.contract.options, {});
  const clauses = parseJsonField<Record<string, unknown>>(params.contract.clauses ?? {}, {});
  const remiseMontantValue = toNumber(params.contract.remise_montant);
  const remiseRowHtml =
    remiseMontantValue > 0
      ? `<tr><td>Remise exceptionnelle</td><td>${escapeHtml(formatEuro(remiseMontantValue))}</td></tr>`
      : "";

  return renderTemplate(contractHtml, {
    bodyAttrs: params.bodyAttrs ?? "",
    contractNumber: params.contract.numero_contrat,
    giteName: params.gite.nom.toUpperCase(),
    giteAdresse: [params.gite.adresse_ligne1, params.gite.adresse_ligne2]
      .filter(Boolean)
      .join(" - "),
    proprietairesNoms: params.gite.proprietaires_noms,
    proprietairesAdresse: params.gite.proprietaires_adresse,
    proprietairesContactHtml: buildProprietairesContactHtml(params.gite),
    locataireNom: params.contract.locataire_nom,
    locataireAdresseHtml: buildLocataireAdresseHtml(params.contract.locataire_adresse),
    locataireTel: params.contract.locataire_tel,
    nbAdultes: String(params.contract.nb_adultes),
    nbEnfants: String(params.contract.nb_enfants_2_17),
    capaciteMax: String(params.gite.capacite_max),
    dateDebut: formatOptionalDate(params.contract.date_debut),
    heureArrivee: params.contract.heure_arrivee,
    dateFin: formatOptionalDate(params.contract.date_fin),
    heureDepart: params.contract.heure_depart,
    nbNuits: String(params.totals.nbNuits),
    prixParNuit: formatEuro(toNumber(params.contract.prix_par_nuit)),
    montantBase: formatEuro(params.totals.montantBase),
    remiseMontant: formatEuro(toNumber(params.contract.remise_montant)),
    remiseRowHtml,
    totalGlobal: formatEuro(params.totals.totalGlobal),
    optionsBandRowsHtml: buildOptionsBandRowsHtml({
      options,
      totals: params.totals,
      gite: params.gite,
    }),
    clientOptionsFormHtml: buildClientOptionsFormHtml({
      options,
      totals: params.totals,
      gite: params.gite,
    }),
    taxeSejourInfo: `${formatEuro(params.totals.taxeSejourCalculee)} (soit ${formatEuro(
      toNumber(params.gite.taxe_sejour_par_personne_par_nuit)
    )} / personne / nuit)`,
    arrhesMontant: formatEuro(toNumber(params.contract.arrhes_montant)),
    arrhesDateLimite: formatDate(params.contract.arrhes_date_limite),
    paiementSurPlaceHtml: buildPaiementSurPlaceHtml({
      soldeMontant: formatEuro(toNumber(params.contract.solde_montant)),
      chequeMenageMontant: formatEuro(toNumber(params.contract.cheque_menage_montant)),
      cautionMontant: formatEuro(toNumber(params.contract.caution_montant)),
      afficherChequeMenagePhrase: params.contract.afficher_cheque_menage_phrase ?? true,
      afficherCautionPhrase: params.contract.afficher_caution_phrase ?? true,
    }),
    iban: params.gite.iban,
    bic: params.gite.bic ?? "",
    titulaire: params.gite.titulaire,
    notesHtml: buildNotesHtml({ gite: params.gite, options }),
    giteCaracteristiquesHtml: buildGiteCaracteristiquesHtml(params.gite.caracteristiques),
    clausesHtml: buildClausesHtml({ gite: params.gite, options, clauses }),
    lieuSignature: params.gite.adresse_ligne2 ?? params.gite.adresse_ligne1,
    dateSignature: formatDate(new Date()),
    emailContact: params.gite.email ?? "contact@gites-broceliande.com",
    conditionsHtml,
  });
};

export const generateContractPdf = async (params: {
  contract: ContractRenderInput;
  gite: GiteLike;
  totals: ContractTotals;
  outputPath: string;
}) => {
  if (isPdfGenerationDisabled()) {
    await writePlaceholderPdf(params.outputPath);
    return;
  }

  const html = await buildContractHtml(params);

  await fs.mkdir(path.dirname(params.outputPath), { recursive: true });
  await withPageRetry(async (page) => {
    await prepareContractPage(page, html);
    await page.pdf({
      path: params.outputPath,
      ...pdfBaseOptions,
    });
  });
};

export const generateContractPreviewPdf = async (params: {
  contract: ContractRenderInput;
  gite: GiteLike;
  totals: ContractTotals;
}) => {
  const html = await buildContractHtml(params);
  return withPageRetry(async (page) => {
    const compactInfo = await prepareContractPage(page, html);
    const buffer = await page.pdf({
      ...pdfBaseOptions,
      pageRanges: "1",
    });
    return { buffer, ...compactInfo };
  });
};

export const generateContractPreviewHtml = async (params: {
  contract: ContractRenderInput;
  gite: GiteLike;
  totals: ContractTotals;
}) => {
  const html = await buildContractHtml({ ...params, bodyAttrs: 'class="preview"' });
  return withPageRetry(async (page) => {
    const compactInfo = await prepareContractPage(page, html);
    const renderedHtml = await page.content();
    return { html: renderedHtml, ...compactInfo };
  });
};

const buildInvoiceOptionsRowsHtml = (params: {
  totals: ContractTotals;
  options: OptionsInput;
  gite: GiteLike;
}) => {
  const rows: string[] = [];
  const { totals, options, gite } = params;

  const addOptionRows = (params: {
    label: string;
    baseAmount: number;
    billedAmount: number;
  }) => {
    rows.push(`<tr><td>${escapeHtml(params.label)}</td><td>${formatEuro(params.baseAmount)}</td></tr>`);
    const offeredAmount = round2(params.baseAmount - params.billedAmount);
    if (offeredAmount <= 0) return;

    rows.push(
      `<tr class="invoice-row-offered"><td><span class="invoice-muted">Option offerte - ${escapeHtml(
        params.label
      )}</span></td><td>- ${formatEuro(offeredAmount)}</td></tr>`
    );
  };

  if (options.draps?.enabled) {
    const nbLits = options.draps.nb_lits ?? 0;
    const tarif = toNumber(gite.options_draps_par_lit);
    const baseAmount = round2(tarif * nbLits);
    addOptionRows({
      label: `Draps (${nbLits} lit(s) x ${formatEuro(tarif)} / séjour)`,
      baseAmount,
      billedAmount: totals.optionsDetail.draps,
    });
  }
  if (options.linge_toilette?.enabled) {
    const nbPersonnes = options.linge_toilette.nb_personnes ?? 0;
    const tarif = toNumber(gite.options_linge_toilette_par_personne);
    const baseAmount = round2(tarif * nbPersonnes);
    addOptionRows({
      label: `Linge de toilette (${nbPersonnes} pers. x ${formatEuro(tarif)} / séjour)`,
      baseAmount,
      billedAmount: totals.optionsDetail.linge,
    });
  }
  if (options.menage?.enabled) {
    const baseAmount = round2(toNumber(gite.options_menage_forfait));
    addOptionRows({
      label: "Ménage fin de séjour",
      baseAmount,
      billedAmount: totals.optionsDetail.menage,
    });
  }
  if (options.depart_tardif?.enabled) {
    const baseAmount = round2(toNumber(gite.options_depart_tardif_forfait));
    addOptionRows({
      label: "Départ tardif",
      baseAmount,
      billedAmount: totals.optionsDetail.departTardif,
    });
  }
  if (options.chiens?.enabled) {
    const nbChiens = options.chiens.nb ?? 1;
    const tarif = toNumber(gite.options_chiens_forfait);
    const baseAmount = round2(tarif * nbChiens * totals.nbNuits);
    addOptionRows({
      label: `Chiens (${nbChiens} x ${totals.nbNuits} nuit(s) x ${formatEuro(tarif)})`,
      baseAmount,
      billedAmount: totals.optionsDetail.chiens,
    });
  }

  return rows.join("");
};

const buildInvoiceNotesHtml = (params: {
  notes: string | null | undefined;
  clauses: Record<string, unknown>;
}) => {
  const parts: string[] = [];
  const note = (params.notes ?? "").trim();
  if (note) parts.push(note);

  const additionalClause = params.clauses["texte_additionnel"];
  if (typeof additionalClause === "string" && additionalClause.trim()) {
    parts.push(additionalClause.trim());
  }

  if (!parts.length) {
    return "";
  }

  return parts.map((part) => `<p>${escapeHtml(part)}</p>`).join("");
};

const buildInvoiceHtml = async (params: {
  invoice: InvoiceRenderInput;
  gite: GiteLike;
  totals: ContractTotals;
  bodyAttrs?: string;
}) => {
  const template = await loadInvoiceTemplate();
  const options = parseJsonField<OptionsInput>(params.invoice.options, {});
  const clauses = parseJsonField<Record<string, unknown>>(params.invoice.clauses ?? {}, {});
  const statutPaiement = params.invoice.statut_paiement ?? "non_reglee";
  const remiseMontantValue = toNumber(params.invoice.remise_montant);
  const remiseReasonRaw = clauses["remise_raison"];
  const remiseReason = typeof remiseReasonRaw === "string" ? remiseReasonRaw.trim() : "";
  const acompteMontantValue = toNumber(params.invoice.arrhes_montant);
  const optionsRowsHtml = buildInvoiceOptionsRowsHtml({ totals: params.totals, options, gite: params.gite });
  const notesHtml = buildInvoiceNotesHtml({ notes: params.invoice.notes, clauses });
  const remiseLabelHtml = remiseReason
    ? `Remise<div class="invoice-remise-reason">${escapeHtml(remiseReason)}</div>`
    : "Remise";
  const remiseRowHtml =
    remiseMontantValue > 0 ? `<tr><td>${remiseLabelHtml}</td><td>- ${formatEuro(remiseMontantValue)}</td></tr>` : "";
  const acompteRowHtml =
    acompteMontantValue > 0 ? `<tr><td>Acompte reçu</td><td>- ${formatEuro(acompteMontantValue)}</td></tr>` : "";
  const notesBlockHtml = notesHtml ? `<div class="box"><div class="section-title">Notes</div>${notesHtml}</div>` : "";
  const soldeLabel = statutPaiement === "reglee" ? "Montant déjà payé" : "Reste à régler";
  const nbNuits = params.totals.nbNuits;
  const nightsLabel = formatCountLabel(nbNuits, "nuit");
  const occupancyLabel = `${formatCountLabel(params.invoice.nb_adultes, "adulte")}, ${formatCountLabel(
    params.invoice.nb_enfants_2_17,
    "enfant"
  )}`;
  const locationLineLabel = `Location ${nightsLabel} x ${formatEuro(toNumber(params.invoice.prix_par_nuit))}`;
  const metaGridClass = statutPaiement === "reglee" ? "meta-grid--single" : "";
  const echeanceMetaHtml =
    statutPaiement === "reglee"
      ? ""
      : `<div><span class="meta-label">Échéance</span><span class="meta-value">${formatDate(
          params.invoice.arrhes_date_limite
        )}</span></div>`;

  return renderTemplate(template, {
    bodyAttrs: params.bodyAttrs ?? "",
    invoiceNumber: params.invoice.numero_facture,
    emissionDate: formatDate(new Date()),
    metaGridClass,
    echeanceMetaHtml,
    giteName: params.gite.nom,
    giteAdresse: [params.gite.adresse_ligne1, params.gite.adresse_ligne2].filter(Boolean).join(" - "),
    proprietairesNoms: params.gite.proprietaires_noms,
    proprietairesAdresse: params.gite.proprietaires_adresse,
    proprietairesContactHtml: buildProprietairesContactHtml(params.gite),
    clientNom: params.invoice.locataire_nom,
    clientAdresseHtml: buildLocataireAdresseHtml(params.invoice.locataire_adresse),
    clientTel: params.invoice.locataire_tel,
    periodStart: formatOptionalDate(params.invoice.date_debut),
    periodEnd: formatOptionalDate(params.invoice.date_fin),
    nightsLabel,
    occupancyLabel,
    locationLineLabel,
    montantBase: formatEuro(params.totals.montantBase),
    remiseRowHtml,
    optionsRowsHtml,
    taxeSejour: formatEuro(params.totals.taxeSejourCalculee),
    totalGlobal: formatEuro(params.totals.totalGlobal),
    acompteRowHtml,
    soldeLabel,
    soldeMontant: formatEuro(toNumber(params.invoice.solde_montant)),
    iban: params.gite.iban,
    bic: params.gite.bic ?? "—",
    titulaire: params.gite.titulaire,
    notesBlockHtml,
  });
};

export const generateInvoicePdf = async (params: {
  invoice: InvoiceRenderInput;
  gite: GiteLike;
  totals: ContractTotals;
  outputPath: string;
}) => {
  if (isPdfGenerationDisabled()) {
    await writePlaceholderPdf(params.outputPath);
    return;
  }

  const html = await buildInvoiceHtml(params);

  await fs.mkdir(path.dirname(params.outputPath), { recursive: true });
  await withPageRetry(async (page) => {
    await prepareContractPage(page, html);
    await page.pdf({
      path: params.outputPath,
      ...pdfBaseOptions,
    });
  });
};

export const generateInvoicePreviewHtml = async (params: {
  invoice: InvoiceRenderInput;
  gite: GiteLike;
  totals: ContractTotals;
}) => {
  const html = await buildInvoiceHtml({ ...params, bodyAttrs: 'class="preview"' });
  return withPageRetry(async (page) => {
    const compactInfo = await prepareContractPage(page, html);
    const renderedHtml = await page.content();
    return { html: renderedHtml, ...compactInfo };
  });
};
