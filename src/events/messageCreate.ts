import {Events} from "discord.js";
import type {Event} from "../types/event.js";
import {handleChatMessage} from "../chat/conversation.js";

const event: Event<Events.MessageCreate> = {
    name: Events.MessageCreate,
    once: false,
    async execute(message) {
        try {
            await handleChatMessage(message);
        } catch (err) {
            console.error("Error handling chat message:", err);
        }
    },
};

export default event;
