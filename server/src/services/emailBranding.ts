import prisma from "../db/prisma.js";
import { getOrganizationId } from "./organizationContext.js";
import { env } from "../config/env.js";
import { getInstallationConfig } from "./installationConfig.js";
import { emailHttpUrl, type EmailBranding } from "./emailPresentation.js";

export type EmailGite = {
  id?: string;
  nom?: string | null;
  nom_avec_preposition?: string | null;
  email?: string | null;
  adresse_ligne1?: string | null;
  adresse_ligne2?: string | null;
  telephones?: unknown;
  site_web?: string | null;
};
export const resolveEmailPresentation = async (gite?: EmailGite | null) => {
  const [installation, loaded] = await Promise.allSettled([
    getInstallationConfig(),
    gite?.id
      ? prisma.gite.findUnique({
          where: { id: gite.id },
          select: {
            id: true,
            nom: true,
            nom_avec_preposition: true,
            email: true,
            adresse_ligne1: true,
            adresse_ligne2: true,
            telephones: true,
            site_web: true,
            photos: {
              where: { is_public: true, organization_id: getOrganizationId() },
              orderBy: [
                { is_primary: "desc" },
                { ordre: "asc" },
                { id: "asc" },
              ],
              take: 1,
              select: { id: true, url: true, alt: true },
            },
          },
        })
      : Promise.resolve(null),
  ]);
  const config =
    installation.status === "fulfilled"
      ? installation.value.organization
      : null;
  const house =
    loaded.status === "fulfilled" && loaded.value ? loaded.value : gite;
  const photo = loaded.status === "fulfilled" ? loaded.value?.photos?.[0] : null;
  const branding: EmailBranding = {
    name:
      config?.publicDisplayName ||
      config?.tradeName ||
      house?.nom ||
      "Votre séjour",
    color: config?.primaryColor,
    logoUrl: emailHttpUrl(config?.logoUrl, env.APP_PUBLIC_URL),
    // Uploaded files use an authenticated management URL in storage. Email
    // recipients need the existing public route for this public photo instead.
    photoUrl: emailHttpUrl(
      photo?.url.startsWith("/api/")
        ? `/api/public/gites/photos/${encodeURIComponent(photo.id)}`
        : photo?.url,
      env.APP_PUBLIC_URL,
    ),
    photoAlt: photo?.alt || house?.nom || "",
    website: emailHttpUrl(house?.site_web || config?.website),
    signature: config?.emailSignature,
    address: [house?.adresse_ligne1, house?.adresse_ligne2]
      .filter(Boolean)
      .join(", "),
    phone: config?.phone,
  };
  return { branding, gite: house || gite };
};
export const organizationEmailVariables = (branding?: EmailBranding) => ({
  organizationName: branding?.name || "",
  organizationWebsite: branding?.website || "",
  organizationPhone: branding?.phone || "",
  organizationSignature: branding?.signature || "",
});
