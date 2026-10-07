import crypto from "node:crypto";
import { constants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

const args = new Set(process.argv.slice(2));
const copy = args.has("--copy");
const dataDirArg = process.argv.find((value) => value.startsWith("--data-dir="));
const organizationArg = process.argv.find((value) => value.startsWith("--organization="));
const dataDir = path.resolve(dataDirArg?.slice("--data-dir=".length) || process.env.DATA_DIR || "server/data");
const organizationId = organizationArg?.slice("--organization=".length) || "org_historical_broceliande";
if (!/^org_[a-z0-9_-]+$/i.test(organizationId)) throw new Error("Identifiant d'organisation invalide.");

const hashFile = async (filePath) => {
  const hash = crypto.createHash("sha256");
  const content = await fs.readFile(filePath);
  hash.update(content);
  return { hash: hash.digest("hex"), size: content.length };
};

const walk = async (root) => {
  const result = [];
  const visit = async (current) => {
    let entries = [];
    try { entries = await fs.readdir(current, { withFileTypes: true }); } catch (error) {
      if (error?.code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) await visit(target);
      else if (entry.isFile()) result.push(target);
    }
  };
  await visit(root);
  return result;
};

const mappings = [
  [path.join(dataDir, "pdfs"), path.join(dataDir, "organizations", organizationId, "pdfs")],
  [path.join(dataDir, "signed-contracts"), path.join(dataDir, "organizations", organizationId, "signed-contracts")],
  [path.join(dataDir, "gites"), path.join(dataDir, "organizations", organizationId, "photos")],
];

const journalPath = path.join(dataDir, `tenant-file-migration-${organizationId}.jsonl`);
let failures = 0;
let verified = 0;
for (const [sourceRoot, destinationRoot] of mappings) {
  for (const source of await walk(sourceRoot)) {
    const destination = path.join(destinationRoot, path.relative(sourceRoot, source));
    const sourceInfo = await hashFile(source);
    let state = "planned";
    try {
      if (copy) {
        await fs.mkdir(path.dirname(destination), { recursive: true });
        try { await fs.copyFile(source, destination, constants.COPYFILE_EXCL); } catch (error) {
          if (error?.code !== "EEXIST") throw error;
        }
        const destinationInfo = await hashFile(destination);
        if (sourceInfo.hash !== destinationInfo.hash || sourceInfo.size !== destinationInfo.size) {
          throw new Error("Le hash ou la taille du fichier copié diffère.");
        }
        state = "verified";
        verified += 1;
      }
    } catch (error) {
      state = "failed";
      failures += 1;
      console.error(`${path.relative(dataDir, source)}: ${error instanceof Error ? error.message : String(error)}`);
    }
    const event = JSON.stringify({
      at: new Date().toISOString(), state, organizationId,
      source: path.relative(dataDir, source), destination: path.relative(dataDir, destination),
      size: sourceInfo.size, sha256: sourceInfo.hash,
    });
    if (copy) await fs.appendFile(journalPath, `${event}\n`, "utf8");
    else console.log(event);
  }
}

console.log(JSON.stringify({ mode: copy ? "copy" : "dry-run", organizationId, verified, failures, legacyFilesDeleted: 0 }));
if (failures) process.exitCode = 1;
