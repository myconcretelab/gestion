import * as oauth from "oauth4webapi";
import { z } from "zod";
import { superPdpError } from "./secrets.js";

export const PROVIDER_ORIGIN = "https://api.superpdp.tech";
const server: oauth.AuthorizationServer = {
  issuer: PROVIDER_ORIGIN,
  authorization_endpoint: `${PROVIDER_ORIGIN}/oauth2/authorize`,
  token_endpoint: `${PROVIDER_ORIGIN}/oauth2/token`,
  revocation_endpoint: `${PROVIDER_ORIGIN}/oauth2/revoke`,
};
export type Tokens = {
  access_token: string;
  refresh_token: string;
  expires_at: number;
};
const tokensSchema = z.object({
  access_token: z.string().min(1).max(32_000),
  refresh_token: z.string().min(1).max(32_000),
  expires_at: z.number().finite().positive(),
});
export const parseStoredTokens = (value: string): Tokens => {
  try {
    return tokensSchema.parse(JSON.parse(value));
  } catch {
    throw superPdpError(
      "SUPERPDP_TOKEN_STORAGE",
      "La connexion doit être réautorisée.",
    );
  }
};
const idSchema = z.union([
  z.string().regex(/^[1-9]\d{0,18}$/),
  z.number().int().positive().refine(Number.isSafeInteger).transform(String),
]);
const companySchema = z.object({
  id: idSchema,
  env: z.enum(["sandbox", "production"]),
  number_scheme: z.string().max(100),
  number: z.string().min(1).max(250),
  formal_name: z.string().min(1).max(500),
});
const sessionSchema = z.object({
  client_id: z.string(),
  company_verification_status: z.enum(["verified", "not_verified", "failed"]),
  user_identity_verification_status: z.string().optional(),
});
export type RemoteCompany = z.infer<typeof companySchema>;

// Only fixed HTTPS provider endpoints. A test fetch can be injected without accepting arbitrary URLs.
export class SuperPdpProvider {
  constructor(private readonly fetcher: typeof fetch = fetch) {}
  private request = async (
    input: Parameters<typeof fetch>[0],
    init?: RequestInit,
  ) => {
    if (new URL(String(input)).origin !== PROVIDER_ORIGIN)
      throw superPdpError("SUPERPDP_ENDPOINT", "Adresse SuperPDP refusée.");
    try {
      const response = await this.fetcher(input, {
        ...init,
        redirect: "error",
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      });
      // Bound both JSON bodies and OAuth responses; never keep arbitrary remote error bodies.
      const reader = response.body?.getReader();
      let size = 0;
      const chunks: Uint8Array[] = [];
      if (reader) {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.length;
          if (size > 128 * 1024) {
            await reader.cancel();
            throw new Error();
          }
          chunks.push(part.value);
        }
      }
      return new Response(size ? Buffer.concat(chunks) : null, {
        status: response.status,
        headers: response.headers,
      });
    } catch {
      throw superPdpError(
        "SUPERPDP_NETWORK",
        "SuperPDP est indisponible. Réessayez après avoir vérifié l’état de la connexion.",
        502,
      );
    }
  };
  private options() {
    return { [oauth.customFetch]: this.request };
  }
  private client(clientId: string): oauth.Client {
    return {
      client_id: clientId,
      token_endpoint_auth_method: "client_secret_basic",
    };
  }
  private normalizeTokens(
    result: oauth.TokenEndpointResponse,
    previousRefresh?: string,
  ): Tokens {
    if (
      result.token_type.toLowerCase() !== "bearer" ||
      !result.refresh_token ||
      result.refresh_token === previousRefresh ||
      !result.expires_in ||
      !Number.isFinite(result.expires_in) ||
      result.expires_in <= 0 ||
      result.expires_in > 365 * 86400
    ) {
      throw superPdpError(
        "SUPERPDP_TOKEN_RESPONSE",
        "Réponse OAuth inexploitable ou rotation du jeton absente. Une nouvelle autorisation est nécessaire.",
        502,
      );
    }
    return tokensSchema.parse({
      access_token: result.access_token,
      refresh_token: result.refresh_token,
      expires_at: Date.now() + result.expires_in * 1000,
    });
  }
  async authorizationUrl(
    clientId: string,
    redirectUri: string,
    expectedNumber: string,
    state: string,
    verifier: string,
  ) {
    const url = new URL(server.authorization_endpoint!);
    url.search = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      state,
      code_challenge: await oauth.calculatePKCECodeChallenge(verifier),
      code_challenge_method: "S256",
      superpdp_company_number: expectedNumber,
      superpdp_company_number_scheme: "sandbox",
      superpdp_send_and_receive: "send",
    }).toString();
    // No scopes, and no automatic registration in a reception directory in this phase.
    return url.href;
  }
  async exchange(
    clientId: string,
    secret: string,
    redirectUri: string,
    parameters: URLSearchParams,
    state: string,
    verifier: string,
  ) {
    try {
      const client = this.client(clientId);
      const checked = oauth.validateAuthResponse(
        server,
        client,
        parameters,
        state,
      );
      const response = await oauth.authorizationCodeGrantRequest(
        server,
        client,
        oauth.ClientSecretBasic(secret),
        checked,
        redirectUri,
        verifier,
        this.options(),
      );
      return this.normalizeTokens(
        await oauth.processAuthorizationCodeResponse(server, client, response),
      );
    } catch {
      // Library exceptions can include token/code response bodies: do not propagate or log them.
      throw superPdpError(
        "SUPERPDP_AUTHORIZATION",
        "L’autorisation SuperPDP a échoué ou a été refusée. Recommencez la connexion.",
        502,
      );
    }
  }
  async refresh(clientId: string, secret: string, refreshToken: string) {
    try {
      const client = this.client(clientId);
      const response = await oauth.refreshTokenGrantRequest(
        server,
        client,
        oauth.ClientSecretBasic(secret),
        refreshToken,
        this.options(),
      );
      return this.normalizeTokens(
        await oauth.processRefreshTokenResponse(server, client, response),
        refreshToken,
      );
    } catch {
      throw superPdpError(
        "SUPERPDP_REAUTHORIZATION",
        "Le renouvellement n’est pas confirmé. Déconnectez puis autorisez de nouveau cette entreprise.",
      );
    }
  }
  private async read(
    path: "/v1.beta/companies/me" | "/v1.beta/oauth2_sessions/me",
    accessToken: string,
  ) {
    const response = await this.request(`${PROVIDER_ORIGIN}${path}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    });
    if (!response.ok)
      throw superPdpError(
        response.status === 401 ? "SUPERPDP_UNAUTHORIZED" : "SUPERPDP_REMOTE",
        response.status === 401
          ? "L’accès SuperPDP a expiré ou a été révoqué."
          : "La vérification de l’entreprise SuperPDP est temporairement indisponible.",
        502,
      );
    try {
      // JSON.parse's source context (Node >=22.12) preserves bigint ids without Number rounding.
      return JSON.parse(
        await response.text(),
        (name, value, context?: { source?: string }) => {
          if (name === "id" && typeof value === "number") {
            if (Number.isSafeInteger(value)) return String(value);
            if (context?.source && /^[1-9]\d{0,18}$/.test(context.source))
              return context.source;
            throw new Error();
          }
          return value;
        },
      );
    } catch {
      throw superPdpError(
        "SUPERPDP_RESPONSE",
        "La réponse d’identité SuperPDP est invalide.",
        502,
      );
    }
  }
  async session(accessToken: string) {
    const result = sessionSchema.safeParse(
      await this.read("/v1.beta/oauth2_sessions/me", accessToken),
    );
    if (!result.success)
      throw superPdpError(
        "SUPERPDP_RESPONSE",
        "La réponse de session SuperPDP est invalide.",
        502,
      );
    return result.data;
  }
  async company(accessToken: string) {
    const result = companySchema.safeParse(
      await this.read("/v1.beta/companies/me", accessToken),
    );
    if (!result.success)
      throw superPdpError(
        "SUPERPDP_RESPONSE",
        "La réponse d’entreprise SuperPDP est invalide.",
        502,
      );
    return result.data;
  }
  async revoke(clientId: string, secret: string, tokens: Tokens) {
    try {
      const response = await oauth.revocationRequest(
        server,
        this.client(clientId),
        oauth.ClientSecretBasic(secret),
        tokens.refresh_token,
        {
          ...this.options(),
          additionalParameters: { token_type_hint: "refresh_token" },
        },
      );
      await oauth.processRevocationResponse(response);
    } catch {
      throw superPdpError(
        "SUPERPDP_REVOCATION",
        "La révocation SuperPDP n’est pas confirmée. La connexion est bloquée ; réessayez la déconnexion.",
        502,
      );
    }
  }
}
