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
const MAX_BROWSER_ATTEMPTS = 3;

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

  return `<p>Le montant restant de la location, soit ${params.soldeMontant} (sans les services annexes) sera payé le jour de la remise des clés${tail}</p>`;
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

const loadTemplates = async () => {
  if (templateCache) return templateCache;
  const templatePath = path.join(process.cwd(), "templates", "contract.html");
  const conditionsPath = path.join(process.cwd(), "templates", "conditions.html");
  const [contractHtml, conditionsHtml] = await Promise.all([
    fs.readFile(templatePath, "utf-8"),
    fs.readFile(conditionsPath, "utf-8"),
  ]);
  templateCache = { contractHtml, conditionsHtml };
  return templateCache;
};

const pdfBaseOptions = {
  format: "A4" as const,
  printBackground: true,
  margin: {
    top: "12mm",
    right: "12mm",
    bottom: "12mm",
    left: "12mm",
  },
};

const A4_HEIGHT_MM = 297;
const MM_TO_PX = 96 / 25.4;

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

const measureOverflow = async (page: Page) => {
  const printableHeightPx = getPrintableHeightPx();
  return page.evaluate((heightPx) => {
    const firstPage = document.querySelector(".page");
    if (!firstPage) return false;
    const renderedHeight = firstPage.getBoundingClientRect().height;
    return renderedHeight > heightPx + 1;
  }, printableHeightPx);
};

const compactClassSteps = [
  "compact-sections",
  "compact-density",
  "compact-text",
  "compact-final",
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
    locataireAdresse: params.contract.locataire_adresse,
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
