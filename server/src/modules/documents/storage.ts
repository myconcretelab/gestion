import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export type StoredDocument = {
  storageKey: string;
  sizeBytes: number;
  checksumSha256: string;
};

export interface DocumentStorage {
  put(
    organizationId: string,
    storageKey: string,
    contents: Buffer,
  ): Promise<StoredDocument>;
  read(organizationId: string, storageKey: string): Promise<Buffer>;
  delete(organizationId: string, storageKey: string): Promise<void>;
  resolveLegacyPath(legacyPath: string): Promise<Buffer>;
}

const safePart = (value: string) => {
  const normalized = value.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized || normalized.split("/").some((part) => part === ".."))
    throw new Error("Chemin de document invalide.");
  return normalized;
};

export class LocalDocumentStorage implements DocumentStorage {
  constructor(
    private readonly root: string,
    private readonly legacyRoot: string,
  ) {}

  private target(organizationId: string, storageKey: string) {
    return path.join(
      this.root,
      "organizations",
      safePart(organizationId),
      safePart(storageKey),
    );
  }

  async put(
    organizationId: string,
    storageKey: string,
    contents: Buffer,
  ): Promise<StoredDocument> {
    const target = this.target(organizationId, storageKey);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, contents, { flag: "wx" });
    return {
      storageKey,
      sizeBytes: contents.byteLength,
      checksumSha256: crypto
        .createHash("sha256")
        .update(contents)
        .digest("hex"),
    };
  }

  read(organizationId: string, storageKey: string) {
    return fs.readFile(this.target(organizationId, storageKey));
  }
  delete(organizationId: string, storageKey: string) {
    return fs.unlink(this.target(organizationId, storageKey));
  }
  resolveLegacyPath(legacyPath: string) {
    return fs.readFile(path.join(this.legacyRoot, safePart(legacyPath)));
  }
}
