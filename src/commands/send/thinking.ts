import {SlashCommandSubcommandBuilder} from "discord.js";
import type {Subcommand} from "../../types/command.js";
import {logSend} from "../../utils/sendHistory.js";
import {sleep} from "../../utils/sleep.js";
import {typingDelay} from "../../utils/typingDelay.js";

const MAX_MS = 15_000;

const subcommand: Subcommand = {
    data: new SlashCommandSubcommandBuilder()
        .setName("thinking")
        .setDescription("Shows \"is thinking...\" in this channel, then turns it into a message.")
        .addStringOption((option) =>
            option
                .setName("text")
                .setDescription("The message to send.")
                .setRequired(true),
        ),

    async execute(interaction) {
        const text = interaction.options.getString("text", true);

        // The thinking state is the deferred reply itself, so the message lands
        // in the channel the command was used in, under the "used /send" header.
        await interaction.deferReply();
        await sleep(typingDelay(text.length, MAX_MS));
        await interaction.editReply({content: text});

        await logSend({
            at: Date.now(),
            kind: "thinking",
            guildId: interaction.guildId,
            channelId: interaction.channelId,
            userId: interaction.user.id,
            content: text,
        });
    },
};

export default subcommand;
