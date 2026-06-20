import {GatewayIntentBits} from "discord.js";
import {BotClient} from "./client.js";
import {commands} from "./core/loadCommands.js";
import {events} from "./core/loadEvents.js";

const client = new BotClient({
    intents: [GatewayIntentBits.Guilds],
});

// Register commands into the collection the dispatcher reads from.
for (const command of commands) {
    client.commands.set(command.data.name, command);
}

// Events
type Listener = (...args: unknown[]) => unknown;
for (const event of events) {
    const handler = event.execute as Listener;
    if (event.once) {
        client.once(event.name, handler);
    } else {
        client.on(event.name, handler);
    }
}

const token = process.env.DISCORD_TOKEN;
if (!token) {
    console.error("Missing DISCORD_TOKEN in environment.");
    process.exit(1);
}

await client.login(token);
