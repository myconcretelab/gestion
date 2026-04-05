import { TuyaContext } from "@tuya/tuya-connector-nodejs";
import type { SmartlifeAutomationConfig, SmartlifeRegion } from "./smartlifeSettings.js";

export type SmartlifeDeviceFunction = {
  code: string;
  name: string;
  desc: string;
  type: string;
  values: string;
  is_primary_switch: boolean;
  unit: string | null;
  scale: number | null;
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
  supports_total_ele: boolean;
  total_ele_scale: number | null;
  total_ele_kwh: number | null;
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
  const values = String(item.values ?? "").trim();
  let unit: string | null = null;
  let scale: number | null = null;
  if (values) {
    try {
      const parsed = JSON.parse(values) as Partial<{
        unit: unknown;
        scale: unknown;
      }>;
      unit =
        typeof parsed.unit === "string" && parsed.unit.trim()
          ? parsed.unit.trim()
          : null;
      scale =
        typeof parsed.scale === "number" && Number.isFinite(parsed.scale)
          ? parsed.scale
          : null;
    } catch {
      unit = null;
      scale = null;
    }
  }
  const isPrimarySwitch =
    /switch|power|plug|relay|outlet|enabled|enable|start/.test(searchable) &&
    normalizedType.includes("bool");

  return {
    code,
    name,
    desc,
    type,
    values,
    is_primary_switch: isPrimarySwitch,
    unit,
    scale,
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

const decodeScaledStatusValue = (
  value: string | boolean | number | null,
  scale: number | null,
) => {
  if (typeof value === "boolean" || value === null) return null;
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value.trim())
        : Number.NaN;
  if (!Number.isFinite(parsed)) return null;
  if (
    scale != null &&
    scale > 0 &&
    ((typeof value === "number" && Number.isInteger(value)) ||
      (typeof value === "string" &&
        value.trim().length > 0 &&
        !value.includes(".")))
  ) {
    return parsed / 10 ** scale;
  }
  return parsed;
};

const buildTotalEleInfo = (
  functions: SmartlifeDeviceFunction[],
  status: SmartlifeDeviceStatusEntry[],
) => {
  const totalEleFunction =
    functions.find((item) => item.code === "total_ele") ?? null;
  const totalEleStatus =
    status.find((item) => item.code === "total_ele") ?? null;
  const totalEleScale = totalEleFunction?.scale ?? null;
  const totalEleKwh = totalEleStatus
    ? decodeScaledStatusValue(totalEleStatus.value, totalEleScale)
    : null;

  return {
    supports_total_ele: Boolean(totalEleFunction || totalEleStatus),
    total_ele_scale: totalEleScale,
    total_ele_kwh: totalEleKwh,
  };
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
      const functionSpec =
        functionsResult.status === "fulfilled" && functionsResult.value.success
          ? functionsResult.value.result
          : null;
      const functionsRaw = Array.isArray(functionSpec?.functions)
        ? functionSpec.functions
        : [];
      const statusSpecRaw = Array.isArray((functionSpec as { status?: unknown[] } | null)?.status)
        ? ((functionSpec as { status?: unknown[] }).status ?? [])
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
      const functions = [...functionsRaw, ...statusSpecRaw]
        .map((item) =>
          normalizeFunction(
            item as Partial<{
              code: string;
              name: string;
              desc: string;
              type: string;
              values: string;
            }>,
          ),
        )
        .filter((item): item is SmartlifeDeviceFunction => item !== null)
        .filter(
          (item, index, list) =>
            list.findIndex((candidate) => candidate.code === item.code) === index,
        );
      const normalizedStatus = statusEntries
        .map((item: Partial<{ code: string; value: string | boolean | number | null }>) =>
          normalizeStatusEntry(item),
        )
        .filter((item): item is SmartlifeDeviceStatusEntry => item !== null);
      const totalEleInfo = buildTotalEleInfo(functions, normalizedStatus);

      return {
        id: device.id,
        name: detail?.name ?? device.name ?? device.id,
        product_name: detail?.product_name ?? null,
        category: detail?.category ?? device.category ?? "",
        online: Boolean(detail?.online ?? device.online),
        functions: functions
          .sort((left, right) => {
            if (left.is_primary_switch !== right.is_primary_switch) {
              return left.is_primary_switch ? -1 : 1;
            }
            return left.code.localeCompare(right.code, "en", {
              sensitivity: "base",
            });
          }),
        status: normalizedStatus,
        supports_total_ele: totalEleInfo.supports_total_ele,
        total_ele_scale: totalEleInfo.total_ele_scale,
        total_ele_kwh: totalEleInfo.total_ele_kwh,
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

export const getSmartlifeDevice = async (
  config: SmartlifeAutomationConfig,
  deviceId: string,
): Promise<SmartlifeDevice> => {
  const context = getContext(config);

  const [detailResult, functionsResult, statusResult] = await Promise.all([
    context.device.detail({ device_id: deviceId }),
    context.deviceFunction.specification({ device_id: deviceId }),
    context.deviceStatus.status({ device_id: deviceId }),
  ]);

  if (!detailResult.success) {
    throw new Error(detailResult.msg || `Appareil Tuya introuvable: ${deviceId}.`);
  }
  if (!functionsResult.success) {
    throw new Error(
      functionsResult.msg ||
        `Impossible de charger la spécification Tuya de ${deviceId}.`,
    );
  }
  if (!statusResult.success) {
    throw new Error(
      statusResult.msg || `Impossible de lire le statut Tuya de ${deviceId}.`,
    );
  }

  const functionsRaw = Array.isArray(functionsResult.result?.functions)
    ? functionsResult.result.functions
    : [];
  const statusSpecRaw = Array.isArray(
    (functionsResult.result as { status?: unknown[] } | null)?.status,
  )
    ? ((functionsResult.result as { status?: unknown[] }).status ?? [])
    : [];
  const functions = [...functionsRaw, ...statusSpecRaw]
    .map((item) =>
      normalizeFunction(
        item as Partial<{
          code: string;
          name: string;
          desc: string;
          type: string;
          values: string;
        }>,
      ),
    )
    .filter((item): item is SmartlifeDeviceFunction => item !== null)
    .filter(
      (item, index, list) =>
        list.findIndex((candidate) => candidate.code === item.code) === index,
    );
  const statusRaw = Array.isArray(statusResult.result)
    ? statusResult.result
    : statusResult.result && typeof statusResult.result === "object"
      ? [statusResult.result]
      : [];
  const status = statusRaw
    .map((item: Partial<{ code: string; value: string | boolean | number | null }>) =>
      normalizeStatusEntry(item),
    )
    .filter((item): item is SmartlifeDeviceStatusEntry => item !== null);
  const totalEleInfo = buildTotalEleInfo(functions, status);

  return {
    id: detailResult.result.id,
    name: detailResult.result.name ?? deviceId,
    product_name: detailResult.result.product_name ?? null,
    category: detailResult.result.category ?? "",
    online: Boolean(detailResult.result.online),
    functions,
    status,
    supports_total_ele: totalEleInfo.supports_total_ele,
    total_ele_scale: totalEleInfo.total_ele_scale,
    total_ele_kwh: totalEleInfo.total_ele_kwh,
  };
};

export const getSmartlifeDeviceTotalElectricityKwh = async (
  config: SmartlifeAutomationConfig,
  deviceId: string,
) => {
  const device = await getSmartlifeDevice(config, deviceId);
  if (!device.supports_total_ele || device.total_ele_kwh == null) {
    throw new Error(
      `L'appareil ${device.name} ne remonte pas de valeur total_ele exploitable.`,
    );
  }
  return {
    device,
    total_kwh: device.total_ele_kwh,
  };
};
