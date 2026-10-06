import prisma from "../db/prisma.js";
import { encodeJsonField, fromJsonString } from "../utils/jsonFields.js";

export const APP_PAGE_IDS = [
  "today", "reservations", "booking_requests", "calendar", "planning_relay",
  "contracts", "invoices", "gites", "professional_expenses", "personal_expenses",
  "statistics", "rates", "settings",
] as const;
export type AppPageId = (typeof APP_PAGE_IDS)[number];
export type AppUserStatus = "owner" | "worker" | "custom";
export type AppUserRole = "owner" | "worker";
export const APP_USER_ROLES = ["owner", "worker"] as const;

export type AppUserStatusPreset = {
  status: AppUserStatus;
  canWrite: boolean;
  canViewAmounts: boolean;
  pageAccess: AppPageId[];
  locked: boolean;
};

export const DEFAULT_STATUS_PRESETS: Record<AppUserStatus, AppUserStatusPreset> = {
  owner: { status: "owner", canWrite: true, canViewAmounts: true, pageAccess: [...APP_PAGE_IDS], locked: true },
  worker: { status: "worker", canWrite: true, canViewAmounts: false, pageAccess: ["today", "calendar", "planning_relay"], locked: false },
  custom: { status: "custom", canWrite: false, canViewAmounts: false, pageAccess: [], locked: false },
};

export const STATUS_PAGE_PRESETS: Record<AppUserStatus, AppPageId[]> = {
  owner: DEFAULT_STATUS_PRESETS.owner.pageAccess,
  worker: DEFAULT_STATUS_PRESETS.worker.pageAccess,
  custom: DEFAULT_STATUS_PRESETS.custom.pageAccess,
};

export const normalizeAppUserStatus = (value: unknown, isOwner = false): AppUserStatus =>
  isOwner || value === "owner" ? "owner" : value === "worker" ? "worker" : "custom";

export const normalizeAppUserRoles = (
  value: unknown,
  legacy?: { status?: unknown; isOwner?: boolean; intervenantId?: string | null },
): AppUserRole[] => {
  if (value !== undefined && value !== null) {
    const raw = fromJsonString<unknown[]>(value, []);
    return APP_USER_ROLES.filter((role) => Array.isArray(raw) && raw.includes(role));
  }
  return APP_USER_ROLES.filter((role) =>
    role === "owner"
      ? Boolean(legacy?.isOwner) || legacy?.status === "owner"
      : Boolean(legacy?.intervenantId) || legacy?.status === "worker",
  );
};

export const normalizePageAccess = (value: unknown, isOwner = false): AppPageId[] => {
  if (isOwner) return [...APP_PAGE_IDS];
  const raw = fromJsonString<unknown[]>(value, []);
  return APP_PAGE_IDS.filter((page) => Array.isArray(raw) && raw.includes(page));
};

export type AppUserPermissions = {
  canWrite: boolean;
  canViewAmounts: boolean;
  isOwner: boolean;
};

export type AppUserSummary = {
  id: string;
  displayName: string;
  firstName: string;
  lastName: string;
  gestionnaireId: string | null;
  intervenantId: string | null;
  roles: AppUserRole[];
  status: AppUserStatus;
  telephone: string | null;
  email: string | null;
  adresse: string | null;
  telegramChatId: string | null;
  hourlyRate: number;
  cleaningCheckRate: number;
  fullCleaningRate: number;
  pageAccess: AppPageId[];
  isActive: boolean;
  permissions: AppUserPermissions;
};

let initializationPromise: Promise<void> | null = null;
let statusPresetInitializationPromise: Promise<void> | null = null;

const formatDisplayName = (manager: { prenom: string; nom: string }) =>
  `${manager.prenom} ${manager.nom}`.trim();

export const serializeStatusPreset = (preset: {
  status: string;
  page_access: unknown;
  can_write: boolean;
  can_view_amounts: boolean;
}): AppUserStatusPreset => {
  const status = normalizeAppUserStatus(preset.status);
  const owner = status === "owner";
  return {
    status,
    canWrite: owner ? true : preset.can_write,
    canViewAmounts: owner ? true : preset.can_view_amounts,
    pageAccess: normalizePageAccess(preset.page_access, owner),
    locked: owner,
  };
};

export const ensureStatusPresetsInitialized = async () => {
  if (!statusPresetInitializationPromise) {
    statusPresetInitializationPromise = (async () => {
      for (const preset of Object.values(DEFAULT_STATUS_PRESETS)) {
        await prisma.appUserStatusPreset.upsert({
          where: { status: preset.status },
          update: preset.status === "owner" ? {
            page_access: encodeJsonField(APP_PAGE_IDS),
            can_write: true,
            can_view_amounts: true,
          } : {},
          create: {
            status: preset.status,
            page_access: encodeJsonField(preset.pageAccess),
            can_write: preset.canWrite,
            can_view_amounts: preset.canViewAmounts,
          },
        });
      }
    })().catch((error) => {
      statusPresetInitializationPromise = null;
      throw error;
    });
  }
  await statusPresetInitializationPromise;
};

export const listStatusPresets = async (): Promise<AppUserStatusPreset[]> => {
  await ensureStatusPresetsInitialized();
  const rows = await prisma.appUserStatusPreset.findMany();
  const byStatus = new Map(rows.map((row) => [normalizeAppUserStatus(row.status), serializeStatusPreset(row)]));
  return (["owner", "worker", "custom"] as AppUserStatus[]).map((status) => byStatus.get(status) ?? DEFAULT_STATUS_PRESETS[status]);
};

export const serializeAppUser = (user: {
  id: string;
  display_name: string;
  first_name: string;
  last_name: string;
  gestionnaire_id: string | null;
  intervenant_id: string | null;
  roles?: unknown;
  status: string;
  telephone?: string | null;
  email?: string | null;
  adresse?: string | null;
  telegram_chat_id?: string | null;
  hourly_rate?: unknown;
  cleaning_check_rate?: unknown;
  full_cleaning_rate?: unknown;
  page_access: unknown;
  can_write: boolean;
  can_view_amounts: boolean;
  is_owner: boolean;
  is_active: boolean;
}): AppUserSummary => {
  const storedFirstName = user.first_name.trim();
  const storedLastName = user.last_name.trim();
  const fallbackParts = user.display_name.trim().split(/\s+/);
  const firstName = storedFirstName || fallbackParts.shift() || user.display_name.trim();
  const lastName = storedFirstName || storedLastName ? storedLastName : fallbackParts.join(" ");
  const roles = normalizeAppUserRoles(user.roles, {
    status: user.status,
    isOwner: user.is_owner,
    intervenantId: user.intervenant_id,
  });
  const owner = roles.includes("owner");
  const status: AppUserStatus = owner ? "owner" : roles.includes("worker") ? "worker" : "custom";
  return {
    id: user.id,
    displayName: [firstName, lastName].filter(Boolean).join(" "),
    firstName,
    lastName,
    gestionnaireId: user.gestionnaire_id,
    intervenantId: user.intervenant_id,
    roles,
    status,
    telephone: user.telephone?.trim() || null,
    email: user.email?.trim() || null,
    adresse: user.adresse?.trim() || null,
    telegramChatId: user.telegram_chat_id?.trim() || null,
    hourlyRate: Number(user.hourly_rate ?? 0),
    cleaningCheckRate: Number(user.cleaning_check_rate ?? 0),
    fullCleaningRate: Number(user.full_cleaning_rate ?? 0),
    pageAccess: normalizePageAccess(user.page_access, owner),
    isActive: user.is_active,
    permissions: {
      canWrite: owner ? true : user.can_write,
      canViewAmounts: owner ? true : user.can_view_amounts,
      isOwner: owner,
    },
  };
};

/**
 * Existing managers are the canonical people already attached to the gites.
 * Turning them into owner users here makes the rollout safe even when an
 * installation skipped the data-copy statement from the migration.
 */
export const ensureAppUsersInitialized = async () => {
  if (!initializationPromise) {
    initializationPromise = (async () => {
      await ensureStatusPresetsInitialized();
      const workerPresetRow = await prisma.appUserStatusPreset.findUnique({ where: { status: "worker" } });
      const workerPreset = workerPresetRow ? serializeStatusPreset(workerPresetRow) : DEFAULT_STATUS_PRESETS.worker;
      const managers = await prisma.gestionnaire.findMany({
        where: { app_user: null },
        orderBy: [{ nom: "asc" }, { prenom: "asc" }],
      });

      for (const manager of managers) {
        await prisma.appUser.upsert({
          where: { gestionnaire_id: manager.id },
          update: {
            display_name: formatDisplayName(manager),
            first_name: manager.prenom,
            last_name: manager.nom,
          },
          create: {
            display_name: formatDisplayName(manager),
            first_name: manager.prenom,
            last_name: manager.nom,
            gestionnaire_id: manager.id,
            roles: encodeJsonField(["owner"]),
            status: "owner",
            page_access: encodeJsonField(APP_PAGE_IDS),
            can_write: true,
            can_view_amounts: true,
            is_owner: true,
            is_active: true,
          },
        });
      }

      const workers = await prisma.planningRelayWorker.findMany({
        where: { app_user: null },
        orderBy: [{ nom: "asc" }],
      });
      for (const worker of workers) {
        const ownerCandidates = await prisma.appUser.findMany({
          where: { is_owner: true, intervenant_id: null },
          select: { id: true, display_name: true },
        });
        const normalizedWorkerName = worker.nom.trim().toLocaleLowerCase("fr");
        const matchingOwners = ownerCandidates.filter((owner) => {
          const ownerName = owner.display_name.trim().toLocaleLowerCase("fr");
          return ownerName === normalizedWorkerName || ownerName.startsWith(`${normalizedWorkerName} `);
        });
        if (matchingOwners.length === 1) {
          const existingOwner = await prisma.appUser.findUnique({ where: { id: matchingOwners[0].id } });
          const roles = normalizeAppUserRoles(existingOwner?.roles, {
            status: existingOwner?.status,
            isOwner: existingOwner?.is_owner,
            intervenantId: existingOwner?.intervenant_id,
          });
          await prisma.appUser.update({
            where: { id: matchingOwners[0].id },
            data: {
              intervenant_id: worker.id,
              roles: encodeJsonField([...new Set([...roles, "worker"])]),
              telephone: worker.telephone,
              email: worker.email,
              adresse: worker.adresse,
              telegram_chat_id: fromJsonString<Record<string, string>>(worker.message_channel_addresses, {}).telegram ?? null,
              hourly_rate: worker.hourly_rate,
            },
          });
          continue;
        }
        await prisma.appUser.create({
          data: {
            display_name: worker.nom,
            first_name: worker.nom,
            last_name: "",
            intervenant_id: worker.id,
            roles: encodeJsonField(["worker"]),
            telephone: worker.telephone,
            email: worker.email,
            adresse: worker.adresse,
            telegram_chat_id: fromJsonString<Record<string, string>>(worker.message_channel_addresses, {}).telegram ?? null,
            hourly_rate: worker.hourly_rate,
            status: "worker",
            page_access: encodeJsonField(workerPreset.pageAccess),
            can_write: workerPreset.canWrite,
            can_view_amounts: workerPreset.canViewAmounts,
            is_owner: false,
            is_active: worker.is_active,
          },
        });
      }
    })().catch((error) => {
      initializationPromise = null;
      throw error;
    });
  }

  await initializationPromise;
};

export const listActiveAppUsers = async () => {
  await ensureAppUsersInitialized();
  const users = await prisma.appUser.findMany({
    where: { is_active: true },
    orderBy: [{ display_name: "asc" }],
  });
  return users.map(serializeAppUser);
};

export const listLoginUsers = async () =>
  (await listActiveAppUsers()).map(({ id, displayName }) => ({ id, displayName }));

export const findActiveAppUser = async (id: string) => {
  await ensureAppUsersInitialized();
  const user = await prisma.appUser.findFirst({
    where: { id, is_active: true },
  });
  return user ? serializeAppUser(user) : null;
};
