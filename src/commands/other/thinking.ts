import {SlashCommandBuilder} from "discord.js";
import type {Command} from "../../types/command.js";
import {sleep} from "../../utils/sleep.js";

const command: Command = {
    data: new SlashCommandBuilder()
        .setName("thinking")
        .setDescription("Shows the thinking state, then replies.")
        .addIntegerOption((option) =>
            option
                .setName("seconds")
                .setDescription("How long to think, 1-15 seconds.")
                .setMinValue(1)
                .setMaxValue(15)
                .setRequired(false),
        ),

    async execute(interaction) {
        const seconds = interaction.options.getInteger("seconds") ?? 3;

        await interaction.deferReply();
        await sleep(seconds * 1000);
        await interaction.deleteReply();
        // await interaction.editReply(`Thought for ${seconds}s.`);
    },
};

export default command;