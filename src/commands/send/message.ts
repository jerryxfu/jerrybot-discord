import {ChannelType, MessageFlags, SlashCommandSubcommandBuilder} from "discord.js";
import type {Subcommand} from "../../types/command.js";
import {logSend} from "../../utils/sendHistory.js";
import {sleep} from "../../utils/sleep.js";
import {typingDelay} from "../../utils/typingDelay.js";

const MAX_MS = 10_000; // typing indicator lasts for exactly 10s

const subcommand: Subcommand = {
    data: new SlashCommandSubcommandBuilder()
        .setName("message")
        .setDescription("Sends a message as the bot, after a realistic typing delay.")
        .addStringOption((option) =>
            option
                .setName("text")
                .setDescription("The message to send.")
                .setRequired(true),
        )
        .addChannelOption((option) =>
            option
                .setName("channel")
                .setDescription("The channel to send to. Defaults to the current channel.")
                .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
                .setRequired(false),
        ),

    async execute(interaction) {
        const text = interaction.options.getString("text", true);

        // getChannel's 3rd arg (allowed types) narrows the return to a full channel
        // class with methods like isSendable(), instead of a bare resolved partial.
        const channel =
            interaction.options.getChannel("channel", false, [
                ChannelType.GuildText,
                ChannelType.GuildAnnouncement,
            ]) ?? interaction.channel;

        // Make sure we actually have a channel we can send to.
        if (!channel?.isSendable()) {
            await interaction.reply({
                content: "I can't send messages to that channel.",
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        const durationMs = typingDelay(text.length, MAX_MS);

        await interaction.reply({
            content: `Sending to ${channel} with ~${durationMs}ms of typing...`,
            flags: MessageFlags.Ephemeral,
        });

        await channel.sendTyping();

        await sleep(durationMs);

        await channel.send({content: text});
        await logSend({
            at: Date.now(),
            kind: "message",
            guildId: interaction.guildId,
            channelId: channel.id,
            userId: interaction.user.id,
            content: text,
        });
        await interaction.deleteReply();
    },
};

export default subcommand;
