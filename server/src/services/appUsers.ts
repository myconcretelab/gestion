import prisma from "../db/prisma.js";

export type AppUserPermissions = {
  canWrite: boolean;
  canViewAmounts: boolean;
  isOwner: boolean;
};

export type AppUserSummary = {
  id: string;
  displayName: string;
  gestionnaireId: string | null;
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
  can_write: boolean;
  can_view_amounts: boolean;
  is_owner: boolean;
  is_active: boolean;
}): AppUserSummary => ({
  id: user.id,
  displayName: user.display_name,
  gestionnaireId: user.gestionnaire_id,
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
            can_write: true,
            can_view_amounts: true,
            is_owner: true,
            is_active: true,
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
