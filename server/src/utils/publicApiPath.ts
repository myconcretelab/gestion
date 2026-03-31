export const isPublicApiPath = (requestPath: string) =>
  /^\/contracts\/[^/]+\/pdf$/i.test(requestPath) || /^\/invoices\/[^/]+\/pdf$/i.test(requestPath);
