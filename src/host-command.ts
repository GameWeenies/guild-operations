import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { pool, withTransaction } from "./db.js";
import { installationGuildBinding } from "./core/installation/guild-binding.js";
import { resolveConfiguredInstallationGuild } from "./core/installation/guild-binding.js";

async function rosterRecoveryHostCommand(args: string[]): Promise<void> {
  if (!stdin.isTTY || !stdout.isTTY) throw new Error("Roster recovery requires an interactive host terminal");
  if (args.length !== 1 || !["request", "cancel"].includes(args[0])) {
    throw new Error("Usage: node dist/host-command.js roster-recover request | cancel");
  }
  const binding = await installationGuildBinding();
  if (!binding?.authorizedAt || binding.authorizationKind !== "guild_master" ||
      !binding.verifiedGmCharacterRecordId || !binding.authorizedByIdentityId) {
    throw new Error("Roster recovery requires an installation authorized by a verified Guild Master");
  }
  const pending = await pool.query<{ request_id: string; guild_id: string }>(
    "SELECT request_id, guild_id FROM roster_recovery_requests WHERE completed_at IS NULL AND cancelled_at IS NULL",
  );
  if (args[0] === "cancel") {
    if (!pending.rows[0]) { stdout.write("No pending roster recovery request.\\n"); return; }
    const rl = createInterface({ input: stdin, output: stdout });
    let answer: string;
    try { answer = await rl.question('Type "cancel recovery" to cancel: '); }
    finally { rl.close(); }
    if (answer !== "cancel recovery") { stdout.write("No changes made.\\n"); return; }
    await withTransaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(256, 2)");
      await client.query(
        "UPDATE roster_recovery_requests SET cancelled_at = now() WHERE request_id = $1 AND completed_at IS NULL AND cancelled_at IS NULL",
        [pending.rows[0].request_id],
      );
    });
    stdout.write("Recovery request cancellation processed.\\n");
    return;
  }
  if (pending.rowCount) throw new Error("A roster recovery request is already pending");
  const rl = createInterface({ input: stdin, output: stdout });
  let answer: string;
  try {
    stdout.write("Recovery only requests GM approval. It does not change roster mode or permissions.\\n");
    answer = await rl.question('Type "request recovery" to continue: ');
  } finally { rl.close(); }
  if (answer !== "request recovery") { stdout.write("No changes made.\\n"); return; }
  const requestId = randomUUID();
  await withTransaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(256, 2)");
    const state = await client.query(
      "SELECT mode, manual_initialized_at FROM guild_roster_management WHERE guild_id = $1 FOR UPDATE",
      [binding.guildId],
    );
    if (state.rows[0]?.mode !== "blizzard_sync" || !state.rows[0].manual_initialized_at) {
      throw new Error("Recovery requires Blizzard Sync and an initialized Manual roster");
    }
    const admin = await client.query(
      `SELECT 1 FROM guild_roster observed
         JOIN controlled_character_roster control
           ON control.character_record_id = observed.character_record_id
          AND control.currently_controlled = true
        WHERE observed.guild_id = $1 AND observed.currently_present = true
          AND observed.rank_index = 0 LIMIT 1`,
      [binding.guildId],
    );
    if (admin.rowCount) throw new Error("An effective Blizzard Sync administrator remains; recovery is unavailable");
    const existing = await client.query(
      "SELECT 1 FROM roster_recovery_requests WHERE completed_at IS NULL AND cancelled_at IS NULL FOR UPDATE",
    );
    if (existing.rowCount) throw new Error("A roster recovery request is already pending");
    await client.query(
      "INSERT INTO roster_recovery_requests (request_id, guild_id) VALUES ($1, $2)",
      [requestId, binding.guildId],
    );
  });
  stdout.write(`Recovery request ${requestId} awaits verified GM authorization. No roster changes made.\\n`);
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (command === "roster-recover") { await rosterRecoveryHostCommand(args); return; }
  if (command !== "rebind" || !(args.length === 0 || (args.length === 1 && ["cancel", "confirm"].includes(args[0])))) {
    throw new Error("Usage: node dist/host-command.js rebind | rebind confirm | rebind cancel");
  }
  if (!stdin.isTTY || !stdout.isTTY) throw new Error("Rebinding requires an interactive host terminal");
  if (args[0] === "cancel") {
    const pending = await pool.query<{ request_id: string; guild_name: string; realm_slug: string; region: string }>(
      "SELECT request_id, guild_name, realm_slug, region FROM installation_rebind_requests WHERE completed_at IS NULL AND cancelled_at IS NULL",
    );
    const request = pending.rows[0];
    if (!request) { stdout.write("No pending rebind request.\n"); return; }
    stdout.write(`Pending destination: ${request.guild_name} (${request.realm_slug}, ${request.region})\n`);
    const rl = createInterface({ input: stdin, output: stdout });
    let confirmation: string;
    try { confirmation = await rl.question(`Type "${request.guild_name}" to cancel this request: `); }
    finally { rl.close(); }
    if (confirmation !== request.guild_name) { stdout.write("No changes made.\n"); return; }
    const cancelled = await withTransaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(256, 1)");
      return client.query(
        "UPDATE installation_rebind_requests SET cancelled_at = now() WHERE request_id = $1 AND completed_at IS NULL AND cancelled_at IS NULL",
        [request.request_id],
      );
    });
    stdout.write(cancelled.rowCount ? "Pending rebind request cancelled.\n" : "Request already completed or cancelled.\n");
    return;
  }
  const binding = await installationGuildBinding();
  if (!binding?.authorizedAt) throw new Error("Installation must be operational before rebinding");
  const pendingExisting = await pool.query(
    "SELECT request_id FROM installation_rebind_requests WHERE completed_at IS NULL AND cancelled_at IS NULL",
  );
  if (pendingExisting.rowCount) throw new Error("A rebind request is already pending; cancel it before starting another");
  const previous = await pool.query<{ name: string; realm_slug: string; region: string }>(
    "SELECT name, realm_slug, region FROM guilds WHERE guild_id = $1", [binding.guildId],
  );
  const current = previous.rows[0];
  stdout.write(`Current guild: ${current?.name ?? binding.guildId} (${current?.realm_slug ?? "unknown"}, ${current?.region ?? "unknown"})\n`);
  if (args.length === 0) {
    stdout.write("Manually review or edit GUILD_REGION, GUILD_REALM, and GUILD_NAME in the host .env file.\n");
    stdout.write("After saving, run rebind confirm as a NEW Compose invocation to load the updated environment.\n");
    stdout.write("No request has been created.\n");
    return;
  }
  const rl = createInterface({ input: stdin, output: stdout });
  let region: string;
  let realmSlug: string;
  let guildName: string;
  try {
    const reviewed = await rl.question('Type "reviewed" after reviewing and saving the host .env: ');
    if (reviewed !== "reviewed") { stdout.write("Cancelled. No changes made.\n"); return; }
    // This fresh Compose invocation receives the current host .env.
    stdout.write("Reading the configured destination from this command's environment.\n");
    const target = await resolveConfiguredInstallationGuild();
    region = target.region;
    if (!target.profile.realm.slug) throw new Error("Blizzard guild profile omitted realm slug");
    realmSlug = target.profile.realm.slug;
    guildName = target.profile.name;
    if (String(target.profile.id) === binding.guildId) {
      stdout.write("The configured destination is already bound. No rebind request created.\n");
      return;
    }
    stdout.write(`Destination: ${guildName} (${realmSlug}, ${region})\n`);
    stdout.write("Rebinding resets guild-owned permissions and integration configuration. Member identities and history remain.\n");
    const confirmation = await rl.question(`Type "${guildName}" to request rebinding: `);
    if (confirmation !== guildName) { stdout.write("Cancelled. No changes made.\n"); return; }
  } finally { rl.close(); }
  const requestId = randomUUID();
  await withTransaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(256, 1)");
    const pending = await client.query("SELECT request_id FROM installation_rebind_requests WHERE completed_at IS NULL AND cancelled_at IS NULL FOR UPDATE");
    if (pending.rowCount) throw new Error("A rebind request is already pending; no new request created");
    await client.query(
      "INSERT INTO installation_rebind_requests (request_id, region, realm_slug, guild_name) VALUES ($1,$2,$3,$4)",
      [requestId, region, realmSlug, guildName],
    );
  });
  stdout.write(`Rebind request ${requestId} is pending destination Guild Master authorization.\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}).finally(() => pool.end());
