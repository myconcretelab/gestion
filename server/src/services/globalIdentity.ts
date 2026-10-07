import { systemPrisma } from "../db/prisma.js";

export const provisionGlobalIdentityForProfile = async (profileId: string) => {
  const profile = await systemPrisma.appUser.findUnique({ where: { id: profileId } });
  if (!profile) throw new Error("Profil utilisateur introuvable.");
  const globalUserId = profile.user_id ?? profile.id;
  const loginId = profile.login_id?.trim() || `legacy:${globalUserId}`;
  await systemPrisma.$transaction(async (tx) => {
    await tx.user.upsert({
      where: { id: globalUserId },
      update: {
        login_id: loginId,
        password_hash: profile.password_hash,
        password_salt: profile.password_salt,
        password_updated_at: profile.password_updated_at,
        auth_version: profile.auth_version,
      },
      create: {
        id: globalUserId,
        login_id: loginId,
        email: profile.login_id ? profile.email?.trim().toLowerCase() || null : null,
        password_hash: profile.password_hash,
        password_salt: profile.password_salt,
        password_updated_at: profile.password_updated_at,
        auth_version: profile.auth_version,
      },
    });
    await tx.membership.upsert({
      where: { user_id_organization_id: { user_id: globalUserId, organization_id: profile.organization_id } },
      update: {
        role: profile.is_owner ? "owner" : profile.status,
        status: profile.is_active ? "active" : "disabled",
        permissions: JSON.stringify({
          roles: profile.roles, pageAccess: profile.page_access,
          canWrite: profile.can_write, canViewAmounts: profile.can_view_amounts,
        }),
        accepted_at: profile.createdAt,
      },
      create: {
        id: `membership_${profile.organization_id}_${globalUserId}`,
        user_id: globalUserId,
        organization_id: profile.organization_id,
        role: profile.is_owner ? "owner" : profile.status,
        status: profile.is_active ? "active" : "disabled",
        permissions: JSON.stringify({
          roles: profile.roles, pageAccess: profile.page_access,
          canWrite: profile.can_write, canViewAmounts: profile.can_view_amounts,
        }),
        accepted_at: profile.createdAt,
      },
    });
    if (!profile.user_id) await tx.appUser.update({ where: { id: profile.id }, data: { user_id: globalUserId } });
  });
  return globalUserId;
};
