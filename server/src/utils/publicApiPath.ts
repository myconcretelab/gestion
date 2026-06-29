export const isPublicApiPath = (requestPath: string) =>
  /^\/contracts\/[^/]+\/pdf$/i.test(requestPath) ||
  /^\/invoices\/[^/]+\/pdf$/i.test(requestPath) ||
  /^\/public\/planning-relay\/[^/]+$/i.test(requestPath) ||
  /^\/public\/gites(?:\/.*)?$/i.test(requestPath);
