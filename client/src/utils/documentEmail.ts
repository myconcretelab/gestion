type BuildMailtoHrefParams = {
  recipient?: string | null;
  subject: string;
  body?: string;
};

export const buildMailtoHref = ({ recipient, subject, body }: BuildMailtoHrefParams) => {
  const to = String(recipient ?? "").trim();
  if (!to) return null;

  const params = new URLSearchParams();
  const trimmedSubject = subject.trim();
  const trimmedBody = String(body ?? "").trim();

  if (trimmedSubject) params.set("subject", trimmedSubject);
  if (trimmedBody) params.set("body", trimmedBody);

  const query = params.toString();
  return `mailto:${encodeURIComponent(to)}${query ? `?${query}` : ""}`;
};
