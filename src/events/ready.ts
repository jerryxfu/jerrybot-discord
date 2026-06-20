import {Events} from "discord.js";
import type {Event} from "../types/event.js";

// ClientReady fires once when the bot has logged in and is ready.
const event: Event<Events.ClientReady> = {
    name: Events.ClientReady,
    once: true,
    execute(client) {
        // `client` here is the ready client; client.user is guaranteed non-null.
        console.log(`Logged in as ${client.user.tag}`);
        console.log(`Serving ${client.guilds.cache.size} guild(s).`);
    },
};

export default event;
