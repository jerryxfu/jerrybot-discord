import {ChannelType, MessageFlags, SlashCommandBuilder,} from "discord.js";
import type {Command} from "../../types/command.js";
import {sleep} from "../../utils/sleep.js";

const CHARS_PER_SECOND = 18;
const BASE_MS = 50;
const MIN_MS = 50;
const MAX_MS = 10_000; // typing indicator lasts for exactly 10s

function typingDuration(length: number): number {
    const raw = BASE_MS + (length / CHARS_PER_SECOND) * 1000;
    return Math.min(MAX_MS, Math.max(MIN_MS, Math.round(raw)));
}

const command: Command = {
    data: new SlashCommandBuilder()
        .setName("send")
        .setDescription("Sends a message in a text channel.")
        .addStringOption((option) =>
            option
                .setName("message")
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
        const message = interaction.options.getString("message", true);

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

        const durationMs = typingDuration(message.length);

        await interaction.reply({
            content: `Sending to ${channel} with ~${durationMs}ms of typing...`,
            flags: MessageFlags.Ephemeral,
        });

        await channel.sendTyping();

        await sleep(durationMs);

        await channel.send({content: message + `\n-# *Sent by ${interaction.user.displayName}*`});
        await interaction.deleteReply();
    },
};

export default command;