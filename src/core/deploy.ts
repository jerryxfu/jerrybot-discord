import {REST, Routes} from "discord.js";
import {commands} from "./loadCommands.js";

/**
 * Registers slash commands with Discord. Run this with `pnpm deploy`
 * whenever you add/change/remove a command's `data` (name, options, etc.).
 * You do NOT need to run it to change a command's logic.
 *
 * GUILD_ID set  -> registers to that one guild, updates instantly (use in dev).
 * GUILD_ID empty -> registers globally, can take longer to appear.
 */
const token = requireEnv("DISCORD_TOKEN");
const clientId = "950065694085623828";
const guildId = "631939549332897842"; // jerry server

const body = commands.map((command) => command.data.toJSON());
const rest = new REST().setToken(token);

const route = guildId
    ? Routes.applicationGuildCommands(clientId, guildId)
    : Routes.applicationCommands(clientId);

try {
    console.log(`Deploying ${body.length} command(s)${guildId ? ` to guild ${guildId}` : " globally"}...`);
    await rest.put(route, {body});
    console.log("Done.");
} catch (err) {
    console.error("Deploy failed:", err);
    process.exit(1);
}

function requireEnv(key: string): string {
    const value = process.env[key];
    if (!value) {
        console.error(`Missing required env var: ${key}`);
        process.exit(1);
    }
    return value;
}
