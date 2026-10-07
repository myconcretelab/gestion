import { systemPrisma as prisma } from "../src/db/prisma.js";
import { changePlatformAdministrator, listPlatformAdministrators } from "../src/modules/billing/admin.js";

const command = process.argv[2] ?? "list";
const flags = new Map(process.argv.slice(3).map((value) => {
  const [key, ...rest] = value.split("=");
  return [key, rest.join("=") || "true"];
}));

const list = async () => {
  const rows = await listPlatformAdministrators();
  console.log(JSON.stringify(rows.map((row) => ({ userId: row.user_id, loginId: row.user.login_id, role: row.role, status: row.status, createdAt: row.createdAt })), null, 2));
};

const change = async (status: "active" | "revoked") => {
  const userId = flags.get("--user");
  const actor = flags.get("--actor");
  const reason = flags.get("--reason");
  if (flags.get("--apply") !== "true" || !userId || !actor || !reason || reason.length < 3) {
    throw new Error(`Opération refusée. Utilisez ${command} --apply --user=ID --actor=IDENTIFIANT --reason=MOTIF.`);
  }
  console.log(JSON.stringify(await changePlatformAdministrator({ userId, actorUserId: actor, reason, status }), null, 2));
};

try {
  if (command === "list") await list();
  else if (command === "grant") await change("active");
  else if (command === "revoke") await change("revoked");
  else throw new Error("Commande attendue: list, grant ou revoke.");
} finally {
  await prisma.$disconnect();
}
