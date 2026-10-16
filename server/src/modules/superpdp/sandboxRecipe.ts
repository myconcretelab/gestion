/** Local operator recipe only: no router, worker, Facture or legal-identity writes. */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import {
  computeInvoiceFiscal,
  emptyInvoiceFiscalInput,
} from "@contrats/shared";
import { buildStructuredInvoice } from "../documents/invoiceFiscal.js";
import type {
  GiteLike,
  InvoiceRenderInput,
} from "../../services/pdfService.js";
import type { ContractTotals } from "../../services/contractCalculator.js";
import { remoteId, type Validation } from "./transport.js";

export const recipeIdSchema = z.string().uuid();
const partySchema = z
  .object({
    entityId: z.string().min(1).max(100),
    connectionId: z.string().min(1).max(100),
    companyId: remoteId,
    number: z.enum(["000000002", "000000001"]),
    address: z.string(),
  })
  .strict();
export const recipeBindingSchema = z
  .object({
    organizationId: z.string().min(1).max(100),
    sender: partySchema,
    recipient: partySchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    const { sender, recipient } = value;
    if (
      sender.number !== "000000002" ||
      recipient.number !== "000000001" ||
      sender.companyId === recipient.companyId ||
      sender.entityId === recipient.entityId ||
      sender.connectionId === recipient.connectionId ||
      sender.address !== `0225:315143296_${sender.companyId}` ||
      recipient.address !== `0225:315143296_${recipient.companyId}`
    )
      ctx.addIssue({
        code: "custom",
        message: "Paire fictive SuperPDP inattendue.",
      });
  });
export type RecipeBinding = z.infer<typeof recipeBindingSchema>;
export const checksum = (bytes: Buffer | string) =>
  crypto.createHash("sha256").update(bytes).digest("hex");

export function requireLocalSandboxRecipe(config: {
  mode: string;
  confirmed: boolean;
  database: string | undefined;
  expectedDatabase: string;
  sandboxEnabled: boolean;
  automatedOrOrdinaryFlows: readonly boolean[];
  pdfDisabled: boolean;
}) {
  if (
    config.mode !== "development" ||
    !config.confirmed ||
    config.database !== `file:${config.expectedDatabase}` ||
    !config.sandboxEnabled ||
    config.pdfDisabled ||
    config.automatedOrOrdinaryFlows.some(Boolean)
  )
    throw new Error("RECIPE_LOCAL_GUARDS");
}

export function requirePositiveRecipeValidation(report: Validation) {
  const file = report.data[0];
  if (
    !file.is_valid ||
    file.error ||
    !file.subreports.length ||
    file.subreports.some((part) => part.failures.length > 0) ||
    !file.subreports.some((part) => part.checks_count > 0)
  )
    throw new Error("RECIPE_VALIDATION_FAILED");
}

/** Fixed, explicit test data, NOT defaults or a proposed tax treatment of rentals.
 * Sandbox numbers, VAT examples and Peppol prefix observed in the provider fixture
 * (API 1.37.0.beta); no invented SIRET and no change to connected entity records.
 */
export function buildSandboxRecipe(
  binding: RecipeBinding,
  runId: string,
  date: string,
) {
  recipeBindingSchema.parse(binding);
  recipeIdSchema.parse(runId);
  z.string().date().parse(date);
  const issuedAt = new Date(`${date}T10:00:00Z`);
  const number = `TEST-PDP-${date.replaceAll("-", "")}-${runId.slice(0, 8)}`;
  const input = emptyInvoiceFiscalInput();
  input.operation_kind = "services";
  Object.assign(input.buyer, {
    kind: "business",
    siren: "000000001",
    vat_number: "FR15000000001",
    address_line1: "1 rue de la Recette fictive",
    postal_code: "75001",
    city: "Paris",
    country_code: "FR",
  });
  input.lines = [
    {
      id: "sandbox-1",
      label: "Prestation fictive de recette A",
      quantity: 1,
      unit: "C62",
      unit_price_ttc: 120,
      vat_category: "S",
      vat_rate: 20,
      exemption_reason: "",
    },
    {
      id: "sandbox-2",
      label: "Prestation fictive de recette B",
      quantity: 1,
      unit: "C62",
      unit_price_ttc: 55,
      vat_category: "S",
      vat_rate: 10,
      exemption_reason: "",
    },
  ];
  input.payment_due_date = date;
  input.payment_terms =
    "Conditions fictives de recette - aucun règlement attendu.";
  input.b2b_payment_mentions = {
    late_payment_penalties:
      "Pénalités fictives : taux annuel de 10 % (test uniquement).",
    recovery_fee: "Indemnité forfaitaire fictive : 40 EUR (test uniquement).",
    early_payment_discount: "Aucun escompte (test uniquement).",
  };
  input.reviewed = true;
  input.tourist_tax_reviewed = true;
  const seller = {
    legal_name: "Burger Queen",
    siren: "000000002",
    siret: null,
    vat_number: "FR18000000002",
    address: "2 rue de la Recette fictive\n75001 Paris\nFR",
    email: null,
  };
  const snapshot = buildStructuredInvoice({
    input,
    number,
    issuedAt,
    buyerName: "Tricatel",
    credit: false,
    periodStart: issuedAt,
    periodEnd: issuedAt,
    issuer: {
      entity: {
        ...seller,
        address_line1: "2 rue de la Recette fictive",
        address_line2: null,
        postal_code: "75001",
        city: "Paris",
        country_code: "FR",
      },
      establishment: { siret: null },
    },
  });
  // Isolated adapter for provider fictitious companies, never used by emission.ts.
  // Their legal registration number is NOT the prefix of their Peppol address.
  const { identifiers: _absentSiret, ...sandboxSeller } =
    snapshot.en_invoice_candidate.seller;
  const electronic = (address: string) => {
    const [scheme, value] = address.split(":");
    return { scheme, value };
  };
  const payload = {
    ...snapshot.en_invoice_candidate,
    seller: {
      ...sandboxSeller,
      electronic_address: electronic(binding.sender.address),
    },
    buyer: {
      ...snapshot.en_invoice_candidate.buyer,
      electronic_address: electronic(binding.recipient.address),
    },
    notes: [
      ...snapshot.en_invoice_candidate.notes,
      {
        subject_code: "AAI",
        note: "TEST SUPERPDP - BAC À SABLE - aucune valeur comptable.",
      },
    ],
  };
  const computed = computeInvoiceFiscal(input);
  const totals: ContractTotals = {
    nbNuits: 0,
    montantBase: 175,
    totalSansOptions: 175,
    optionsTotal: 0,
    taxeSejourCalculee: 0,
    solde: 175,
    totalGlobal: 175,
    optionsDetail: {
      draps: 0,
      linge: 0,
      menage: 0,
      departTardif: 0,
      chiens: 0,
    },
  };
  const invoice: InvoiceRenderInput = {
    test_environment: "superpdp-sandbox",
    fiscal: input,
    numero_facture: number,
    issued_at: issuedAt,
    seller,
    locataire_nom: "Tricatel",
    locataire_adresse: "",
    locataire_tel: "",
    nb_adultes: 0,
    nb_enfants_2_17: 0,
    date_debut: issuedAt,
    date_fin: issuedAt,
    heure_arrivee: "",
    heure_depart: "",
    prix_par_nuit: 0,
    remise_montant: 0,
    arrhes_montant: 0,
    arrhes_date_limite: issuedAt,
    solde_montant: 175,
    cheque_menage_montant: 0,
    caution_montant: 0,
    options: {},
  };
  const gite: GiteLike = {
    nom: "Recette technique SuperPDP",
    adresse_ligne1: "Lieu fictif - aucun séjour réel",
    proprietaires_noms: seller.legal_name,
    proprietaires_adresse: seller.address,
    capacite_max: 0,
    telephones: [],
    taxe_sejour_par_personne_par_nuit: 0,
    iban: "Non applicable - test",
    bic: "Non applicable",
    titulaire: "Aucun paiement attendu",
    regle_animaux_acceptes: false,
    regle_bois_premiere_flambee: false,
    regle_tiers_personnes_info: false,
    options_draps_par_lit: 0,
    options_linge_toilette_par_personne: 0,
    options_menage_forfait: 0,
    options_depart_tardif_forfait: 0,
    options_chiens_forfait: 0,
  };
  return {
    version: 1 as const,
    runId,
    date,
    number,
    binding,
    input,
    payload,
    computed,
    render: { invoice, gite, totals },
  };
}

/** Exclusive durable evidence. A started intent is final even after an exception.
 * Do not remove/copy/reset this ledger to retry a send, including after restoration.
 */
export class SandboxRecipeLedger {
  readonly directory: string;
  constructor(root: string, runId: string, create = false) {
    recipeIdSchema.parse(runId);
    fs.mkdirSync(root, { recursive: true, mode: 0o700 });
    this.directory = path.join(fs.realpathSync(root), runId);
    if (create) {
      fs.mkdirSync(this.directory, { mode: 0o700 });
      const parent = fs.openSync(fs.realpathSync(root), "r");
      try {
        fs.fsyncSync(parent);
      } finally {
        fs.closeSync(parent);
      }
    }
    const stat = fs.lstatSync(this.directory);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new Error("RECIPE_DIRECTORY");
  }
  write(name: string, bytes: Buffer | string) {
    if (!/^[a-z0-9][a-z0-9.-]+$/.test(name)) throw new Error("RECIPE_FILE");
    const fd = fs.openSync(path.join(this.directory, name), "wx", 0o600);
    try {
      fs.writeFileSync(fd, bytes);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    const directory = fs.openSync(this.directory, "r");
    try {
      fs.fsyncSync(directory);
    } finally {
      fs.closeSync(directory);
    }
  }
  json(name: string, value: unknown) {
    this.write(name, JSON.stringify(value, null, 2));
  }
  read(name: string) {
    if (!/^[a-z0-9][a-z0-9.-]+$/.test(name)) throw new Error("RECIPE_FILE");
    const file = path.join(this.directory, name);
    const fd = fs.openSync(
      file,
      fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW,
    );
    try {
      const stat = fs.fstatSync(fd);
      if (!stat.isFile() || stat.size > 20 * 1024 * 1024)
        throw new Error("RECIPE_FILE");
      return fs.readFileSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  }
  async sendOnce<T>(intent: unknown, send: () => Promise<T>): Promise<T> {
    this.json("send-intent.json", {
      at: new Date().toISOString(),
      neverAutoResend: true,
      intent,
    });
    try {
      const response = await send();
      this.json("send-response.json", response);
      return response;
    } catch {
      // Never persist arbitrary error bodies, credentials or tokens.
      this.json("send-unconfirmed.json", {
        at: new Date().toISOString(),
        neverResend: true,
      });
      throw new Error("RECIPE_SEND_UNCONFIRMED_NEVER_RETRY");
    }
  }
}
