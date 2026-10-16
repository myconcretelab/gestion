import { fiscalEntityMissingFields } from "@contrats/shared";
import prisma from "../../db/prisma.js";
import { env } from "../../config/env.js";
import { sandboxAvailability, superPdpError } from "./secrets.js";

type Check = {
  id: string;
  title: string;
  state: "observed" | "action_required" | "not_verified";
  detail: string;
};
const errors = ["api:invalid", "api:rejected", "fr:210", "fr:213", "fr:501"];
const totals = (
  groups: Array<{ status: string; _count: { _all: number } }>,
  known: string[],
) => {
  const byStatus = Object.fromEntries(
    groups.map((g) => [g.status, g._count._all]),
  );
  const count = (...statuses: string[]) =>
    statuses.reduce((sum, status) => sum + (byStatus[status] ?? 0), 0);
  return {
    count,
    total: groups.reduce((sum, g) => sum + g._count._all, 0),
    unknown: groups
      .filter((g) => !known.includes(g.status))
      .reduce((sum, g) => sum + g._count._all, 0),
  };
};

/** Local observation only. No provider calls, refresh, decryption, file access, queueing or writes.
 * Neither a sandbox acceptance certificate nor a production authorization.
 */
export class SuperPdpReadiness {
  async view(entityId: string) {
    const observedAt = new Date();
    const entity = await prisma.fiscalEntity.findUnique({
      where: { id: entityId },
      select: {
        id: true,
        siren: true,
        vat_regime: true,
        vat_number: true,
        address_line1: true,
        postal_code: true,
        city: true,
        country_code: true,
        establishments: { select: { siret: true } },
      },
    });
    if (!entity)
      throw superPdpError("SUPERPDP_NOT_FOUND", "Entreprise introuvable.", 404);
    const scope = { fiscal_entity_id: entityId, environment: "sandbox" };
    const [
      connection,
      transmissions,
      payments,
      paymentErrors,
      inboxes,
      incoming,
      incomplete,
      unmatched,
      remoteErrors,
      credentialRows,
    ] = await Promise.all([
      prisma.superPdpConnection.findFirst({
        where: scope,
        select: {
          id: true,
          status: true,
          local_siren: true,
          remote_company_id: true,
          verification_status: true,
          last_checked_at: true,
          operation_id: true,
          operation_expires_at: true,
          last_error_code: true,
        },
      }),
      prisma.electronicInvoiceTransmission.groupBy({
        by: ["status"],
        where: scope,
        _count: { _all: true },
      }),
      prisma.electronicInvoicePayment.groupBy({
        by: ["status"],
        where: { transmission: scope },
        _count: { _all: true },
      }),
      prisma.electronicInvoicePayment.count({
        where: {
          transmission: scope,
          status: "recorded",
          last_error_code: { not: null },
        },
      }),
      prisma.superPdpInboxSync.findMany({
        where: scope,
        select: {
          connection_id: true,
          remote_company_id: true,
          enabled: true,
          last_error_code: true,
          last_synced_at: true,
          next_sync_at: true,
        },
      }),
      prisma.incomingInvoice.count({ where: { sync: scope } }),
      prisma.incomingInvoice.count({
        where: {
          sync: scope,
          OR: [
            { invoice_number: null },
            { details_next_check_at: { not: null } },
          ],
        },
      }),
      prisma.incomingInvoice.count({
        where: { sync: scope, expense_id: null },
      }),
      prisma.electronicInvoiceEvent.count({
        where: {
          transmission: scope,
          event_key: { startsWith: "remote:" },
          OR: [
            { status_code: { in: errors } },
            { status_code: { startsWith: "ppf:", endsWith: "-ack-error" } },
            { status_code: { startsWith: "ppf:", endsWith: "-rejected" } },
          ],
        },
      }),
      prisma.superPdpConnection.count({
        where: {
          ...scope,
          client_id: { not: null },
          expected_number: { not: null },
          encrypted_client_secret: { not: null },
          encrypted_tokens: { not: null },
        },
      }),
    ]);
    const tx = totals(transmissions, [
      "queued_prepare",
      "preparing",
      "ready",
      "validation_failed",
      "prepare_failed",
      "queued_send",
      "sending",
      "submitted",
      "send_unknown",
      "paused_after_restore",
    ]);
    const pay = totals(payments, [
      "recorded",
      "queued",
      "sending",
      "submitted",
      "send_unknown",
      "paused_after_restore",
    ]);
    const configuration = sandboxAvailability();
    const missing = fiscalEntityMissingFields(entity);
    const establishments = entity.establishments.filter(
      (e) =>
        e.siret &&
        /^\d{14}$/.test(e.siret) &&
        entity.siren &&
        e.siret.startsWith(entity.siren),
    ).length;
    const connectionRecent =
      !!connection?.last_checked_at &&
      connection.last_checked_at.getTime() <= observedAt.getTime() + 300_000 &&
      observedAt.getTime() - connection.last_checked_at.getTime() <= 86_400_000;
    const connectionObserved =
      connection?.status === "connected" &&
      connection.verification_status === "verified" &&
      connection.local_siren === entity.siren &&
      !!connection.remote_company_id &&
      !connection.operation_id &&
      !connection.last_error_code &&
      connectionRecent;
    const credentialsObserved = credentialRows === 1;
    const inboxErrors = inboxes.filter(
      (i) =>
        !!i.last_error_code ||
        i.connection_id !== connection?.id ||
        i.remote_company_id !== connection?.remote_company_id,
    ).length;
    const inboxLate = inboxes.filter(
      (i) =>
        i.enabled &&
        (!i.last_synced_at ||
          !i.next_sync_at ||
          i.next_sync_at.getTime() < observedAt.getTime() - 900_000),
    ).length;
    const historicalCompanies =
      await prisma.electronicInvoiceTransmission.count({
        where: {
          ...scope,
          ...(connection?.remote_company_id
            ? { remote_company_id: { not: connection.remote_company_id } }
            : {}),
        },
      });
    const checks: Check[] = [
      {
        id: "configuration",
        title: "Configuration du bac à sable",
        state: configuration.available ? "observed" : "action_required",
        detail: configuration.available
          ? "Configuration locale exploitable. Cela ne vérifie ni la séparation physique des environnements ni l’enregistrement du retour OAuth chez SuperPDP."
          : (configuration.reason ?? "Configuration indisponible."),
      },
      {
        id: "identity",
        title: "Identité et établissements facturants",
        state:
          !missing.length && establishments > 0 && entity.country_code === "FR"
            ? "observed"
            : "action_required",
        detail: missing.length
          ? `Informations à compléter : ${missing.join(", ")}.`
          : establishments === 0
            ? "Aucun établissement avec SIRET rattaché au SIREN de cette entreprise."
            : entity.country_code !== "FR"
              ? "Le premier pilote est limité aux émetteurs français."
              : `${establishments} établissement(s) avec un SIRET cohérent. Vérifier séparément les rattachements des gîtes et les choix fiscaux.`,
      },
      {
        id: "connection",
        title: "Dernière vérification de connexion enregistrée",
        state:
          connectionObserved && credentialsObserved
            ? "observed"
            : "action_required",
        detail:
          connectionObserved && credentialsObserved
            ? "Une identité sandbox vérifiée a été enregistrée il y a moins de 24 heures. Ce bilan ne contacte pas SuperPDP et ne prouve pas que le consentement est encore valide."
            : "Connecter l’entreprise fictive attendue, résoudre toute opération interrompue puis vérifier la connexion. Une observation de plus de 24 heures est considérée ancienne.",
      },
      {
        id: "worker",
        title: "Configuration du traitement en arrière-plan",
        state: env.ORGANIZATION_JOB_WORKER_ENABLED
          ? "observed"
          : "action_required",
        detail: env.ORGANIZATION_JOB_WORKER_ENABLED
          ? "Le traitement est configuré comme actif. Le fonctionnement réel du processus doit être vérifié pendant la recette."
          : "Le traitement est désactivé ; les demandes restent en attente. Ne l’activer que dans l’installation de test autorisée.",
      },
      {
        id: "transmissions",
        title: "Historique local des émissions de test",
        state:
          tx.count(
            "send_unknown",
            "paused_after_restore",
            "validation_failed",
            "prepare_failed",
          ) ||
          tx.unknown ||
          historicalCompanies ||
          remoteErrors
            ? "action_required"
            : tx.total
              ? "observed"
              : "not_verified",
        detail: tx.total
          ? `${tx.total} transmission(s), dont ${tx.count("submitted")} dépôt(s) confirmé(s). Les dépôts, événements et rapports locaux ne prouvent pas à eux seuls une recette réelle ni l’acceptation finale. Les anciens rejets restent à examiner, même s’ils ont été résolus.`
          : "Aucune émission de test observée pour cette entreprise. Les tests automatisés simulés ne remplacent pas la recette réelle.",
      },
      {
        id: "payments",
        title: "Journal local des encaissements de test",
        state:
          pay.count("send_unknown", "paused_after_restore") ||
          pay.unknown ||
          paymentErrors
            ? "action_required"
            : pay.total
              ? "observed"
              : "not_verified",
        detail: `${pay.total} encaissement(s) enregistré(s), dont ${pay.count("submitted")} création(s) de message 212 confirmée(s). Un mouvement local non envoyé n’implique pas automatiquement une obligation de déclaration. Vérifier le profil de TVA et les résultats dans SuperPDP.`,
      },
      {
        id: "inbox",
        title: "Réception locale des achats de test",
        state:
          inboxErrors || inboxLate || incomplete
            ? "action_required"
            : incoming
              ? "observed"
              : "not_verified",
        detail: `${incoming} achat(s) archivé(s), ${incomplete} extraction(s) en attente, ${unmatched} document(s) sans rapprochement local. Le rapprochement n’est pas obligatoire et une association par montant n’est pas une preuve suffisante. Les paramètres d’annuaire de réception doivent être vérifiés séparément.`,
      },
    ];
    const manualChecks: Check[] = [
      {
        id: "isolation",
        title: "Installation de test réellement distincte",
        state: "not_verified",
        detail:
          "Confirmer site/URL, base, stockage documentaire, clé de chiffrement, secrets et consentements séparés de la production. Aucun fichier d’accès n’est lu par ce bilan.",
      },
      {
        id: "oauth",
        title: "Consentement réel et cycle de vie OAuth",
        state: "not_verified",
        detail:
          "Enregistrer l’URL exacte, consentir humainement, tester expiration/rotation/révocation et isolement de deux entreprises fictives. Un même identifiant d’application ne prouve pas une délégation multi-entreprise.",
      },
      {
        id: "provider_acceptance",
        title: "Recette réelle B2B, achats et B2C retenus",
        state: "not_verified",
        detail:
          "Sur données fictives cohérentes : conversion/validation Factur-X réelles, dépôt unique, événements, achat reçu et rapprochement, puis transaction B2C et paiements si applicables. Conserver les preuves hors des journaux et du dépôt public.",
      },
      {
        id: "fiscal_scope",
        title: "Validation du périmètre fiscal",
        state: "not_verified",
        detail:
          "Faire qualifier TVA, biens/services, exonérations, taxe de séjour, acomptes et remboursements. Les cas exclus restent bloqués, sans contournement. Aucune attestation de conformité n’est produite.",
      },
      {
        id: "recovery",
        title: "Sauvegarde restaurable et gestion d’incident",
        state: "not_verified",
        detail:
          "Restaurer une sauvegarde récente dans un environnement isolé, comparer archives et empreintes, vérifier les mises en pause et l’absence de rejeu. Prévoir alertes, opérateur et traitement des résultats inconnus.",
      },
      {
        id: "production",
        title: "Connecteur de production et autorisation explicite",
        state: "not_verified",
        detail:
          "Le connecteur de production n’est pas implémenté. Il nécessite un chantier distinct (identités SIREN, configuration, consentements, clés, gardes par entreprise et tests), puis une autorisation explicite de déploiement et d’activation du pilote.",
      },
    ];
    return {
      version: 1,
      environment: "sandbox",
      fiscal_entity_id: entity.id,
      observed_at: observedAt.toISOString(),
      read_only: true,
      production: {
        enabled: false,
        status: "blocked",
        reason:
          "Bilan de préparation uniquement : aucun déploiement, consentement, dépôt ou passage en production n’est exécuté. Le code actuel ne peut pas activer un connecteur de production.",
      },
      summary: {
        state: checks.some((c) => c.state === "action_required")
          ? "action_required"
          : "manual_checks_required",
        local_actions: checks.filter((c) => c.state === "action_required")
          .length,
        manual_checks: manualChecks.length,
      },
      capabilities: {
        sandbox_enabled: env.SUPERPDP_SANDBOX_ENABLED,
        emission_enabled: env.SUPERPDP_SANDBOX_EMISSION_ENABLED,
        reception_enabled: env.SUPERPDP_SANDBOX_RECEPTION_ENABLED,
        b2c_enabled: env.SUPERPDP_SANDBOX_B2C_ENABLED,
      },
      counts: {
        transmissions: {
          total: tx.total,
          submitted: tx.count("submitted"),
          ready: tx.count("ready"),
          uncertain: tx.count("send_unknown"),
          failed: tx.count("validation_failed", "prepare_failed"),
          paused: tx.count("paused_after_restore"),
          in_progress: tx.count(
            "queued_prepare",
            "preparing",
            "queued_send",
            "sending",
          ),
          unknown_state: tx.unknown,
          binding_to_review: historicalCompanies,
          historical_remote_errors: remoteErrors,
        },
        payments: {
          total: pay.total,
          recorded: pay.count("recorded"),
          submitted: pay.count("submitted"),
          uncertain: pay.count("send_unknown"),
          paused: pay.count("paused_after_restore"),
          in_progress: pay.count("queued", "sending"),
          blocked_before_send: paymentErrors,
          unknown_state: pay.unknown,
        },
        incoming: {
          total: incoming,
          incomplete,
          unmatched,
          configurations_to_review: inboxErrors,
          synchronizations_to_review: inboxLate,
        },
      },
      checks,
      manual_checks: manualChecks,
    };
  }
}
