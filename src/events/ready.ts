import {Events} from "discord.js";
import type {Event} from "../types/event.js";
import {recoverChatSessions} from "../chat/conversation.js";

// ClientReady fires once when the bot has logged in and is ready.
const event: Event<Events.ClientReady> = {
    name: Events.ClientReady,
    once: true,
    execute(client) {
        // `client` here is the ready client; client.user is guaranteed non-null.
        console.log(`Logged in as ${client.user.tag}`);
        console.log(`Serving ${client.guilds.cache.size} guild(s).`);
        // Chat conversations that were awake when the bot stopped go to sleep,
        // so a mention picks them back up.
        recoverChatSessions(client).catch((err: unknown) => {
            console.error("Error recovering chat sessions:", err);
        });
    },
};

export default event;
