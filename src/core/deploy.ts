import {REST, Routes} from "discord.js";
import {commands} from "./loadCommands.js";

/**
 * Registers slash commands with Discord. Run with `pnpm deploy <scope>`:
 *   local        (default) register commands to the dev guild — instant
 *   global       register commands globally — up to ~1h to propagate
 *   clear_local  remove all commands from the dev guild
 *   clear_global remove all global commands
 *
 * Run this whenever you add/change/remove a command's `data` (name, options).
 * You do NOT need to run it to change a command's logic.
 */
const token = requireEnv("DISCORD_TOKEN");
const clientId = "950065694085623828";
const guildId = "631939549332897842"; // jerry server

type DeployScope = "local" | "global" | "clear_local" | "clear_global";

const arg = process.argv[2] ?? "local";
if (!isScope(arg)) {
    console.error(`Invalid scope: "${arg}". Use: local | global | clear_local | clear_global`);
    process.exit(1);
}
const scope: DeployScope = arg;

const body = commands.map((command) => command.data.toJSON());
const rest = new REST().setToken(token);

try {
    if (scope === "global") {
        console.log(`Deploying ${body.length} command(s) globally...`);
        await rest.put(Routes.applicationCommands(clientId), {body});
    } else if (scope === "clear_global") {
        console.log("Clearing global command(s)...");
        await rest.put(Routes.applicationCommands(clientId), {body: []});
    } else if (scope === "clear_local") {
        console.log(`Clearing command(s) in ${guildId}...`);
        await rest.put(Routes.applicationGuildCommands(clientId, guildId), {body: []});
    } else {
        console.log(`Deploying ${body.length} command(s) to ${guildId}...`);
        await rest.put(Routes.applicationGuildCommands(clientId, guildId), {body});
    }

    console.log("Done.");
} catch (err) {
    console.error("Deploy failed:", err);
    process.exit(1);
}

function isScope(value: string): value is DeployScope {
    return value === "local" || value === "global"
        || value === "clear_local" || value === "clear_global";
}

function requireEnv(key: string): string {
    const value = process.env[key];
    if (!value) {
        console.error(`Missing required env var: ${key}`);
        process.exit(1);
    }
    return value;
}