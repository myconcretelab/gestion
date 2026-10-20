import { assertTouristTaxReady } from "./contractCalculator.js";
import fs from "fs/promises";
import { computeInvoiceFiscal, invoicePaymentNotes, invoiceThemes, resolveInvoiceTheme, type InvoiceFiscalInput, type InvoiceThemeId, type TouristTaxResult } from "@contrats/shared";
import path from "path";
import { chromium, Browser, Page } from "playwright";
import { env } from "../config/env.js";
import { renderTemplate } from "./template.js";
import { getInstallationConfig } from "./installationConfig.js";
import { formatDate } from "../utils/dates.js";
import { formatEuro, round2, toNumber, type NumericLike } from "../utils/money.js";
import type { ContractTotals, OptionsInput } from "./contractCalculator.js";
import {
  normalizeBookedGiteContentSections,
  type BookedGiteContentGroup,
  type BookedGiteContentItem,
} from "./bookedGiteContent.js";

let browser: Browser | null = null;
let browserLaunchPromise: Promise<Browser> | null = null;
let browserIdleCloseTimer: NodeJS.Timeout | null = null;
let pageQueue: Promise<void> = Promise.resolve();
let templateCache: { contractHtml: string; conditionsHtml: string } | null = null;
let invoiceTemplateCache: string | null = null;
const MAX_BROWSER_ATTEMPTS = 3;
const MINIMAL_PDF_BUFFER = Buffer.from("%PDF-1.1\n%%EOF\n", "utf-8");

const isPdfGenerationDisabled = () => process.env.SKIP_PDF_GENERATION === "1";

const resolveDrapsTarif = (options: OptionsInput, gite: GiteLike) =>
  options.draps?.prix_unitaire !== undefined
    ? toNumber(options.draps.prix_unitaire)
    : toNumber(gite.options_draps_par_lit);

const resolveDepartTardifTarif = (options: OptionsInput, gite: GiteLike) =>
  options.depart_tardif?.prix_forfait !== undefined
    ? toNumber(options.depart_tardif.prix_forfait)
    : toNumber(gite.options_depart_tardif_forfait);

const resolveChiensTarif = (options: OptionsInput, gite: GiteLike) =>
  options.chiens?.prix_unitaire !== undefined
    ? toNumber(options.chiens.prix_unitaire)
    : toNumber(gite.options_chiens_forfait);

const writePlaceholderPdf = async (outputPath: string) => {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, MINIMAL_PDF_BUFFER);
};

export type GiteLike = {
  nom: string;
  adresse_ligne1: string;
  adresse_ligne2?: string | null;
  proprietaires_noms: string;
  proprietaires_adresse: string;
  capacite_max: number;
  site_web?: string | null;
  email?: string | null;
  telephones: unknown;
  public_structured_content?: unknown;
  public_equipment?: unknown;
  public_rooms?: unknown;
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
  statut_paiement_arrhes?: "non_recu" | "recu";
  date_paiement_arrhes?: Date | string | null;
  mode_paiement_arrhes?: string | null;
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
  /** Operator-only recipe. Never populated from ordinary invoice input. */
  test_environment?: "superpdp-sandbox";
  fiscal?: InvoiceFiscalInput | null;
  numero_facture: string;
  lifecycle_status?: string;
  document_kind?: string;
  issued_at?: Date | string | null;
  source_invoice_number?: string;
  seller?: { legal_name: string; siren: string | null; siret: string | null; vat_number: string | null; address: string; email: string | null };
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
  frais_supplementaires?: InvoiceExtraFeeInput[] | string | null;
  reservation_items?: InvoiceReservationItemInput[] | string | null;
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

type InvoiceReservationItemInput = {
  reservation_id: string;
  gite_id: string;
  gite_nom: string;
  hote_nom: string;
  date_debut: string;
  date_fin: string;
  nb_nuits: number;
  nb_adultes: number;
  nb_enfants_2_17: number;
  montant: NumericLike;
};

type InvoiceExtraFeeInput = {
  libelle?: string | null;
  montant?: NumericLike | null;
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

const cancelBrowserIdleClose = () => {
  if (!browserIdleCloseTimer) return;
  clearTimeout(browserIdleCloseTimer);
  browserIdleCloseTimer = null;
};

const resetBrowserState = async () => {
  cancelBrowserIdleClose();
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

const scheduleBrowserIdleClose = () => {
  cancelBrowserIdleClose();
  browserIdleCloseTimer = setTimeout(() => {
    browserIdleCloseTimer = null;
    void resetBrowserState();
  }, env.PDF_BROWSER_IDLE_MS);
  browserIdleCloseTimer.unref();
};

const withExclusivePage = async <T>(operation: () => Promise<T>) => {
  let releaseQueue!: () => void;
  const previous = pageQueue;
  pageQueue = new Promise<void>((resolve) => {
    releaseQueue = resolve;
  });

  await previous.catch(() => undefined);
  cancelBrowserIdleClose();
  try {
    return await operation();
  } finally {
    scheduleBrowserIdleClose();
    releaseQueue();
  }
};

const isClosedBrowserError = (error: unknown) => {
  if (!(error instanceof Error)) return false;
  return /Target page, context or browser has been closed|Browser has been closed|has been closed/i.test(
    error.message
  );
};

const withPageRetry = async <T>(operation: (page: Page) => Promise<T>): Promise<T> =>
  withExclusivePage(async () => {
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
  });

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

const CONTENT_PRESENTATION_SECTION_IDS = new Set(["equipements", "pieces-couchages"]);
const BED_LABELS: Record<string, { label: string; detail: string }> = {
  single: { label: "Lit 90", detail: "90 x 190" },
  double: { label: "Lit 140", detail: "140 x 190" },
  queen: { label: "Lit 160", detail: "160 x 200" },
  king: { label: "Lit 180", detail: "180 x 200" },
  bunk: { label: "Lits superposés", detail: "2 couchages" },
  sofa_bed: { label: "Canapé-lit", detail: "Convertible" },
  baby: { label: "Lit bébé", detail: "Bébé" },
};

const isContentPresentationSection = (sectionId: string) =>
  CONTENT_PRESENTATION_SECTION_IDS.has(sectionId) ||
  Array.from(CONTENT_PRESENTATION_SECTION_IDS).some((familyId) => sectionId.startsWith(`${familyId}-`));

const hasPresentationGroupContent = (group: BookedGiteContentGroup) =>
  group.items.length > 0 || Boolean(group.note?.trim());

const isBedContentItem = (item: BookedGiteContentItem): item is Extract<BookedGiteContentItem, { kind: "bed" }> =>
  Boolean(item && typeof item === "object" && !Array.isArray(item) && item.kind === "bed");

const getBedLabel = (item: Extract<BookedGiteContentItem, { kind: "bed" }>) => BED_LABELS[item.type] ?? BED_LABELS.queen;

const countBedsInGroup = (group: BookedGiteContentGroup) =>
  group.items.reduce((total, item) => (isBedContentItem(item) ? total + item.count : total), 0);

const countSleepingPlacesInGroup = (group: BookedGiteContentGroup) =>
  group.items.reduce((total, item) => {
    if (!isBedContentItem(item)) return total;
    return total + item.count * (item.type === "bunk" ? 2 : 1);
  }, 0);

const iconSvg = (name: "home" | "bed" | "check" | "info") => {
  const paths = {
    home: '<path d="M4 10.5 12 4l8 6.5V20h-5v-6H9v6H4z"></path>',
    bed: '<path d="M5 7v6h14V9.5A2.5 2.5 0 0 0 16.5 7H12v6"></path><path d="M5 5v15"></path><path d="M19 13v7"></path><path d="M5 17h14"></path>',
    check: '<path d="m5 12 4 4 10-10"></path>',
    info: '<path d="M12 8h.01"></path><path d="M11 12h1v5h1"></path><path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z"></path>',
  };
  return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${paths[name]}</svg>`;
};

const buildBedItemsHtml = (items: BookedGiteContentItem[]) =>
  items
    .map((item) => {
      if (isBedContentItem(item)) {
        const bed = getBedLabel(item);
        return `
          <div class="composition-bed">
            <span class="composition-bed__icon">${iconSvg("bed")}</span>
            <span class="composition-bed__text">
              <span class="composition-bed__label">${escapeHtml(
                item.count > 1 ? `${item.count} x ${bed.label}` : bed.label
              )}</span>
              <span class="composition-bed__detail">${escapeHtml(bed.detail)}</span>
            </span>
          </div>
        `;
      }

      const text = String(item).trim();
      if (!text) return "";
      return `
        <div class="composition-bed">
          <span class="composition-bed__icon">${iconSvg("check")}</span>
          <span class="composition-bed__text">
            <span class="composition-bed__label">${escapeHtml(text)}</span>
          </span>
        </div>
      `;
    })
    .filter(Boolean)
    .join("");

const buildEquipmentItemsHtml = (items: BookedGiteContentItem[]) => {
  const rows = items
    .map((item) => (typeof item === "string" ? item.trim() : getBedLabel(item).label))
    .filter(Boolean)
    .map(
      (item) => `
        <li>
          <span class="composition-list__icon">${iconSvg("check")}</span>
          <span>${escapeHtml(item)}</span>
        </li>
      `
    )
    .join("");

  return rows ? `<ul class="composition-list">${rows}</ul>` : "";
};

const buildRoomCardHtml = (group: BookedGiteContentGroup) => {
  const bedCount = countBedsInGroup(group);
  const sleepingPlaces = countSleepingPlacesInGroup(group);
  const stats = [
    bedCount > 0 ? formatCountLabel(bedCount, "lit") : "",
    sleepingPlaces > 0 ? formatCountLabel(sleepingPlaces, "couchage") : "",
  ].filter(Boolean);

  return `
    <article class="composition-card composition-card--room">
      <div class="composition-card__head">
        <span class="composition-card__icon">${iconSvg("bed")}</span>
        <div>
          <h3>${escapeHtml(group.titre)}</h3>
          ${stats.length ? `<div class="composition-card__meta">${escapeHtml(stats.join(" · "))}</div>` : ""}
        </div>
      </div>
      <div class="composition-bed-grid">${buildBedItemsHtml(group.items)}</div>
      ${group.note ? `<p class="composition-note">${escapeHtml(group.note)}</p>` : ""}
    </article>
  `;
};

const buildEquipmentCardHtml = (group: BookedGiteContentGroup) => `
  <article class="composition-card">
    <div class="composition-card__head">
      <span class="composition-card__icon">${iconSvg("home")}</span>
      <div>
        <h3>${escapeHtml(group.titre)}</h3>
        <div class="composition-card__meta">Équipements et aménagements</div>
      </div>
    </div>
    ${buildEquipmentItemsHtml(group.items)}
    ${group.note ? `<p class="composition-note">${escapeHtml(group.note)}</p>` : ""}
  </article>
`;

const buildGiteCompositionPageHtml = (gite: GiteLike) => {
  const sections = normalizeBookedGiteContentSections({
    public_structured_content: gite.public_structured_content,
    public_equipment: gite.public_equipment,
    public_rooms: gite.public_rooms,
  })
    .map((section) => ({
      ...section,
      groupes: section.groupes.filter(hasPresentationGroupContent),
    }))
    .filter(
      (section) =>
        section.groupes.length > 0 &&
        (isContentPresentationSection(section.id) || section.groupes.some((group) => group.type === "chambre"))
    );

  if (!sections.length) return "";

  const roomGroups = sections.flatMap((section) => section.groupes.filter((group) => group.type === "chambre"));
  const equipmentGroups = sections.flatMap((section) => section.groupes.filter((group) => group.type !== "chambre"));
  const bedCount = roomGroups.reduce((total, group) => total + countBedsInGroup(group), 0);
  const sleepingPlaces = roomGroups.reduce((total, group) => total + countSleepingPlacesInGroup(group), 0);

  return `
    <div class="page page--composition">
      <div class="composition-header">
        <div>
          <div class="composition-kicker">Présentation du gîte</div>
          <h2>Composition et couchages</h2>
          <p>${escapeHtml(gite.nom)}${gite.capacite_max ? ` · jusqu'à ${escapeHtml(formatCountLabel(gite.capacite_max, "personne"))}` : ""}</p>
        </div>
        <div class="composition-summary">
          ${
            roomGroups.length > 0
              ? `<div><strong>${escapeHtml(String(roomGroups.length))}</strong><span>${escapeHtml(
                  formatCountLabel(roomGroups.length, "chambre")
                )}</span></div>`
              : ""
          }
          ${
            sleepingPlaces > 0
              ? `<div><strong>${escapeHtml(String(sleepingPlaces))}</strong><span>${escapeHtml(
                  formatCountLabel(sleepingPlaces, "couchage")
                )}</span></div>`
              : ""
          }
          ${bedCount > 0 ? `<div><strong>${escapeHtml(String(bedCount))}</strong><span>${escapeHtml(formatCountLabel(bedCount, "lit"))}</span></div>` : ""}
        </div>
      </div>

      ${
        roomGroups.length
          ? `<section class="composition-section">
              <div class="composition-section__title">
                <span>${iconSvg("bed")}</span>
                <h3>Chambres</h3>
              </div>
              <div class="composition-grid composition-grid--rooms">
                ${roomGroups.map(buildRoomCardHtml).join("")}
              </div>
            </section>`
          : ""
      }

      ${
        equipmentGroups.length
          ? `<section class="composition-section">
              <div class="composition-section__title">
                <span>${iconSvg("info")}</span>
                <h3>Pièces et équipements</h3>
              </div>
              <div class="composition-grid">
                ${equipmentGroups.map(buildEquipmentCardHtml).join("")}
              </div>
            </section>`
          : ""
      }
    </div>
  `;
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

const buildLocataireOccupantsHtml = (params: { nbAdultes: number; nbEnfants: number }) => {
  const adultCount = params.nbAdultes > 0 ? escapeHtml(String(params.nbAdultes)) : "";
  const childrenCount = params.nbEnfants > 0 ? escapeHtml(String(params.nbEnfants)) : "";
  const lines = [
    `Nombre d'adultes : <span class="write-line write-line--count">${adultCount}</span>`,
    `Nombre d'enfants (3 à 16 ans) : <span class="write-line write-line--count">${childrenCount}</span>`,
  ];
  return `<div class="small" style="margin-top:2mm;">${lines.join("<br />")}</div>`;
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

const buildReservationTermsHtml = (params: {
  emailContact: string;
  arrhesDateLimite: string;
  arrhesMontant: string;
  statutPaiementArrhes?: "non_recu" | "recu";
  datePaiementArrhes?: Date | string | null;
  modePaiementArrhes?: string | null;
}) => {
  if (params.statutPaiementArrhes === "recu") {
    const receiptDetails: string[] = [];
    const paymentDateLabel = formatOptionalDate(params.datePaiementArrhes, "");
    if (paymentDateLabel) {
      receiptDetails.push(`le ${escapeHtml(paymentDateLabel)}`);
    }

    const receiptSentence = `Les arrhes de ${params.arrhesMontant} ont déjà été reçues${
      receiptDetails.length ? ` ${receiptDetails.join(" ")}` : ""
    }.`;
    const paymentModeSentence = params.modePaiementArrhes
      ? ` Mode de paiement enregistré : ${escapeHtml(params.modePaiementArrhes)}.`
      : "";

    return `
      <p>${receiptSentence}${paymentModeSentence}</p>
      <p>
        Merci de me retourner à mon adresse ou par email (${escapeHtml(
          params.emailContact
        )}) avant le ${escapeHtml(params.arrhesDateLimite)} un exemplaire du présent contrat daté et signé avec la mention « lu et approuvé ».
      </p>
      <p>
        Au-delà de cette date et sans nouvelle de votre part cette proposition sera annulée et je disposerai de la location à ma convenance. Le présent contrat est établi en 2 exemplaires.
      </p>
    `;
  }

  return `
    <p>
      Cette location prendra effet si je reçois à mon adresse ou par email (${escapeHtml(
        params.emailContact
      )})
      avant le ${escapeHtml(params.arrhesDateLimite)} :
    </p>
    <ul>
      <li>Un exemplaire du présent contrat daté et signé avec la mention « lu et approuvé ».</li>
      <li>Un règlement d'arrhes de ${params.arrhesMontant}.</li>
    </ul>
    <p>
      Au-delà de cette date et sans nouvelle de votre part cette proposition sera annulée et je disposerai de la location à ma convenance. Le présent contrat est établi en 2 exemplaires.
    </p>
  `;
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
    const tarif = resolveDrapsTarif(options, gite);
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
    const tarif = resolveDepartTardifTarif(options, gite);
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
    const tarif = resolveChiensTarif(options, gite);
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
        resolveChiensTarif(options, gite)
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

const loadInvoiceThemeStyles = async (id: InvoiceThemeId) => {
  const stylesheet = invoiceThemes[id].stylesheet;
  if (!stylesheet) return "";
  // Keep stylesheet edits visible when a draft PDF is regenerated after its
  // template mtime changes. The catalogue is the only source of allowed paths.
  return readTemplateFile(stylesheet);
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
  // Stabilize font metrics before measuring/compacting, not only when Chromium prints.
  await page.evaluate(async () => { await document.fonts.ready; });
  return applyCompactionIfOverflow(page);
};

const buildTouristTaxRows = (taxes: TouristTaxResult[] = [], sign = 1) => taxes.map(tax => {
  const collector = tax.collector === "host" ? (tax.included ? "comprise dans le prix annoncé" : "en supplément")
    : tax.collector === "platform" ? `collectée par ${tax.platform || "la plateforme"}, non due au loueur`
    : tax.collector === "not_applicable" ? `non applicable : ${tax.exemption_reason}` : "collecteur à préciser";
  const detail = `${tax.taxable_adults} personne(s) taxable(s) × ${tax.nights} nuit(s) × ${formatEuro(tax.unit_amount)}${tax.exempt_people ? ` · ${tax.exempt_people} personne(s) exonérée(s)` : ""}${tax.authority ? ` · ${tax.authority}` : ""}`;
  return `<tr class="invoice-tourist-tax"><td>Taxe de séjour${tax.stay_label ? ` · ${escapeHtml(tax.stay_label)}` : ""}<div class="invoice-item-meta">${escapeHtml(detail)} · ${escapeHtml(collector)}${tax.collector === "platform" ? ` · ${formatEuro(tax.amount)}` : ""}</div></td><td>${tax.host_amount ? formatEuro(sign * tax.host_amount) : "—"}</td></tr>`;
}).join("");

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
    locataireOccupantsHtml: buildLocataireOccupantsHtml({
      nbAdultes: params.contract.nb_adultes,
      nbEnfants: params.contract.nb_enfants_2_17,
    }),
    capaciteMax: String(params.gite.capacite_max),
    dateDebut: formatOptionalDate(params.contract.date_debut),
    heureArrivee: params.contract.heure_arrivee,
    dateFin: formatOptionalDate(params.contract.date_fin),
    heureDepart: params.contract.heure_depart,
    nbNuits: String(params.totals.nbNuits),
    prixParNuit: formatEuro(toNumber(params.contract.prix_par_nuit)),
    locationLabel: params.totals.touristTaxes?.length ? `Hébergement · ${params.totals.nbNuits} nuit(s), hors taxe de séjour` : `${params.totals.nbNuits} nuits x ${formatEuro(toNumber(params.contract.prix_par_nuit))}`,
    montantBase: formatEuro(params.totals.touristTaxes?.[0] ? params.totals.touristTaxes[0].accommodation_amount + toNumber(params.contract.remise_montant) : params.totals.montantBase),
    touristTaxRowsHtml: buildTouristTaxRows(params.totals.touristTaxes),
    touristTaxDescription: params.totals.touristTaxes?.length ? "La taxe de séjour est détaillée séparément ci-dessus. Les sommes collectées par une plateforme ne sont pas à régler au loueur." : "Le prix comprend toutes les charges ainsi que la taxe de séjour :",
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
    taxeSejourInfo: params.totals.touristTaxes?.length ? "" : `${formatEuro(params.totals.taxeSejourCalculee)} (soit ${formatEuro(
      toNumber(params.gite.taxe_sejour_par_personne_par_nuit)
    )} / adulte / nuit)`,
    arrhesMontant: formatEuro(toNumber(params.contract.arrhes_montant)),
    arrhesDateLimite: formatDate(params.contract.arrhes_date_limite),
    reservationTermsHtml: buildReservationTermsHtml({
      emailContact: params.gite.email ?? "",
      arrhesDateLimite: formatDate(params.contract.arrhes_date_limite),
      arrhesMontant: formatEuro(toNumber(params.contract.arrhes_montant)),
      statutPaiementArrhes: params.contract.statut_paiement_arrhes,
      datePaiementArrhes: params.contract.date_paiement_arrhes,
      modePaiementArrhes: params.contract.mode_paiement_arrhes,
    }),
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
    giteCompositionPageHtml: buildGiteCompositionPageHtml(params.gite),
    clausesHtml: buildClausesHtml({ gite: params.gite, options, clauses }),
    lieuSignature: params.gite.adresse_ligne2 ?? params.gite.adresse_ligne1,
    dateSignature: formatDate(new Date()),
    conditionsHtml,
  });
};

export const generateContractPdf = async (params: {
  contract: ContractRenderInput;
  gite: GiteLike;
  totals: ContractTotals;
  outputPath: string;
}) => {
  assertTouristTaxReady(params.totals);
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
    const tarif = resolveDrapsTarif(options, gite);
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
    const baseAmount = round2(resolveDepartTardifTarif(options, gite));
    addOptionRows({
      label: "Départ tardif",
      baseAmount,
      billedAmount: totals.optionsDetail.departTardif,
    });
  }
  if (options.chiens?.enabled) {
    const nbChiens = options.chiens.nb ?? 1;
    const tarif = resolveChiensTarif(options, gite);
    const baseAmount = round2(tarif * nbChiens * totals.nbNuits);
    addOptionRows({
      label: `Chiens (${nbChiens} x ${totals.nbNuits} nuit(s) x ${formatEuro(tarif)})`,
      baseAmount,
      billedAmount: totals.optionsDetail.chiens,
    });
  }

  return rows.join("");
};

const buildInvoiceExtraFeesRowsHtml = (fees: InvoiceExtraFeeInput[]) =>
  fees
    .map((fee) => ({
      libelle: (fee.libelle ?? "").trim() || "Frais complémentaires",
      montant: round2(toNumber(fee.montant ?? 0)),
    }))
    .filter((fee) => fee.montant > 0)
    .map((fee) => `<tr><td>${escapeHtml(fee.libelle)}</td><td>${formatEuro(fee.montant)}</td></tr>`)
    .join("");

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

export const buildInvoicePaymentTermsHtml = (fiscal: InvoiceFiscalInput | null | undefined, credit = false) => {
  if (!fiscal) return "";
  const parts = [
    ...(!credit && fiscal.payment_terms ? [fiscal.payment_terms] : []),
    ...invoicePaymentNotes(fiscal).map(({ note }) => note),
  ];
  return parts.length
    ? `<div class="box"><div class="section-title">Conditions de paiement</div><p>${parts.map((part) => escapeHtml(part)).join("<br>")}</p></div>`
    : "";
};

export const buildInvoiceHtml = async (params: {
  invoice: InvoiceRenderInput;
  gite: GiteLike;
  totals: ContractTotals;
  bodyAttrs?: string;
}) => {
  const organization = params.invoice.seller ? null : (await getInstallationConfig()).organization;
  const template = await loadInvoiceTemplate();
  const options = parseJsonField<OptionsInput>(params.invoice.options, {});
  const clauses = parseJsonField<Record<string, unknown>>(params.invoice.clauses ?? {}, {});
  const invoiceThemeId = resolveInvoiceTheme(clauses);
  const invoiceThemeStyles = await loadInvoiceThemeStyles(invoiceThemeId);
  const fraisSupplementaires = parseJsonField<InvoiceExtraFeeInput[]>(
    params.invoice.frais_supplementaires ?? [],
    []
  );
  const reservationItems = parseJsonField<InvoiceReservationItemInput[]>(
    params.invoice.reservation_items ?? [],
    []
  );
  const isMultiReservation = reservationItems.length >= 2;
  const reservationGiteCount = new Set(reservationItems.map((item) => item.gite_id)).size;
  const statutPaiement = params.invoice.statut_paiement ?? "non_reglee";
  const remiseMontantValue = toNumber(params.invoice.remise_montant);
  const remiseReasonRaw = clauses["remise_raison"];
  const remiseReason = typeof remiseReasonRaw === "string" ? remiseReasonRaw.trim() : "";
  const acompteMontantValue = toNumber(params.invoice.arrhes_montant);
  const optionsRowsHtml = buildInvoiceOptionsRowsHtml({ totals: params.totals, options, gite: params.gite });
  const extraFeesRowsHtml = buildInvoiceExtraFeesRowsHtml(fraisSupplementaires);
  const notesHtml = buildInvoiceNotesHtml({ notes: params.invoice.notes, clauses });
  const remiseLabelHtml = remiseReason
    ? `Remise<div class="invoice-remise-reason">${escapeHtml(remiseReason)}</div>`
    : "Remise";
  const remiseRowHtml =
    remiseMontantValue > 0 ? `<tr><td>${remiseLabelHtml}</td><td>- ${formatEuro(remiseMontantValue)}</td></tr>` : "";
  const acompteRowHtml =
    acompteMontantValue > 0 ? `<tr><td>Acompte reçu</td><td>- ${formatEuro(acompteMontantValue)}</td></tr>` : "";
  const creditReferenceHtml = params.invoice.document_kind === "credit_note" ? `<p>Annulation intégrale de la facture ${escapeHtml(params.invoice.source_invoice_number ?? "")}</p>` : "";
  const notesBlockHtml = notesHtml || creditReferenceHtml ? `<div class="box"><div class="section-title">Notes</div>${notesHtml}${creditReferenceHtml}</div>` : "";
  const soldeLabel = params.invoice.document_kind === "credit_note" ? "Montant de l’avoir" : statutPaiement === "reglee" ? "Montant déjà payé" : "Reste à régler";
  const nbNuits = params.totals.nbNuits;
  const nightsLabel = formatCountLabel(nbNuits, "nuit");
  const clientTel = params.invoice.locataire_tel.trim();
  const clientTelLineHtml = clientTel ? `<div class="line">Téléphone: ${escapeHtml(clientTel)}</div>` : "";
  const occupancyLabel = `${formatCountLabel(params.invoice.nb_adultes, "adulte")}, ${formatCountLabel(
    params.invoice.nb_enfants_2_17,
    "enfant"
  )}`;
  const locationLineLabel = `Location ${nightsLabel} x ${formatEuro(toNumber(params.invoice.prix_par_nuit))}`;
  const reservationRowsHtml = reservationItems
    .map((item) => {
      const occupancy = `${formatCountLabel(item.nb_adultes, "adulte")}, ${formatCountLabel(item.nb_enfants_2_17, "enfant")}`;
      return `<tr><td><strong>${escapeHtml(item.gite_nom)}</strong> · ${escapeHtml(item.hote_nom)}<div class="invoice-item-meta">Du ${escapeHtml(formatDate(new Date(item.date_debut)))} au ${escapeHtml(formatDate(new Date(item.date_fin)))} · ${escapeHtml(formatCountLabel(item.nb_nuits, "nuit"))} · ${escapeHtml(occupancy)}</div></td><td>${formatEuro(toNumber(item.montant))}</td></tr>`;
    })
    .join("");
  const invoiceRowsHtml = params.invoice.document_kind === "credit_note"
    ? `<tr><td>Annulation intégrale de la facture ${escapeHtml(params.invoice.source_invoice_number ?? "")}</td><td>${formatEuro(params.totals.totalGlobal)}</td></tr>`
    : isMultiReservation
    ? reservationRowsHtml
    : params.totals.touristTaxes?.length
    ? `<tr><td>Hébergement · ${escapeHtml(nightsLabel)} (hors taxe de séjour)</td><td>${formatEuro(params.totals.touristTaxes[0].accommodation_amount + remiseMontantValue)}</td></tr>${remiseRowHtml}${optionsRowsHtml}${buildTouristTaxRows(params.totals.touristTaxes)}`
    : `<tr><td>${escapeHtml(locationLineLabel)}</td><td>${formatEuro(params.totals.montantBase)}</td></tr><tr class="invoice-row-taxe-sejour"><td>Dont taxe de séjour</td><td>${formatEuro(params.totals.taxeSejourCalculee)}</td></tr>${remiseRowHtml}${optionsRowsHtml}`;
  const metaGridClass = statutPaiement === "reglee" || params.invoice.document_kind === "credit_note" ? "meta-grid--single" : "";
  const echeanceMetaHtml =
    statutPaiement === "reglee" || params.invoice.document_kind === "credit_note"
      ? ""
      : `<div><span class="meta-label">Échéance</span><span class="meta-value">${formatDate(
          params.invoice.arrhes_date_limite
        )}</span></div>`;

  const fiscal = params.invoice.fiscal;
  const sign = params.invoice.document_kind === "credit_note" ? -1 : 1;
  const fiscalTotals = fiscal ? computeInvoiceFiscal(fiscal) : null;
  const fiscalMoney = (cents: number) => formatEuro(cents === 0 ? 0 : sign * cents / 100);
  const fiscalUnitLabels = { C62: "unité(s)", DAY: "jour(s)", E48: "prestation(s)" };
  const fiscalRowGroups: Array<{ stayId?: string; rows: string[] }> = [];
  fiscalTotals?.lines.forEach((line, index) => {
    const source = line.source;
    const heading = source && source.stay_id !== fiscalTotals.lines[index - 1]?.source?.stay_id
      ? `<tr class="invoice-stay-heading"><td colspan="2"><strong>${escapeHtml(source.stay_label)}</strong><div class="invoice-item-meta">Du ${escapeHtml(formatDate(new Date(source.date_debut)))} au ${escapeHtml(formatDate(new Date(source.date_fin)))}${source.discount > 0 ? ` · Tarif initial ${formatEuro(source.original_nightly_price)} / nuit · remise de ${formatEuro(source.discount)} déjà déduite` : ""}</div></td></tr>` : "";
    const unit = line.unit === "DAY" && /^Location(?: ·|$)/.test(line.label) ? (line.quantity > 1 ? "nuitées" : "nuitée") : fiscalUnitLabels[line.unit];
    const row = `${heading}<tr><td>${escapeHtml(line.label)}<div class="invoice-item-meta">${escapeHtml(String(line.quantity))} ${escapeHtml(unit)} × ${fiscalMoney(Math.round(line.unit_price_ttc * 100))} TTC · HT ${fiscalMoney(line.net_cents)} · ${line.vat_category === "unknown" ? "TVA à préciser" : line.vat_category === "S" ? `TVA ${escapeHtml(String(line.vat_rate))} %` : escapeHtml(line.vat_category)}${line.exemption_reason ? ` · ${escapeHtml(line.exemption_reason)}` : ""}</div></td><td>${fiscalMoney(line.gross_cents)}</td></tr>`;
    const previous = fiscalRowGroups.at(-1);
    if (previous && previous.stayId === source?.stay_id) previous.rows.push(row);
    else fiscalRowGroups.push({ stayId: source?.stay_id, rows: [row] });
  });
  // Fiscal lines already contain the discounted price. Explain the reduction
  // without adding a second negative accounting line (or changing VAT totals).
  const fiscalDiscountHtml = fiscalTotals && !isMultiReservation && remiseMontantValue > 0
    ? `<tbody><tr class="invoice-discount-detail"><td colspan="2"><strong>Remise de ${formatEuro(remiseMontantValue)} TTC${sign < 0 ? " sur la facture d’origine" : ""}</strong>${remiseReason ? `<div class="invoice-remise-reason">${escapeHtml(remiseReason)}</div>` : ""}<div class="invoice-item-meta">Location avant remise : ${formatEuro(params.totals.montantBase)} − remise : ${formatEuro(remiseMontantValue)} = ${formatEuro(params.totals.totalSansOptions)} TTC. Remise déjà déduite des nuitées ci-dessous.</div></td></tr></tbody>`
    : "";
  const fiscalRows = fiscalTotals ? fiscalDiscountHtml + fiscalRowGroups.map((group) => `<tbody${group.stayId ? ' class="invoice-stay-group"' : ""}>${group.rows.join("")}</tbody>`).join("") : undefined;
  const fiscalSummary = fiscalTotals ? `<tr><td>Total HT</td><td>${fiscalMoney(fiscalTotals.net_cents)}</td></tr>${fiscalTotals.breakdown.map((group) => `<tr><td>TVA ${escapeHtml(group.category === "unknown" ? "à préciser" : group.category)}${group.category === "S" ? ` · ${escapeHtml(String(group.rate))} %` : ""}${group.reason ? `<div class="invoice-item-meta">${escapeHtml(group.reason)}</div>` : ""}</td><td>${fiscalMoney(group.vat_cents)}</td></tr>`).join("")}${fiscalTotals.rounding_cents ? `<tr><td>Arrondi TTC</td><td>${fiscalMoney(fiscalTotals.rounding_cents)}</td></tr>` : ""}` : "";

  const touristTaxSummary = fiscalTotals && fiscal?.tourist_taxes?.length
    ? `<tr><td>Total des prestations TTC</td><td>${fiscalMoney(fiscalTotals.services_gross_cents)}</td></tr>${buildTouristTaxRows(fiscal.tourist_taxes, sign)}` : "";
  return renderTemplate(template, {
    invoiceThemeId,
    invoiceThemeStyles,
    sandboxNoticeHtml: params.invoice.test_environment === "superpdp-sandbox"
      ? '<div class="sandbox-notice">TEST SUPERPDP - BAC À SABLE<br>Entreprises et identifiants fictifs. Aucune valeur comptable.</div>' : "",
    organizationName: params.invoice.seller?.legal_name || organization?.publicDisplayName || organization?.tradeName || params.gite.proprietaires_noms,
    documentTitle: params.invoice.test_environment === "superpdp-sandbox" ? params.invoice.document_kind === "credit_note" ? "AVOIR TEST" : "FACTURE TEST" : params.invoice.lifecycle_status === "draft" ? params.invoice.document_kind === "credit_note" ? "BROUILLON D’AVOIR" : "BROUILLON" : params.invoice.document_kind === "credit_note" ? "AVOIR" : "FACTURE",
    sellerIdentifiers: params.invoice.seller ? [params.invoice.seller.siren && `SIREN : ${params.invoice.seller.siren}`, params.invoice.seller.siret && `SIRET : ${params.invoice.seller.siret}`, params.invoice.seller.vat_number && `TVA : ${params.invoice.seller.vat_number}`].filter(Boolean).join(" · ") : "",
    bodyAttrs: params.bodyAttrs ?? "",
    invoiceNumber: params.invoice.lifecycle_status === "draft" ? "Non émis — sans numéro définitif" : params.invoice.numero_facture,
    emissionDate: new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris" }).format(params.invoice.issued_at ? new Date(params.invoice.issued_at) : new Date()),
    metaGridClass,
    echeanceMetaHtml: fiscal && !params.invoice.document_kind?.includes("credit") ? fiscal.payment_due_date ? `<div><span class="meta-label">Échéance du solde</span><span class="meta-value">${escapeHtml(fiscal.payment_due_date.split("-").reverse().join("/"))}</span></div>` : "" : echeanceMetaHtml,
    giteName: isMultiReservation
      ? reservationGiteCount === 1
        ? reservationItems[0].gite_nom
        : `${reservationGiteCount} gîtes`
      : params.gite.nom,
    giteAdresse: [params.gite.adresse_ligne1, params.gite.adresse_ligne2].filter(Boolean).join(" - "),
    proprietairesNoms: params.invoice.seller?.legal_name ?? params.gite.proprietaires_noms,
    proprietairesAdresse: params.invoice.seller?.address ?? params.gite.proprietaires_adresse,
    proprietairesContactHtml: buildProprietairesContactHtml(params.gite),
    clientNom: params.invoice.locataire_nom,
    clientAdresseHtml: fiscal ? buildLocataireAdresseHtml([fiscal.buyer.address_line1, fiscal.buyer.address_line2, `${fiscal.buyer.postal_code} ${fiscal.buyer.city}`.trim(), fiscal.buyer.country_code, fiscal.buyer.siren ? `SIREN : ${fiscal.buyer.siren}` : "", fiscal.buyer.vat_number ? `TVA : ${fiscal.buyer.vat_number}` : ""].filter(Boolean).join("\n")) : buildLocataireAdresseHtml(params.invoice.locataire_adresse),
    clientTelLineHtml,
    periodStart: formatOptionalDate(params.invoice.date_debut),
    periodEnd: formatOptionalDate(params.invoice.date_fin),
    nightsLabel: isMultiReservation ? `${reservationItems.length} réservations · ${nightsLabel}` : nightsLabel,
    occupancyLabel: isMultiReservation
      ? `${reservationGiteCount} gîte${reservationGiteCount > 1 ? "s" : ""}`
      : occupancyLabel,
    invoiceRowsHtml: fiscalRows ?? `<tbody>${invoiceRowsHtml}${extraFeesRowsHtml}</tbody>`,
    fiscalSummaryHtml: fiscalSummary + touristTaxSummary,
    invoiceAmountHeading: fiscal ? "Montant TTC" : "Montant",
    invoiceSubtotalLabel: fiscal?.tourist_taxes?.length ? "Total à payer, taxe comprise" : fiscal ? "Total TTC" : "Sous-total",
    taxeSejour: formatEuro(params.totals.taxeSejourCalculee),
    totalGlobal: formatEuro(params.totals.totalGlobal),
    acompteRowHtml: fiscalTotals ? fiscalTotals.paid_cents ? `<tr><td>Sommes réellement reçues</td><td>- ${formatEuro(fiscalTotals.paid_cents / 100)}</td></tr>` : "" : acompteRowHtml,
    soldeLabel: fiscalTotals && sign > 0 ? "Reste à régler à l’émission" : soldeLabel,
    soldeMontant: fiscalTotals ? fiscalMoney(fiscalTotals.due_cents) : formatEuro(toNumber(params.invoice.solde_montant)),
    iban: params.gite.iban,
    bic: params.gite.bic ?? "—",
    titulaire: params.gite.titulaire,
    notesBlockHtml: `${notesBlockHtml}${buildInvoicePaymentTermsHtml(fiscal, sign < 0)}`,
  });
};

// Keep the existing one-page layout when it fits. Detailed invoices may flow
// across pages, with repeating column headers and indivisible monetary rows.
const prepareInvoicePage = async (page: Page, html: string) => {
  const layout = await prepareContractPage(page, html);
  if (!layout.overflowAfter) return { ...layout, multiPage: false };
  await page.evaluate((compactClasses) => {
    document.body.classList.remove(...compactClasses);
    document.body.classList.add("invoice-multipage");
  }, [...compactClassSteps]);
  return { ...layout, overflowAfter: false, compactApplied: false, multiPage: true };
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
    const layout = await prepareInvoicePage(page, html);
    await page.pdf({
      path: params.outputPath,
      ...pdfBaseOptions,
      ...(layout.multiPage ? {
        preferCSSPageSize: true,
        displayHeaderFooter: true,
        headerTemplate: "<span></span>",
        footerTemplate: `<div style="font-size:8px;width:100%;text-align:center;color:#62584d">${escapeHtml(params.invoice.lifecycle_status === "draft" ? "Brouillon non émis" : params.invoice.numero_facture)} · Page <span class="pageNumber"></span> / <span class="totalPages"></span></div>`,
      } : {}),
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
    const compactInfo = await prepareInvoicePage(page, html);
    const renderedHtml = await page.content();
    return { html: renderedHtml, ...compactInfo };
  });
};

export const generatePlanningPdf = (html: string) => withPageRetry(async (page) => {
  await page.route("**/*", (route) => route.abort());
  await page.setContent(html, { waitUntil: "domcontentloaded" });
  return page.pdf({ format: "A4", printBackground: true, margin: { top: "15mm", bottom: "15mm", left: "12mm", right: "12mm" } });
});
