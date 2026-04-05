import { TuyaContext } from "@tuya/tuya-connector-nodejs";
import type { SmartlifeAutomationConfig, SmartlifeRegion } from "./smartlifeSettings.js";

export type SmartlifeDeviceFunction = {
  code: string;
  name: string;
  desc: string;
  type: string;
  values: string;
  is_primary_switch: boolean;
};

export type SmartlifeDeviceStatusEntry = {
  code: string;
  value: string | boolean | number | null;
};

export type SmartlifeDevice = {
  id: string;
  name: string;
  product_name: string | null;
  category: string;
  online: boolean;
  functions: SmartlifeDeviceFunction[];
  status: SmartlifeDeviceStatusEntry[];
};

const REGION_BASE_URLS: Record<SmartlifeRegion, string> = {
  eu: "https://openapi.tuyaeu.com",
  "eu-west": "https://openapi-weaz.tuyaeu.com",
  us: "https://openapi.tuyaus.com",
  "us-e": "https://openapi-ueaz.tuyaus.com",
  in: "https://openapi.tuyain.com",
  cn: "https://openapi.tuyacn.com",
};

let cachedContextKey = "";
let cachedContext: TuyaContext | null = null;

const buildContextKey = (config: SmartlifeAutomationConfig) =>
  [
    config.region,
    config.access_id.trim(),
    config.access_secret.trim(),
  ].join("|");

const getBaseUrl = (region: SmartlifeRegion) => REGION_BASE_URLS[region];

const getContext = (config: SmartlifeAutomationConfig) => {
  const accessId = config.access_id.trim();
  const accessSecret = config.access_secret.trim();

  if (!accessId || !accessSecret) {
    throw new Error(
      "Renseignez l'Access ID et l'Access Secret Tuya/Smart Life.",
    );
  }

  const contextKey = buildContextKey(config);
  if (cachedContext && cachedContextKey === contextKey) {
    return cachedContext;
  }

  cachedContext = new TuyaContext({
    baseUrl: getBaseUrl(config.region),
    accessKey: accessId,
    secretKey: accessSecret,
  });
  cachedContextKey = contextKey;
  return cachedContext;
};

const normalizeFunction = (
  item: Partial<{
    code: string;
    name: string;
    desc: string;
    type: string;
    values: string;
  }>,
): SmartlifeDeviceFunction | null => {
  const code = String(item.code ?? "").trim();
  if (!code) return null;

  const type = String(item.type ?? "").trim();
  const name = String(item.name ?? "").trim();
  const desc = String(item.desc ?? "").trim();
  const searchable = `${code} ${name} ${desc}`.toLowerCase();
  const normalizedType = type.toLowerCase();
  const isPrimarySwitch =
    /switch|power|plug|relay|outlet|enabled|enable|start/.test(searchable) &&
    normalizedType.includes("bool");

  return {
    code,
    name,
    desc,
    type,
    values: String(item.values ?? "").trim(),
    is_primary_switch: isPrimarySwitch,
  };
};

const normalizeStatusEntry = (
  item: Partial<{ code: string; value: string | boolean | number | null }>,
): SmartlifeDeviceStatusEntry | null => {
  const code = String(item.code ?? "").trim();
  if (!code) return null;

  const value = item.value;
  if (
    typeof value === "string" ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    value === null
  ) {
    return { code, value };
  }

  return { code, value: String(value ?? "") };
};

export const listSmartlifeDevices = async (
  config: SmartlifeAutomationConfig,
): Promise<SmartlifeDevice[]> => {
  const context = getContext(config);
  const response = await context.request<{
    last_row_key?: string;
    has_more?: boolean;
    total?: number;
    devices?: Array<{
      id: string;
      name?: string;
      product_name?: string;
      category?: string;
      online?: boolean;
    }>;
  }>({
    path: "/v1.0/iot-01/associated-users/devices",
    method: "GET",
    query: {
      size: 100,
    },
  });
  if (!response.success) {
    throw new Error(response.msg || "Impossible de lister les appareils Tuya.");
  }

  const devices = await Promise.all(
    (response.result?.devices ?? []).map(async (device) => {
      const detailPromise = context.device.detail({ device_id: device.id });
      const functionsPromise = context.deviceFunction.specification({
        device_id: device.id,
      });
      const statusPromise = context.deviceStatus.status({
        device_id: device.id,
      });

      const [detailResult, functionsResult, statusResult] =
        await Promise.allSettled([
          detailPromise,
          functionsPromise,
          statusPromise,
        ]);

      const detail =
        detailResult.status === "fulfilled" && detailResult.value.success
          ? detailResult.value.result
          : null;
      const functions =
        functionsResult.status === "fulfilled" && functionsResult.value.success
          ? functionsResult.value.result.functions
          : [];
      const statusRaw =
        statusResult.status === "fulfilled" && statusResult.value.success
          ? statusResult.value.result
          : [];
      const statusEntries = Array.isArray(statusRaw)
        ? statusRaw
        : statusRaw && typeof statusRaw === "object"
          ? [statusRaw]
          : [];

      return {
        id: device.id,
        name: detail?.name ?? device.name ?? device.id,
        product_name: detail?.product_name ?? null,
        category: detail?.category ?? device.category ?? "",
        online: Boolean(detail?.online ?? device.online),
        functions: functions
          .map((item) => normalizeFunction(item))
          .filter((item): item is SmartlifeDeviceFunction => item !== null)
          .sort((left, right) => {
            if (left.is_primary_switch !== right.is_primary_switch) {
              return left.is_primary_switch ? -1 : 1;
            }
            return left.code.localeCompare(right.code, "en", {
              sensitivity: "base",
            });
          }),
        status: statusEntries
          .map((item: Partial<{ code: string; value: string | boolean | number | null }>) =>
            normalizeStatusEntry(item),
          )
          .filter((item): item is SmartlifeDeviceStatusEntry => item !== null),
      } satisfies SmartlifeDevice;
    }),
  );

  return devices.sort((left, right) =>
    left.name.localeCompare(right.name, "fr", { sensitivity: "base" }),
  );
};

export const sendSmartlifeCommand = async (
  config: SmartlifeAutomationConfig,
  input: {
    device_id: string;
    command_code: string;
    command_value: boolean;
  },
) => {
  const context = getContext(config);
  const response = await context.request<boolean>({
    path: `/v1.0/iot-03/devices/${input.device_id}/commands`,
    method: "POST",
    body: {
      commands: [
        {
          code: input.command_code,
          value: input.command_value,
        },
      ],
    },
  });

  if (!response.success) {
    throw new Error(
      response.msg ||
        `Commande Tuya refusée pour ${input.device_id}/${input.command_code}.`,
    );
  }

  return response;
};
