import crypto from "node:crypto";
import * as oauth from "oauth4webapi";
import type { SuperPdpConnection, Prisma } from "@prisma/client";
import { z } from "zod";
import prisma from "../../db/prisma.js";
import { getOrganizationId } from "../organizations/context.js";
import {
  digest,
  seal,
  unseal,
  sandboxConfig,
  sandboxAvailability,
  superPdpError,
} from "./secrets.js";
import {
  SuperPdpProvider,
  parseStoredTokens,
  type Tokens,
} from "./provider.js";

export type OAuthActor = { userId: string; sessionHash: string };
export const connectionConfigSchema = z
  .object({
    revision: z.number().int().nonnegative(),
    client_id: z
      .string()
      .trim()
      .min(1)
      .max(250)
      .regex(/^[\x21-\x7e]+$/),
    client_secret: z.string().min(1).max(4096).optional(),
    sandbox_number: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .refine((value) => !/[\x00-\x1f\x7f]/.test(value)),
  })
  .strict();

const clearRemote = {
  encrypted_tokens: null,
  access_expires_at: null,
  remote_company_id: null,
  remote_company_number: null,
  remote_company_name: null,
  verification_status: null,
} satisfies Prisma.SuperPdpConnectionUpdateManyMutationInput;
const safeCode = (error: unknown) => {
  const code = String((error as { code?: unknown })?.code ?? "");
  return /^SUPERPDP_[A-Z_]+$/.test(code)
    ? code
    : code === "P2002"
      ? "SUPERPDP_DUPLICATE_COMPANY"
      : "SUPERPDP_STORAGE";
};
const safeFailure = (error: unknown) => {
  if (
    /^SUPERPDP_[A-Z_]+$/.test(String((error as { code?: unknown })?.code ?? ""))
  )
    return error;
  return superPdpError(
    "SUPERPDP_STORAGE",
    "L’opération SuperPDP n’a pas été confirmée. Rechargez l’état de la connexion avant de recommencer.",
    503,
  );
};
export const connectionView = (connection: SuperPdpConnection | null) => ({
  fiscal_entity_id: connection?.fiscal_entity_id ?? null,
  environment: "sandbox" as const,
  ...sandboxAvailability(),
  configured: !!connection?.encrypted_client_secret,
  status:
    connection?.operation_id &&
    connection.operation_expires_at &&
    connection.operation_expires_at < new Date()
      ? "operation_interrupted"
      : (connection?.status ?? "not_configured"),
  revision: connection?.generation ?? 0,
  client_id: connection?.client_id ?? null,
  sandbox_number: connection?.expected_number ?? null,
  remote_company: connection?.remote_company_id
    ? {
        id: connection.remote_company_id,
        number: connection.remote_company_number,
        name: connection.remote_company_name,
      }
    : null,
  verification_status: connection?.verification_status ?? null,
  access_expires_at: connection?.access_expires_at?.toISOString() ?? null,
  last_checked_at: connection?.last_checked_at?.toISOString() ?? null,
  last_error_code: connection?.last_error_code ?? null,
  busy:
    !!connection?.operation_id &&
    !!connection.operation_expires_at &&
    connection.operation_expires_at >= new Date(),
});

export class SuperPdpService {
  constructor(private readonly provider = new SuperPdpProvider()) {}
  private async entity(entityId: string) {
    const entity = await prisma.fiscalEntity.findUnique({
      where: { id: entityId },
    });
    if (!entity)
      throw superPdpError("SUPERPDP_NOT_FOUND", "Entreprise introuvable.", 404);
    return entity;
  }
  private async connection(entityId: string) {
    await this.entity(entityId);
    return prisma.superPdpConnection.findUnique({
      where: {
        organization_id_fiscal_entity_id_environment: {
          organization_id: getOrganizationId(),
          fiscal_entity_id: entityId,
          environment: "sandbox",
        },
      },
    });
  }
  private async required(entityId: string) {
    sandboxConfig();
    const connection = await this.connection(entityId);
    if (
      !connection?.client_id ||
      !connection.encrypted_client_secret ||
      !connection.expected_number
    )
      throw superPdpError(
        "SUPERPDP_NOT_CONFIGURED",
        "Configurez d’abord l’application OAuth de test pour cette entreprise.",
      );
    const entity = await this.entity(entityId);
    if (entity.siren !== connection.local_siren)
      throw superPdpError(
        "SUPERPDP_LOCAL_IDENTITY",
        "L’identité locale a changé. Déconnectez et reconfigurez cette entreprise.",
      );
    return connection;
  }
  async status(entityId: string) {
    return connectionView(await this.connection(entityId));
  }

  async configure(entityId: string, payload: unknown, actor: OAuthActor) {
    sandboxConfig();
    const data = connectionConfigSchema.parse(payload);
    try {
      const saved = await prisma.$transaction(
        async (tx) => {
          const entity = await tx.fiscalEntity.findUnique({
            where: { id: entityId },
          });
          if (!entity)
            throw superPdpError(
              "SUPERPDP_NOT_FOUND",
              "Entreprise introuvable.",
              404,
            );
          if (!entity.siren)
            throw superPdpError(
              "SUPERPDP_LOCAL_IDENTITY",
              "Renseignez d’abord le SIREN de l’entreprise locale.",
            );
          const old = await tx.superPdpConnection.findUnique({
            where: {
              organization_id_fiscal_entity_id_environment: {
                organization_id: getOrganizationId(),
                fiscal_entity_id: entityId,
                environment: "sandbox",
              },
            },
          });
          if ((old?.generation ?? 0) !== data.revision)
            throw superPdpError(
              "SUPERPDP_CONFLICT",
              "Cette configuration a changé. Rechargez-la avant de l’enregistrer.",
            );
          if (old?.operation_id)
            throw superPdpError(
              "SUPERPDP_BUSY",
              "Une opération est en cours ou interrompue. Vérifiez l’état de la connexion avant de modifier sa configuration.",
            );
          if (
            old?.encrypted_tokens &&
            (old.client_id !== data.client_id ||
              old.expected_number !== data.sandbox_number)
          )
            throw superPdpError(
              "SUPERPDP_DISCONNECT_FIRST",
              "Déconnectez d’abord l’entreprise avant de changer d’application ou d’identité de test.",
            );
          if (
            !data.client_secret &&
            (!old?.encrypted_client_secret || old.client_id !== data.client_id)
          )
            throw superPdpError(
              "SUPERPDP_SECRET_REQUIRED",
              "Le secret OAuth est nécessaire pour cette application.",
              400,
            );
          const context = {
            organization_id: getOrganizationId(),
            fiscal_entity_id: entityId,
            environment: "sandbox",
          };
          const values = {
            client_id: data.client_id,
            encrypted_client_secret: data.client_secret
              ? seal(data.client_secret, context, "client_secret")
              : old!.encrypted_client_secret,
            expected_number: data.sandbox_number,
            local_siren: entity.siren,
            ...(old?.encrypted_tokens
              ? {}
              : {
                  ...clearRemote,
                  status: "configured",
                  last_error_code: null,
                }),
          };
          const result = old
            ? await tx.superPdpConnection.update({
                where: {
                  id: old.id,
                  generation: old.generation,
                  operation_id: null,
                },
                data: { ...values, generation: { increment: 1 } },
              })
            : await tx.superPdpConnection.create({
                data: {
                  ...context,
                  ...values,
                  local_siren: entity.siren,
                  status: "configured",
                },
              });
          await tx.superPdpOAuthState.updateMany({
            where: { connection_id: result.id, consumed_at: null },
            data: { consumed_at: new Date(), encrypted_verifier: null },
          });
          await tx.auditLog.create({
            data: {
              organization_id: getOrganizationId(),
              action: "superpdp.configured",
              resource_type: "fiscal_entity",
              resource_id: entityId,
              user_id: actor.userId,
              metadata_json: JSON.stringify({ environment: "sandbox" }),
            },
          });
          return result;
        },
        { isolationLevel: "Serializable" },
      );
      return connectionView(saved);
    } catch (error) {
      throw safeFailure(error);
    }
  }

  async start(entityId: string, actor: OAuthActor) {
    const { redirectUri } = sandboxConfig();
    const connection = await this.required(entityId);
    if (connection.operation_id)
      throw superPdpError(
        "SUPERPDP_BUSY",
        "Une opération est en cours. Vérifiez l’état de la connexion.",
      );
    if (connection.encrypted_tokens)
      throw superPdpError(
        "SUPERPDP_DISCONNECT_FIRST",
        "Déconnectez d’abord la connexion existante avant de donner un nouveau consentement.",
      );
    const state = oauth.generateRandomState();
    const verifier = oauth.generateRandomCodeVerifier();
    const url = await this.provider.authorizationUrl(
      connection.client_id!,
      redirectUri,
      connection.expected_number!,
      state,
      verifier,
    );
    await prisma.$transaction(
      async (tx) => {
        const updated = await tx.superPdpConnection.updateMany({
          where: {
            id: connection.id,
            generation: connection.generation,
            operation_id: null,
            encrypted_tokens: null,
          },
          data: { status: "authorizing", last_error_code: null },
        });
        if (updated.count !== 1)
          throw superPdpError(
            "SUPERPDP_CONFLICT",
            "La connexion a changé. Rechargez-la.",
          );
        // One pending consent per connection; expired/consumed verifier material is removed.
        await tx.superPdpOAuthState.deleteMany({
          where: {
            OR: [
              { expires_at: { lt: new Date() } },
              { consumed_at: { not: null } },
              { connection_id: connection.id },
            ],
          },
        });
        await tx.superPdpOAuthState.create({
          data: {
            id: digest(state),
            connection_id: connection.id,
            generation: connection.generation,
            user_id: actor.userId,
            session_hash: actor.sessionHash,
            encrypted_verifier: seal(verifier, connection, "pkce"),
            expires_at: new Date(Date.now() + 10 * 60_000),
          },
        });
        await tx.auditLog.create({
          data: {
            organization_id: getOrganizationId(),
            action: "superpdp.authorization_started",
            resource_type: "fiscal_entity",
            resource_id: entityId,
            user_id: actor.userId,
            metadata_json: JSON.stringify({ environment: "sandbox" }),
          },
        });
      },
      { isolationLevel: "Serializable" },
    );
    return { authorization_url: url };
  }

  private async acquire(connection: SuperPdpConnection) {
    if (connection.operation_id) {
      if (
        connection.operation_expires_at &&
        connection.operation_expires_at < new Date()
      ) {
        // Never reuse a refresh token after a crashed/uncertain exchange: it may have rotated.
        await prisma.superPdpConnection.updateMany({
          where: {
            id: connection.id,
            generation: connection.generation,
            operation_id: connection.operation_id,
          },
          data: {
            status: "reauthorization_required",
            last_error_code: "SUPERPDP_INTERRUPTED",
            generation: { increment: 1 },
            operation_id: null,
            operation_expires_at: null,
          },
        });
        throw superPdpError(
          "SUPERPDP_INTERRUPTED",
          "L’opération précédente a été interrompue. Déconnectez puis autorisez de nouveau l’entreprise.",
        );
      }
      throw superPdpError(
        "SUPERPDP_BUSY",
        "Une autre opération SuperPDP est déjà en cours.",
      );
    }
    const operationId = crypto.randomUUID();
    const claimed = await prisma.superPdpConnection.updateMany({
      where: {
        id: connection.id,
        generation: connection.generation,
        operation_id: null,
      },
      data: {
        operation_id: operationId,
        operation_expires_at: new Date(Date.now() + 120_000),
      },
    });
    if (claimed.count !== 1)
      throw superPdpError(
        "SUPERPDP_BUSY",
        "La connexion est utilisée par une autre opération. Rechargez son état.",
      );
    return operationId;
  }
  private secret(connection: SuperPdpConnection) {
    return unseal(
      connection.encrypted_client_secret!,
      connection,
      "client_secret",
    );
  }
  private tokens(connection: SuperPdpConnection) {
    return parseStoredTokens(
      unseal(connection.encrypted_tokens!, connection, "tokens"),
    );
  }
  private whereOperation(connection: SuperPdpConnection, operationId: string) {
    return {
      id: connection.id,
      generation: connection.generation,
      operation_id: operationId,
    };
  }
  private async saveTokens(
    connection: SuperPdpConnection,
    operationId: string,
    tokens: Tokens,
  ) {
    const result = await prisma.superPdpConnection.updateMany({
      where: this.whereOperation(connection, operationId),
      data: {
        encrypted_tokens: seal(JSON.stringify(tokens), connection, "tokens"),
        access_expires_at: new Date(tokens.expires_at),
        status: "verification_pending",
      },
    });
    if (result.count !== 1)
      throw superPdpError(
        "SUPERPDP_CONFLICT",
        "La sauvegarde des jetons n’est pas confirmée. Réautorisez l’entreprise.",
      );
  }
  private async finish(
    connection: SuperPdpConnection,
    operationId: string,
    data: Prisma.SuperPdpConnectionUpdateManyMutationInput,
    actor: OAuthActor,
    action: string,
  ) {
    return prisma.$transaction(
      async (tx) => {
        const result = await tx.superPdpConnection.updateMany({
          where: this.whereOperation(connection, operationId),
          data: {
            ...data,
            generation: { increment: 1 },
            operation_id: null,
            operation_expires_at: null,
          },
        });
        if (result.count !== 1)
          throw superPdpError(
            "SUPERPDP_CONFLICT",
            "La connexion a changé pendant l’opération.",
          );
        await tx.auditLog.create({
          data: {
            organization_id: getOrganizationId(),
            action,
            resource_type: "fiscal_entity",
            resource_id: connection.fiscal_entity_id,
            user_id: actor.userId,
            metadata_json: JSON.stringify({
              environment: "sandbox",
              error_code: data.last_error_code ?? null,
            }),
          },
        });
        return connectionView(
          await tx.superPdpConnection.findUniqueOrThrow({
            where: { id: connection.id },
          }),
        );
      },
      { isolationLevel: "Serializable" },
    );
  }
  private async probe(connection: SuperPdpConnection, tokens: Tokens) {
    const session = await this.provider.session(tokens.access_token);
    if (session.client_id !== connection.client_id)
      throw superPdpError(
        "SUPERPDP_IDENTITY_MISMATCH",
        "L’application OAuth retournée ne correspond pas à la configuration.",
      );
    if (session.company_verification_status !== "verified")
      return {
        status: "verification_pending",
        verification_status: session.company_verification_status,
        last_error_code: null,
        last_checked_at: new Date(),
      };
    const company = await this.provider.company(tokens.access_token);
    if (company.env !== "sandbox")
      throw superPdpError(
        "SUPERPDP_ENVIRONMENT_MISMATCH",
        "Entreprise de production refusée : cette intégration est limitée au bac à sable.",
      );
    if (
      company.number_scheme !== "sandbox" ||
      company.number !== connection.expected_number ||
      (connection.remote_company_id &&
        connection.remote_company_id !== company.id)
    )
      throw superPdpError(
        "SUPERPDP_IDENTITY_MISMATCH",
        "L’entreprise de test retournée ne correspond pas à celle attendue.",
      );
    return {
      status: "connected",
      verification_status: "verified",
      remote_company_id: company.id,
      remote_company_number: company.number,
      remote_company_name: company.formal_name,
      last_checked_at: new Date(),
      last_error_code: null,
    };
  }
  private async failure(
    connection: SuperPdpConnection,
    operationId: string,
    error: unknown,
    actor: OAuthActor,
  ) {
    const current = await prisma.superPdpConnection.findUnique({
      where: { id: connection.id },
    });
    // Respect a committed result if its acknowledgement was lost.
    if (
      current &&
      (current.generation !== connection.generation ||
        current.operation_id !== operationId)
    )
      return connectionView(current);
    const code = safeCode(error);
    if (
      [
        "SUPERPDP_ENVIRONMENT_MISMATCH",
        "SUPERPDP_IDENTITY_MISMATCH",
        "SUPERPDP_DUPLICATE_COMPANY",
      ].includes(code) &&
      current?.encrypted_tokens
    ) {
      try {
        await this.provider.revoke(
          current.client_id!,
          this.secret(current),
          this.tokens(current),
        );
        return await this.finish(
          connection,
          operationId,
          {
            ...clearRemote,
            status: "identity_rejected",
            last_error_code: code,
          },
          actor,
          "superpdp.identity_rejected",
        );
      } catch {
        return this.finish(
          connection,
          operationId,
          { status: "revocation_pending", last_error_code: code },
          actor,
          "superpdp.revocation_pending",
        );
      }
    }
    const unsafeToRefresh = [
      "SUPERPDP_REAUTHORIZATION",
      "SUPERPDP_TOKEN_STORAGE",
      "SUPERPDP_UNAUTHORIZED",
      "SUPERPDP_CONFLICT",
      "SUPERPDP_STORAGE",
    ].includes(code);
    await this.finish(
      connection,
      operationId,
      {
        status: unsafeToRefresh
          ? "reauthorization_required"
          : current?.encrypted_tokens
            ? "verification_pending"
            : "configured",
        last_error_code: code,
      },
      actor,
      "superpdp.operation_failed",
    );
    throw safeFailure(error);
  }
  async callback(parameters: URLSearchParams, actor: OAuthActor) {
    const { redirectUri } = sandboxConfig();
    const state = parameters.get("state");
    if (!state || state.length > 200 || parameters.getAll("state").length !== 1)
      throw superPdpError(
        "SUPERPDP_STATE",
        "Le retour OAuth est invalide ou a expiré.",
        400,
      );
    const pending = await prisma.superPdpOAuthState.findUnique({
      where: { id: digest(state) },
    });
    if (
      !pending ||
      pending.consumed_at ||
      pending.expires_at <= new Date() ||
      pending.user_id !== actor.userId ||
      pending.session_hash !== actor.sessionHash ||
      !pending.encrypted_verifier
    )
      throw superPdpError(
        "SUPERPDP_STATE",
        "Le retour OAuth ne correspond pas à votre session ou a expiré.",
        400,
      );
    const connection = await prisma.superPdpConnection.findUnique({
      where: { id: pending.connection_id },
    });
    if (
      !connection ||
      connection.environment !== "sandbox" ||
      connection.generation !== pending.generation
    )
      throw superPdpError(
        "SUPERPDP_STATE",
        "La configuration OAuth a changé. Recommencez la connexion.",
        400,
      );
    await this.required(connection.fiscal_entity_id);
    const consumed = await prisma.superPdpOAuthState.updateMany({
      where: {
        id: pending.id,
        consumed_at: null,
        expires_at: { gt: new Date() },
      },
      data: { consumed_at: new Date(), encrypted_verifier: null },
    });
    if (consumed.count !== 1)
      throw superPdpError(
        "SUPERPDP_STATE",
        "Ce retour OAuth a déjà été utilisé.",
        400,
      );
    const operationId = await this.acquire(connection);
    try {
      const tokens = await this.provider.exchange(
        connection.client_id!,
        this.secret(connection),
        redirectUri,
        parameters,
        state,
        unseal(pending.encrypted_verifier, connection, "pkce"),
      );
      await this.saveTokens(connection, operationId, tokens);
      return await this.finish(
        connection,
        operationId,
        await this.probe(connection, tokens),
        actor,
        "superpdp.authorization_completed",
      );
    } catch (error) {
      return this.failure(connection, operationId, error, actor);
    }
  }
  async check(entityId: string, actor: OAuthActor) {
    const connection = await this.required(entityId);
    if (
      !connection.operation_id &&
      (!connection.encrypted_tokens ||
        [
          "reauthorization_required",
          "revocation_pending",
          "identity_rejected",
        ].includes(connection.status))
    ) {
      throw superPdpError(
        "SUPERPDP_REAUTHORIZATION",
        "Déconnectez puis autorisez cette entreprise avant de vérifier sa connexion.",
      );
    }
    const operationId = await this.acquire(connection);
    try {
      if (
        !connection.encrypted_tokens ||
        [
          "reauthorization_required",
          "revocation_pending",
          "identity_rejected",
        ].includes(connection.status)
      )
        throw superPdpError(
          "SUPERPDP_REAUTHORIZATION",
          "Déconnectez puis autorisez cette entreprise avant de vérifier sa connexion.",
        );
      let tokens = this.tokens(connection);
      if (tokens.expires_at <= Date.now() + 60_000) {
        tokens = await this.provider.refresh(
          connection.client_id!,
          this.secret(connection),
          tokens.refresh_token,
        );
        // Persist the rotated pair before making any further API call.
        await this.saveTokens(connection, operationId, tokens);
      }
      return await this.finish(
        connection,
        operationId,
        await this.probe(connection, tokens),
        actor,
        "superpdp.connection_checked",
      );
    } catch (error) {
      return this.failure(connection, operationId, error, actor);
    }
  }
  async disconnect(entityId: string, actor: OAuthActor) {
    sandboxConfig();
    const connection = await this.connection(entityId);
    if (!connection) return connectionView(null);
    const operationId = await this.acquire(connection);
    try {
      if (connection.encrypted_tokens)
        await this.provider.revoke(
          connection.client_id!,
          this.secret(connection),
          this.tokens(connection),
        );
      return await this.finish(
        connection,
        operationId,
        {
          ...clearRemote,
          status: "disconnected",
          client_id: null,
          encrypted_client_secret: null,
          expected_number: null,
          last_error_code: null,
        },
        actor,
        "superpdp.disconnected",
      );
    } catch {
      return this.finish(
        connection,
        operationId,
        {
          status: "revocation_pending",
          last_error_code: "SUPERPDP_REVOCATION",
        },
        actor,
        "superpdp.revocation_pending",
      );
    }
  }

  /** Serialize transport and refresh/revocation on the same durable connection lock.
   * Never return a token to a route, a job payload, or a stored result.
   */
  async withSandboxAccess<T>(
    entityId: string,
    expected: { connectionId: string; companyId: string },
    actor: OAuthActor,
    work: (accessToken: string) => Promise<T>,
  ): Promise<T> {
    const connection = await this.required(entityId);
    if (
      connection.id !== expected.connectionId ||
      connection.remote_company_id !== expected.companyId ||
      connection.status !== "connected" ||
      !connection.encrypted_tokens
    ) {
      throw superPdpError(
        "SUPERPDP_CONNECTION_CHANGED",
        "La connexion de test doit être vérifiée et correspondre à celle du document.",
      );
    }
    const operationId = await this.acquire(connection);
    let tokens: Tokens;
    let verified: Awaited<ReturnType<SuperPdpService["probe"]>>;
    try {
      tokens = this.tokens(connection);
      // A transport operation can perform several bounded requests while holding the lease.
      if (tokens.expires_at <= Date.now() + 120_000) {
        tokens = await this.provider.refresh(
          connection.client_id!,
          this.secret(connection),
          tokens.refresh_token,
        );
        await this.saveTokens(connection, operationId, tokens);
      }
      verified = await this.probe(connection, tokens);
      if (verified.status !== "connected")
        throw superPdpError(
          "SUPERPDP_NOT_VERIFIED",
          "La vérification SuperPDP de l’entreprise est en attente.",
        );
    } catch (error) {
      await this.failure(connection, operationId, error, actor);
      throw error;
    }
    try {
      return await work(tokens.access_token);
    } finally {
      // Transport failures must not turn a valid OAuth grant into an authentication failure.
      await this.finish(
        connection,
        operationId,
        verified,
        actor,
        "superpdp.transport_access",
      );
    }
  }
}
