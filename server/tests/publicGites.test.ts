import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import prisma from "../src/db/prisma.ts";
import publicGitesRouter from "../src/routes/publicGites.ts";

const getRouteHandler = (router: any, method: "get", routePath: string) => {
  const layer = router.stack.find(
    (item: any) => item.route?.path === routePath && item.route?.methods?.[method]
  );
  assert.ok(layer, `Route introuvable: ${method.toUpperCase()} ${routePath}`);
  return layer.route.stack[0].handle as (req: any, res: any, next: (err?: unknown) => void) => Promise<void>;
};

const createMockResponse = () => ({
  statusCode: 200,
  body: null as unknown,
  sentFile: "",
  headers: new Map<string, string>(),
  status(code: number) {
    this.statusCode = code;
    return this;
  },
  json(payload: unknown) {
    this.body = payload;
    return this;
  },
  redirect(url: string) {
    this.sentFile = url;
    return this;
  },
  setHeader(name: string, value: string) {
    this.headers.set(name, value);
  },
  sendFile(filePath: string) {
    this.sentFile = filePath;
    return this;
  },
});

test("GET /photos/:photoId sert une photo publique sans exiger que le gîte soit publié", async () => {
  const originalFindFirst = prisma.gitePhoto.findFirst;
  const photoPath = "data/gites/gite-1/photos/photo_123.jpg";
  let queryArgs: any = null;

  try {
    prisma.gitePhoto.findFirst = async (args: any) => {
      queryArgs = args;
      return {
        url: `/api/gites/gite-1/photos/photo_123/file/${encodeURIComponent(photoPath)}`,
      } as any;
    };

    const handler = getRouteHandler(publicGitesRouter, "get", "/photos/:photoId");
    const response = createMockResponse();
    let nextError: unknown = null;

    await handler({ params: { photoId: "photo_123" } }, response, (error) => {
      nextError = error ?? null;
    });

    assert.equal(nextError, null);
    assert.equal(response.statusCode, 200);
    assert.deepEqual(queryArgs.where, {
      id: "photo_123",
      is_public: true,
    });
    assert.equal(response.headers.get("Content-Type"), "image/jpeg");
    assert.equal(response.sentFile, path.resolve(process.cwd(), photoPath));
  } finally {
    prisma.gitePhoto.findFirst = originalFindFirst;
  }
});
