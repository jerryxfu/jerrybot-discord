import {MessageFlags, SlashCommandBuilder,} from "discord.js";
import {getVoiceConnection} from "@discordjs/voice";
import type {Command} from "../../types/command.js";

const command: Command = {
    data: new SlashCommandBuilder()
        .setName("leave")
        .setDescription("Leaves the voice channel."),

    async execute(interaction) {
        if (!interaction.inCachedGuild()) {
            await interaction.reply({
                content: "This command can only be used in a server.",
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        // Look up the bot's connection for this guild
        const connection = getVoiceConnection(interaction.guild.id);

        if (!connection) {
            await interaction.reply({
                content: "I'm not in a voice channel.",
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        connection.destroy(); // disconnects and cleans up
        await interaction.reply({content: "Left the voice channel."});
    },
};

export default command;