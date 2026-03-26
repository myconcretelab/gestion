type BuildMailtoHrefParams = {
  recipient?: string | null;
  subject: string;
  body?: string;
};

type BuildDocumentMailtoHrefParams = {
  recipient?: string | null;
  documentType: "contrat" | "facture";
  documentNumber: string;
  documentUrl: string;
  locataireNom: string;
  giteNom?: string | null;
};

export const buildMailtoHref = ({ recipient, subject, body }: BuildMailtoHrefParams) => {
  const to = String(recipient ?? "").trim();
  if (!to) return null;

  const trimmedSubject = subject.trim();
  const trimmedBody = String(body ?? "").trim();
  const queryParts: string[] = [];

  if (trimmedSubject) queryParts.push(`subject=${encodeURIComponent(trimmedSubject)}`);
  if (trimmedBody) queryParts.push(`body=${encodeURIComponent(trimmedBody)}`);

  const query = queryParts.join("&");
  return `mailto:${encodeURIComponent(to)}${query ? `?${query}` : ""}`;
};

export const buildDocumentMailtoHref = ({
  recipient,
  documentType,
  documentNumber,
  documentUrl,
  locataireNom,
  giteNom,
}: BuildDocumentMailtoHrefParams) => {
  const safeDocumentNumber = documentNumber.trim();
  const safeGiteNom = String(giteNom ?? "").trim();
  const safeLocataireNom = locataireNom.trim();
  const subjectPrefix = documentType === "contrat" ? "Contrat" : "Facture";
  const subject = [subjectPrefix, safeGiteNom, safeDocumentNumber].filter(Boolean).join(" ");
  const documentLabel = documentType === "contrat" ? "contrat" : "facture";
  const staySentence =
    documentType === "contrat"
      ? "En espérant avoir le plaisir de vous accueillir prochainement"
      : "En espérant que vous avez passé un agréable séjour";
  const locationSuffix = safeGiteNom ? ` au ${safeGiteNom}.` : ".";
  const greeting = safeLocataireNom ? `Bonjour ${safeLocataireNom},` : "Bonjour,";
  const body = [
    greeting,
    "",
    documentType === "contrat"
      ? `Je vous joins un lien de téléchargement vers votre ${documentLabel} de location.`
      : `Je vous joins un lien de téléchargement vers votre ${documentLabel}.`,
    `${staySentence}${locationSuffix}`,
    "",
    "Le lien de téléchargement :",
    documentUrl.trim(),
    "",
    "A bientôt,",
    "",
    "Sébastien et Soazig",
    "Les Gites de Brocéliande",
  ].join("\n");

  return buildMailtoHref({ recipient, subject, body });
};
