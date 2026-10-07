import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { systemPrisma as prisma } from "../src/db/prisma.js";
import { APP_PAGE_IDS } from "../src/services/appUsers.js";
import { DEFAULT_MODULES } from "../src/services/installationConfig.js";

const PILOT_ORGANIZATION_ID = "org_pilot_fictif";
const PILOT_USER_ID = "user_pilot_fictif";
const PILOT_PROFILE_ID = "profile_pilot_fictif";
const PILOT_GITE_ID = "gite_pilot_fictif";
const PILOT_PLAN_ID = "plan_pilot_provisional";
const PILOT_PLAN_CODE = "pilot_provisional";
const PILOT_LOGIN = "pilote.proprietaire@example.invalid";
const CREDENTIALS_PATH = path.resolve(process.cwd(), "..", "data", "pilot-staging-credentials.json");

const command = process.argv[2] ?? "inventory";
const flags = new Map(process.argv.slice(3).map((value) => {
  const [key, ...rest] = value.split("=");
  return [key, rest.join("=") || "true"];
}));

const hashPassword = async (password: string) => {
  const salt = crypto.randomBytes(16);
  const derived = await new Promise<Buffer>((resolve, reject) => {
    crypto.scrypt(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
  return { passwordHash: derived.toString("hex"), passwordSalt: salt.toString("hex") };
};

const writeCredentialsIfMissing = async () => {
  if (fs.existsSync(CREDENTIALS_PATH)) {
    const parsed = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, "utf8")) as { password?: unknown };
    if (typeof parsed.password !== "string" || parsed.password.length < 12) {
      throw new Error("Le fichier d’identifiants pilote existe mais il est invalide.");
    }
    return { password: parsed.password, created: false };
  }
  const password = crypto.randomBytes(24).toString("base64url");
  fs.mkdirSync(path.dirname(CREDENTIALS_PATH), { recursive: true });
  fs.writeFileSync(CREDENTIALS_PATH, JSON.stringify({ login: PILOT_LOGIN, password }, null, 2), { mode: 0o600 });
  return { password, created: true };
};

const inventory = async () => {
  const [organizations, identities, sessions, administrators] = await Promise.all([
    prisma.organization.findMany({
      where: { id: { not: "org_historical_broceliande" } },
      select: { id: true, slug: true, status: true, _count: { select: { memberships: true } } },
      orderBy: { id: "asc" },
    }),
    prisma.user.findMany({
      where: {
        OR: [
          { id: { contains: "test" } },
          { id: { contains: "pilot" } },
          { login_id: { contains: "example.invalid" } },
        ],
      },
      select: { id: true, login_id: true, _count: { select: { memberships: true, profiles: true } } },
      orderBy: { id: "asc" },
    }),
    prisma.authSession.count({
      where: { OR: [{ user_id: { contains: "test" } }, { user_id: { contains: "pilot" } }] },
    }),
    prisma.platformAdministrator.findMany({
      select: { user_id: true, role: true, status: true },
      orderBy: { user_id: "asc" },
    }),
  ]);
  console.log(JSON.stringify({
    generatedAt: new Date().toISOString(),
    scope: "technical-test-identities-only",
    nonHistoricalOrganizations: organizations,
    matchingTechnicalIdentities: identities,
    matchingActiveOrExpiredSessions: sessions,
    platformAdministrators: administrators,
  }, null, 2));
};

const provision = async () => {
  if (flags.get("--apply") !== "true" || flags.get("--confirm") !== PILOT_ORGANIZATION_ID) {
    throw new Error(`Provisionnement refusé. Utilisez --apply --confirm=${PILOT_ORGANIZATION_ID}.`);
  }
  const credentials = await writeCredentialsIfMissing();
  const password = await hashPassword(credentials.password);
  const modules = { ...DEFAULT_MODULES, reservations: true, contracts: true, invoices: true };
  const profile = {
    tradeName: "Gîtes Pilote Fictifs",
    legalName: "Société Pilote Fictive",
    addressLine1: "1 rue de la Démonstration",
    addressLine2: "",
    postalCode: "00000",
    city: "Ville fictive",
    country: "FR",
    email: PILOT_LOGIN,
    phone: "",
    website: "https://example.invalid",
    iban: "",
    bic: "",
    bankAccountHolder: "Société Pilote Fictive",
    locale: "fr-FR",
    currency: "EUR",
    timezone: "Europe/Paris",
    logoUrl: "",
    faviconUrl: "",
    primaryColor: "#315f4b",
    emailSignature: "",
    smsSignature: "",
    documentFooter: "Données de démonstration sans valeur contractuelle.",
    publicDisplayName: "Gîtes Pilote Fictifs",
    documentLocale: "fr-FR",
    documentDateFormat: "",
    documentPaymentTerms: "",
  };
  const permissions = JSON.stringify({ roles: JSON.stringify(["owner"]), pageAccess: JSON.stringify(APP_PAGE_IDS), canWrite: true, canViewAmounts: true });

  await prisma.$transaction(async (tx) => {
    await tx.organization.upsert({
      where: { id: PILOT_ORGANIZATION_ID },
      update: { name: "Gîtes Pilote Fictifs", status: "active" },
      create: { id: PILOT_ORGANIZATION_ID, slug: "pilote-fictif", name: "Gîtes Pilote Fictifs", status: "active" },
    });
    await tx.user.upsert({
      where: { id: PILOT_USER_ID },
      update: { login_id: PILOT_LOGIN, email: PILOT_LOGIN, password_hash: password.passwordHash, password_salt: password.passwordSalt, password_updated_at: new Date() },
      create: { id: PILOT_USER_ID, login_id: PILOT_LOGIN, email: PILOT_LOGIN, password_hash: password.passwordHash, password_salt: password.passwordSalt, password_updated_at: new Date() },
    });
    await tx.membership.upsert({
      where: { user_id_organization_id: { user_id: PILOT_USER_ID, organization_id: PILOT_ORGANIZATION_ID } },
      update: { role: "owner", status: "active", permissions, accepted_at: new Date() },
      create: { id: "membership_pilot_fictif", user_id: PILOT_USER_ID, organization_id: PILOT_ORGANIZATION_ID, role: "owner", status: "active", permissions, accepted_at: new Date() },
    });
    await tx.organizationSettings.upsert({
      where: { organization_id: PILOT_ORGANIZATION_ID },
      update: { profile_json: JSON.stringify(profile), modules_json: JSON.stringify(modules), setup_completed: true },
      create: { organization_id: PILOT_ORGANIZATION_ID, profile_json: JSON.stringify(profile), branding_json: JSON.stringify(profile), documents_json: JSON.stringify(profile), modules_json: JSON.stringify(modules), setup_completed: true },
    });
    await tx.appUser.upsert({
      where: { id: PILOT_PROFILE_ID },
      update: { user_id: PILOT_USER_ID, display_name: "Propriétaire pilote fictif", first_name: "Propriétaire", last_name: "Pilote", roles: JSON.stringify(["owner"]), email: PILOT_LOGIN, status: "owner", page_access: JSON.stringify(APP_PAGE_IDS), can_write: true, can_view_amounts: true, is_owner: true, is_active: true, login_id: PILOT_LOGIN, password_hash: password.passwordHash, password_salt: password.passwordSalt, password_updated_at: new Date() },
      create: { id: PILOT_PROFILE_ID, organization_id: PILOT_ORGANIZATION_ID, user_id: PILOT_USER_ID, display_name: "Propriétaire pilote fictif", first_name: "Propriétaire", last_name: "Pilote", roles: JSON.stringify(["owner"]), email: PILOT_LOGIN, status: "owner", page_access: JSON.stringify(APP_PAGE_IDS), can_write: true, can_view_amounts: true, is_owner: true, is_active: true, login_id: PILOT_LOGIN, password_hash: password.passwordHash, password_salt: password.passwordSalt, password_updated_at: new Date() },
    });
    await tx.plan.upsert({
      where: { code: PILOT_PLAN_CODE },
      update: { name: "Pilote provisoire", description: "Configuration temporaire du pilote, sans engagement commercial.", status: "active", public_metadata: JSON.stringify({ commercial: true, provisional: true }) },
      create: { id: PILOT_PLAN_ID, code: PILOT_PLAN_CODE, name: "Pilote provisoire", description: "Configuration temporaire du pilote, sans engagement commercial.", billing_periods: JSON.stringify(["monthly", "annual"]), status: "active", public_metadata: JSON.stringify({ commercial: true, provisional: true }) },
    });
    const entitlements = [
      ...Object.entries(modules).map(([key, enabled]) => ({ feature_key: `module.${key}`, value_boolean: enabled, limit_value: null, limit_type: "hard" })),
      { feature_key: "active_properties", value_boolean: null, limit_value: 2, limit_type: "hard" },
      { feature_key: "manager_members", value_boolean: null, limit_value: 3, limit_type: "hard" },
      { feature_key: "worker_members", value_boolean: null, limit_value: 5, limit_type: "soft" },
      { feature_key: "reservations_created", value_boolean: null, limit_value: 50, limit_type: "soft" },
      { feature_key: "documents_generated", value_boolean: null, limit_value: 50, limit_type: "soft" },
      { feature_key: "storage_bytes", value_boolean: null, limit_value: 104857600, limit_type: "soft" },
      { feature_key: "sms_sent", value_boolean: null, limit_value: 0, limit_type: "hard" },
      { feature_key: "automations_executed", value_boolean: null, limit_value: 0, limit_type: "hard" },
    ];
    for (const entitlement of entitlements) {
      await tx.planEntitlement.upsert({
        where: { plan_id_feature_key: { plan_id: PILOT_PLAN_ID, feature_key: entitlement.feature_key } },
        update: entitlement,
        create: { id: `pilot_ent_${entitlement.feature_key.replace(/[^a-z0-9]+/gi, "_")}`, plan_id: PILOT_PLAN_ID, ...entitlement },
      });
    }
    await tx.subscription.upsert({
      where: { organization_id: PILOT_ORGANIZATION_ID },
      update: { plan_id: PILOT_PLAN_ID, status: "trialing" },
      create: { id: "subscription_pilot_fictif", organization_id: PILOT_ORGANIZATION_ID, plan_id: PILOT_PLAN_ID, status: "trialing", trial_start: new Date(), trial_end: new Date(Date.now() + 30 * 86_400_000) },
    });
    await tx.gite.upsert({
      where: { id: PILOT_GITE_ID },
      update: { nom: "Maison Démo", public_is_published: false },
      create: { id: PILOT_GITE_ID, organization_id: PILOT_ORGANIZATION_ID, nom: "Maison Démo", prefixe_contrat: "PIL", adresse_ligne1: "1 rue de la Démonstration", capacite_max: 4, nb_adultes_max: 4, nb_adultes_habituel: 2, nb_enfants_max: 2, proprietaires_noms: "Société Pilote Fictive", proprietaires_adresse: "1 rue de la Démonstration, 00000 Ville fictive", site_web: "https://example.invalid", email: PILOT_LOGIN, telephones: "[]", taxe_sejour_par_personne_par_nuit: 0, iban: "", titulaire: "Société Pilote Fictive", public_is_published: false },
    });
    for (const [index, id] of ["reservation_pilot_fictive_1", "reservation_pilot_fictive_2"].entries()) {
      const start = new Date(Date.UTC(2030, index, 10));
      const end = new Date(Date.UTC(2030, index, 12));
      await tx.reservation.upsert({
        where: { id },
        update: { hote_nom: `Voyageur fictif ${index + 1}` },
        create: { id, organization_id: PILOT_ORGANIZATION_ID, gite_id: PILOT_GITE_ID, origin_system: "staging_fixture", origin_reference: id, export_to_ical: false, hote_nom: `Voyageur fictif ${index + 1}`, email: `voyageur${index + 1}@example.invalid`, date_entree: start, date_sortie: end, nb_nuits: 2, nb_adultes: 2, nb_enfants_2_17: 0, prix_par_nuit: 100, prix_total: 200, commentaire: "Donnée fictive de staging", options: "{}" },
      });
    }
    const existingAudit = await tx.auditLog.findFirst({
      where: { organization_id: PILOT_ORGANIZATION_ID, action: "staging.pilot.provisioned", resource_id: PILOT_ORGANIZATION_ID },
    });
    if (!existingAudit) {
      await tx.auditLog.create({
        data: { organization_id: PILOT_ORGANIZATION_ID, user_id: PILOT_USER_ID, action: "staging.pilot.provisioned", resource_type: "organization", resource_id: PILOT_ORGANIZATION_ID, metadata_json: JSON.stringify({ fictitious: true, integrationsEnabled: false }) },
      });
    }
  });
  console.log(JSON.stringify({ provisioned: true, organizationId: PILOT_ORGANIZATION_ID, login: PILOT_LOGIN, credentialsFile: CREDENTIALS_PATH, credentialsCreated: credentials.created, integrationsEnabled: false }, null, 2));
};

const cleanupPreview = async () => {
  const organization = await prisma.organization.findUnique({
    where: { id: PILOT_ORGANIZATION_ID },
    include: { _count: { select: { memberships: true, jobs: true, audit_logs: true, subscriptions: true, billing_events: true } } },
  });
  const [profiles, gites, reservations] = await Promise.all([
    prisma.appUser.count({ where: { organization_id: PILOT_ORGANIZATION_ID } }),
    prisma.gite.count({ where: { organization_id: PILOT_ORGANIZATION_ID } }),
    prisma.reservation.count({ where: { organization_id: PILOT_ORGANIZATION_ID } }),
  ]);
  console.log(JSON.stringify({ destructive: true, applied: false, target: organization, dependentCounts: { profiles, gites, reservations }, requiredConfirmation: `--apply --confirm=${PILOT_ORGANIZATION_ID} --backup=/absolute/path/to/validated-backup.tar.gz` }, null, 2));
};

const cleanup = async () => {
  const backup = flags.get("--backup");
  if (flags.get("--apply") !== "true" || flags.get("--confirm") !== PILOT_ORGANIZATION_ID || !backup || !path.isAbsolute(backup) || !fs.existsSync(backup)) {
    throw new Error(`Nettoyage refusé. Une sauvegarde validée et la confirmation exacte de ${PILOT_ORGANIZATION_ID} sont requises.`);
  }
  await prisma.$transaction(async (tx) => {
    await tx.authSession.deleteMany({ where: { user_id: PILOT_PROFILE_ID } });
    await tx.organization.delete({ where: { id: PILOT_ORGANIZATION_ID } });
    await tx.user.delete({ where: { id: PILOT_USER_ID } });
  });
  console.log(JSON.stringify({ removed: true, organizationId: PILOT_ORGANIZATION_ID, backup }, null, 2));
};

try {
  if (command === "inventory") await inventory();
  else if (command === "provision") await provision();
  else if (command === "cleanup-preview") await cleanupPreview();
  else if (command === "cleanup") await cleanup();
  else throw new Error("Commande attendue: inventory, provision, cleanup-preview ou cleanup.");
} finally {
  await prisma.$disconnect();
}
