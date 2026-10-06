import prisma from "../db/prisma.js";
import type { DocumentEmailTemplateSettings } from "./documentEmailTemplateSettings.js";

export const versionDocumentEmailTemplates = async (settings: DocumentEmailTemplateSettings) => {
  for (const [key, value] of Object.entries(settings)) {
    const content = JSON.stringify(value);
    const latest = await prisma.contentTemplateVersion.findFirst({ where: { template_key: `email.${key}` }, orderBy: { version: "desc" } });
    if (latest?.content === content) continue;
    await prisma.$transaction(async (tx) => {
      await tx.contentTemplateVersion.updateMany({ where: { template_key: `email.${key}` }, data: { is_active: false } });
      await tx.contentTemplateVersion.create({ data: {
        template_key: `email.${key}`,
        version: (latest?.version ?? 0) + 1,
        subject: value.subject,
        content,
        is_active: true,
      } });
    });
  }
};
