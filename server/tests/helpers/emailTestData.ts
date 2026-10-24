// Evaluate this before application imports so email tests never rewrite local settings.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after } from "node:test";
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "contrats-email-settings-"));
process.env.DATA_DIR = directory;
after(() => fs.rmSync(directory, { recursive: true, force: true }));
