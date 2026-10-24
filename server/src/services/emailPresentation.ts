export type EmailBranding = {
  name: string;
  color?: string;
  logoUrl?: string;
  photoUrl?: string;
  photoAlt?: string;
  website?: string;
  signature?: string;
  address?: string;
  phone?: string;
};
export const escapeEmailHtml = (value: unknown) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
export const emailHttpUrl = (value?: string | null, base?: string) => {
  if (!value?.trim()) return "";
  try {
    const url = base ? new URL(value, base) : new URL(value);
    return ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? url.href
      : "";
  } catch {
    return "";
  }
};
const linkify = (value: string) =>
  escapeEmailHtml(value).replace(
    /https?:\/\/[^\s<]+/g,
    (url) =>
      '<a href="' +
      url +
      '" style="color:inherit;text-decoration:underline;">' +
      url +
      "</a>",
  );
export const renderEmailTemplateLine = (
  line: string,
  values: Record<string, string>,
) =>
  line.replace(/{{\s*(\w+)\s*}}/g, (_match, key: string) => values[key] ?? "");
export const renderEmailTemplateBody = (
  lines: string[],
  values: Record<string, string>,
) =>
  lines
    .map((line) =>
      renderEmailTemplateLine(line, values)
        .replace(/[ \t]{2,}/g, " ")
        .trim(),
    )
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

type Highlight = { text: string; title: string; lines: string[] };
export const renderEmailPresentation = ({
  subject,
  text,
  branding,
  label = "Votre séjour",
  facts = [],
  highlights = [],
}: {
  subject: string;
  text: string;
  branding: EmailBranding;
  label?: string;
  facts?: Array<{ label: string; value: string }>;
  highlights?: Highlight[];
}) => {
  const color = /^#[a-f\d]{6}$/i.test(branding.color || "")
    ? branding.color!
    : "#315f4b";
  const logo = emailHttpUrl(branding.logoUrl),
    photo = emailHttpUrl(branding.photoUrl),
    website = emailHttpUrl(branding.website);
  const body = text
    .split(/\n\s*\n/)
    .map((block) => {
      const highlight = highlights.find(
        (item) => item.text.trim() === block.trim(),
      );
      if (highlight)
        return (
          '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f6f0;border:1px solid #dfe6d8;border-radius:12px;margin:0 0 20px;"><tr><td style="padding:18px;"><strong style="color:' +
          color +
          ';font-size:16px;">' +
          escapeEmailHtml(highlight.title) +
          '</strong><p style="margin:10px 0 0;">' +
          highlight.lines.map(linkify).join("<br />") +
          "</p></td></tr></table>"
        );
      return "<p>" + block.split("\n").map(linkify).join("<br />") + "</p>";
    })
    .join("");
  const details = facts
    .filter((fact) => fact.value)
    .map(
      (fact) =>
        '<td class="fact" valign="top" style="padding:8px 12px 8px 0;"><span style="font-size:12px;color:#6e756e;">' +
        escapeEmailHtml(fact.label) +
        '</span><br /><strong style="font-size:14px;">' +
        escapeEmailHtml(fact.value) +
        "</strong></td>",
    )
    .join("");
  return (
    '<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' +
    escapeEmailHtml(subject) +
    '</title><style>body{margin:0}.body p{margin:0 0 18px}@media(max-width:600px){.outer{padding:12px!important}.content{padding:24px 20px!important}.fact{display:block!important;width:100%!important}.hero{height:auto!important}}</style></head><body style="margin:0;background:#f4f2ed;color:#29372e;font-family:Arial,Helvetica,sans-serif;">' +
    '<div style="display:none;max-height:0;overflow:hidden;">' +
    escapeEmailHtml(text.replace(/\s+/g, " ").slice(0, 160)) +
    '</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f2ed;"><tr><td class="outer" align="center" style="padding:32px 16px;"><table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#fff;border:1px solid #e3e3d9;border-radius:16px;overflow:hidden;">' +
    '<tr><td style="padding:24px 28px;border-top:5px solid ' +
    color +
    ';">' +
    (logo
      ? '<img src="' +
        escapeEmailHtml(logo) +
        '" alt="' +
        escapeEmailHtml(branding.name) +
        '" width="160" style="display:block;width:auto;max-width:160px;max-height:100px;border:0;margin-bottom:10px;">'
      : "") +
    '<strong style="font-size:17px;color:' +
    color +
    ';">' +
    escapeEmailHtml(branding.name) +
    "</strong></td></tr>" +
    (photo
      ? '<tr><td><img class="hero" src="' +
        escapeEmailHtml(photo) +
        '" alt="' +
        escapeEmailHtml(branding.photoAlt || branding.name) +
        '" width="600" height="270" style="display:block;border:0;width:100%;height:270px;object-fit:cover;"></td></tr>'
      : "") +
    '<tr><td class="content" style="padding:30px;"><p style="margin:0 0 10px;color:' +
    color +
    ';font-size:12px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;">' +
    escapeEmailHtml(label) +
    '</p><h1 style="font-size:25px;line-height:1.3;margin:0 0 22px;color:#29372e;">' +
    escapeEmailHtml(subject) +
    "</h1>" +
    (details
      ? '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #e3e3d9;border-bottom:1px solid #e3e3d9;margin-bottom:24px;"><tr>' +
        details +
        "</tr></table>"
      : "") +
    '<div class="body" style="font-size:16px;line-height:1.65;">' +
    body +
    "</div>" +
    (branding.signature && !text.includes(branding.signature)
      ? '<div style="font-size:14px;line-height:1.6;margin-top:24px;">' +
        branding.signature.split("\n").map(linkify).join("<br />") +
        "</div>"
      : "") +
    '</td></tr><tr><td style="padding:22px 28px;border-top:1px solid #e3e3d9;color:#697269;font-size:12px;line-height:1.6;">' +
    escapeEmailHtml(branding.name) +
    (branding.address ? "<br />" + escapeEmailHtml(branding.address) : "") +
    (branding.phone ? "<br />" + escapeEmailHtml(branding.phone) : "") +
    (website
      ? '<br /><a href="' +
        escapeEmailHtml(website) +
        '" style="color:' +
        color +
        ';">' +
        escapeEmailHtml(new URL(website).hostname) +
        "</a>"
      : "") +
    "</td></tr></table></td></tr></table></body></html>"
  );
};
