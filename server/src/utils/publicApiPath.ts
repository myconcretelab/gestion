export const isPublicApiPath = (requestPath: string) =>
  /^\/installation\/(?:public-config|setup)$/i.test(requestPath) ||
  /^\/public\/documents\/[A-Za-z0-9_-]+$/i.test(requestPath) ||
  /^\/public\/planning-relay\/[^/]+$/i.test(requestPath) ||
  /^\/public\/cleaning-check\/confirm$/i.test(requestPath) ||
  /^\/public\/gites(?:\/.*)?$/i.test(requestPath);
