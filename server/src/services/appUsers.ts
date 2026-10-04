import prisma from "../db/prisma.js";
import { encodeJsonField, fromJsonString } from "../utils/jsonFields.js";

export const APP_PAGE_IDS = [
  "today", "reservations", "booking_requests", "calendar", "planning_relay",
  "contracts", "invoices", "gites", "professional_expenses", "personal_expenses",
  "statistics", "rates", "settings",
] as const;
export type AppPageId = (typeof APP_PAGE_IDS)[number];
export type AppUserStatus = "owner" | "worker" | "custom";

export const STATUS_PAGE_PRESETS: Record<AppUserStatus, AppPageId[]> = {
  owner: [...APP_PAGE_IDS],
  worker: ["today", "calendar", "planning_relay"],
  custom: [],
};

export const normalizeAppUserStatus = (value: unknown, isOwner = false): AppUserStatus =>
  isOwner || value === "owner" ? "owner" : value === "worker" ? "worker" : "custom";

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
  gestionnaireId: string | null;
  intervenantId: string | null;
  status: AppUserStatus;
  pageAccess: AppPageId[];
  isActive: boolean;
  permissions: AppUserPermissions;
};

let initializationPromise: Promise<void> | null = null;

const formatDisplayName = (manager: { prenom: string; nom: string }) =>
  `${manager.prenom} ${manager.nom}`.trim();

export const serializeAppUser = (user: {
  id: string;
  display_name: string;
  gestionnaire_id: string | null;
  intervenant_id: string | null;
  status: string;
  page_access: unknown;
  can_write: boolean;
  can_view_amounts: boolean;
  is_owner: boolean;
  is_active: boolean;
}): AppUserSummary => ({
  id: user.id,
  displayName: user.display_name,
  gestionnaireId: user.gestionnaire_id,
  intervenantId: user.intervenant_id,
  status: normalizeAppUserStatus(user.status, user.is_owner),
  pageAccess: normalizePageAccess(user.page_access, user.is_owner),
  isActive: user.is_active,
  permissions: {
    canWrite: user.can_write,
    canViewAmounts: user.can_view_amounts,
    isOwner: user.is_owner,
  },
});

/**
 * Existing managers are the canonical people already attached to the gites.
 * Turning them into owner users here makes the rollout safe even when an
 * installation skipped the data-copy statement from the migration.
 */
export const ensureAppUsersInitialized = async () => {
  if (!initializationPromise) {
    initializationPromise = (async () => {
      const managers = await prisma.gestionnaire.findMany({
        where: { app_user: null },
        orderBy: [{ nom: "asc" }, { prenom: "asc" }],
      });

      for (const manager of managers) {
        await prisma.appUser.upsert({
          where: { gestionnaire_id: manager.id },
          update: {},
          create: {
            display_name: formatDisplayName(manager),
            gestionnaire_id: manager.id,
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
        await prisma.appUser.create({
          data: {
            display_name: worker.nom,
            intervenant_id: worker.id,
            status: "worker",
            page_access: encodeJsonField(STATUS_PAGE_PRESETS.worker),
            can_write: true,
            can_view_amounts: false,
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
