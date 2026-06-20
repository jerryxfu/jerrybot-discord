import {Events, MessageFlags} from "discord.js";
import type {Event} from "../types/event.js";

// command dispatcher
const event: Event<Events.InteractionCreate> = {
    name: Events.InteractionCreate,
    once: false,
    async execute(interaction) {
        if (!interaction.isChatInputCommand()) return;

        const command = interaction.client.commands.get(interaction.commandName);
        if (!command) {
            console.warn(`Unknown command: /${interaction.commandName}`);
            return;
        }

        try {
            await command.execute(interaction);
        } catch (err) {
            console.error(`Error in /${interaction.commandName}:`, err);

            const message = {
                content: "Something went wrong running that command.",
                flags: MessageFlags.Ephemeral as const,
            };

            // If we already replied/deferred, follow up; otherwise reply fresh.
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp(message).catch(() => {
                });
            } else {
                await interaction.reply(message).catch(() => {
                });
            }
        }
    },
};

export default event;
