import axiosModule from "axios";
import { createHash, createHmac } from "node:crypto";
import qs from "qs";

type TuyaTokenPayload = {
  access_token?: string;
  refresh_token?: string;
};

type TuyaApiEnvelope<T> = {
  success: boolean;
  code?: string | number;
  msg?: string;
  result: T;
};

type TuyaDeviceDetailResult = {
  id: string;
  name?: string;
  product_name?: string;
  category?: string;
  online?: boolean;
};

type TuyaDeviceSpecificationResult = {
  functions?: unknown[];
  status?: unknown[];
};

type TuyaDeviceStatusResult = unknown;

type TuyaRequestOptions = {
  path: string;
  method: "GET" | "POST" | "PUT" | "DELETE";
  query?: Record<string, unknown>;
  body?: unknown;
  headers?: Record<string, string>;
  retry?: boolean;
};

class MemoryStore {
  private tokens?: TuyaTokenPayload;

  async setTokens(tokens: TuyaTokenPayload) {
    this.tokens = tokens;
    return true;
  }

  async getAccessToken() {
    return this.tokens?.access_token;
  }

  async getRefreshToken() {
    return this.tokens?.refresh_token;
  }
}

const axiosClient = axiosModule as unknown as {
  request<T>(config: unknown): Promise<{ data: T }>;
};

type TuyaClientOptions = {
  baseUrl: string;
  accessKey: string;
  secretKey: string;
};

class TuyaOpenApiClient {
  private readonly baseUrl: string;
  private readonly accessKey: string;
  private readonly secretKey: string;
  private readonly store = new MemoryStore();

  constructor(options: TuyaClientOptions) {
    this.baseUrl = options.baseUrl;
    this.accessKey = options.accessKey;
    this.secretKey = options.secretKey;
  }

  async init(): Promise<TuyaApiEnvelope<TuyaTokenPayload>> {
    const t = Date.now().toString();
    const headers = await this.getHeaderV2(t, true, {}, {});
    const response = await axiosClient.request<TuyaApiEnvelope<TuyaTokenPayload>>({
      url: `${this.baseUrl}/v1.0/token?grant_type=1`,
      method: "GET",
      headers,
    });
    const data = response.data;

    if (!data.success) {
      throw new Error(`GET_TOKEN_FAILED ${data.code ?? "UNKNOWN"}, ${data.msg ?? "Unknown error"}`);
    }

    await this.store.setTokens(data.result);
    return data;
  }

  async request<T>({
    path,
    method,
    query = {},
    body = {},
    headers = {},
    retry = true,
  }: TuyaRequestOptions): Promise<{ data: TuyaApiEnvelope<T> }> {
    const t = Date.now().toString();
    const reqHeaders = {
      ...(await this.getHeaderV2(t, false, headers, body)),
      ...(await this.getSignHeaders(path, method, query, body)),
      ...headers,
    };
    const signedPath = String(reqHeaders.path ?? path);
    delete (reqHeaders as Record<string, string | undefined>).path;

    const response = await axiosClient.request<TuyaApiEnvelope<T>>({
      url: `${this.baseUrl}${signedPath}`,
      method,
      params: {},
      data: body,
      headers: reqHeaders,
    });

    if (retry && !response.data.success && response.data.code === 1010) {
      await this.init();
      return this.request<T>({ path, method, query, body, headers, retry: false });
    }

    return response;
  }

  private async getSignHeaders(
    path: string,
    method: string,
    query: Record<string, unknown>,
    body: unknown,
  ) {
    const t = Date.now().toString();
    const [uri, pathQuery] = path.split("?");
    const queryMerged = Object.assign(query, qs.parse(pathQuery ?? ""));
    const sortedQuery: Record<string, unknown> = {};
    Object.keys(queryMerged)
      .sort()
      .forEach((key) => {
        sortedQuery[key] = query[key];
      });
    const queryString = qs.stringify(sortedQuery);
    const url = queryString ? `${uri}?${queryString}` : uri;
    let accessToken = (await this.store.getAccessToken()) || "";

    if (!accessToken) {
      await this.init();
      accessToken = (await this.store.getAccessToken()) || "";
    }

    const contentHash = createHash("sha256")
      .update(JSON.stringify(body))
      .digest("hex");
    const stringToSign = [method, contentHash, "", decodeURIComponent(url)].join("\n");
    const signStr = `${this.accessKey}${accessToken}${t}${stringToSign}`;

    return {
      t,
      path: url,
      client_id: this.accessKey,
      sign: this.sign(signStr),
      sign_method: "HMAC-SHA256",
      access_token: accessToken,
      Dev_channel: "SaaSFramework",
      Dev_lang: "Nodejs",
    };
  }

  private async getHeaderV2(
    t: string,
    forRefresh = false,
    headers: Record<string, string>,
    body: unknown,
  ) {
    const signPayload = forRefresh
      ? await this.refreshSignV2(t, headers)
      : await this.requestSignV2(t, headers, body);
    const accessToken = await this.store.getAccessToken();

    return {
      t,
      sign: signPayload.sign,
      client_id: this.accessKey,
      sign_method: "HMAC-SHA256",
      access_token: accessToken || "",
      Dev_lang: "Nodejs",
      Dev_channel: "SaaSFramework",
      "Signature-Headers": signPayload.signHeaders,
    };
  }

  private async refreshSignV2(t: string, headers: Record<string, string>) {
    const signUrl = "/v1.0/token?grant_type=1";
    const contentHash = createHash("sha256").update("").digest("hex");
    const signHeaders = Object.keys(headers);
    const signHeaderStr = Object.keys(signHeaders).reduce((previous, current, index) => {
      return `${previous}${current}:${headers[current]}${index === signHeaders.length - 1 ? "" : "\n"}`;
    }, "");
    const stringToSign = ["GET", contentHash, signHeaderStr, signUrl].join("\n");
    const signStr = `${this.accessKey}${t}${stringToSign}`;

    return {
      sign: this.sign(signStr),
      signHeaders: signHeaders.join(":"),
    };
  }

  private async requestSignV2(
    t: string,
    headers: Record<string, string>,
    body: unknown,
  ) {
    let accessToken = await this.store.getAccessToken();

    if (!accessToken) {
      await this.init();
      accessToken = await this.store.getAccessToken();
    }

    const bodyStr = JSON.stringify(body);
    const contentHash = createHash("sha256").update(bodyStr).digest("hex");
    const signHeaders = Object.keys(headers);
    const signHeaderStr = Object.keys(signHeaders).reduce((previous, current, index) => {
      return `${previous}${current}:${headers[current]}${index === signHeaders.length - 1 ? "" : "\n"}`;
    }, "");
    const stringToSign = ["GET", contentHash, signHeaderStr, "/v1.0/token?grant_type=1"].join("\n");
    const signStr = `${this.accessKey}${accessToken ?? ""}${t}${stringToSign}`;

    return {
      sign: this.sign(signStr),
      signHeaders: signHeaders.join(":"),
    };
  }

  private sign(value: string) {
    return createHmac("sha256", this.secretKey)
      .update(value, "utf8")
      .digest("hex")
      .toUpperCase();
  }
}

class TuyaOpenApiDeviceService {
  constructor(private readonly client: TuyaOpenApiClient) {}

  async detail(param: { device_id: string }): Promise<TuyaApiEnvelope<TuyaDeviceDetailResult>> {
    const res = await this.client.request<TuyaDeviceDetailResult>({
      path: `/v1.0/iot-03/devices/${param.device_id}`,
      method: "GET",
    });
    return res.data;
  }
}

class TuyaOpenApiDeviceFunctionService {
  constructor(private readonly client: TuyaOpenApiClient) {}

  async specification(
    param: { device_id: string },
  ): Promise<TuyaApiEnvelope<TuyaDeviceSpecificationResult>> {
    const res = await this.client.request<TuyaDeviceSpecificationResult>({
      path: `/v1.0/iot-03/devices/${param.device_id}/specification`,
      method: "GET",
    });
    return res.data;
  }
}

class TuyaOpenApiDeviceStatusService {
  constructor(private readonly client: TuyaOpenApiClient) {}

  async status(param: { device_id: string }): Promise<TuyaApiEnvelope<TuyaDeviceStatusResult>> {
    const res = await this.client.request<TuyaDeviceStatusResult>({
      path: `/v1.0/iot-03/devices/${param.device_id}/status`,
      method: "GET",
    });
    return res.data;
  }
}

export class TuyaContext {
  readonly client: TuyaOpenApiClient;
  readonly device: TuyaOpenApiDeviceService;
  readonly deviceFunction: TuyaOpenApiDeviceFunctionService;
  readonly deviceStatus: TuyaOpenApiDeviceStatusService;

  constructor(options: TuyaClientOptions) {
    this.client = new TuyaOpenApiClient(options);
    this.device = new TuyaOpenApiDeviceService(this.client);
    this.deviceFunction = new TuyaOpenApiDeviceFunctionService(this.client);
    this.deviceStatus = new TuyaOpenApiDeviceStatusService(this.client);
  }

  async request<T>(options: TuyaRequestOptions): Promise<TuyaApiEnvelope<T>> {
    const res = await this.client.request<T>(options);
    return res.data;
  }
}
