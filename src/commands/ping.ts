import {Colors, EmbedBuilder, MessageFlags, SlashCommandBuilder} from "discord.js";
import type {Command} from "../types/command.js";

const command: Command = {
    data: new SlashCommandBuilder()
        .setName("ping")
        .setDescription("Checks the bot's latency."),

    async execute(interaction) {
        // Reply then edit; gap between the two is the round-trip time
        const sent = await interaction.reply({
            content: "Ping...",
            flags: MessageFlags.Ephemeral,
            withResponse: true,
        });

        const roundtrip = sent.resource!.message!.createdTimestamp - interaction.createdTimestamp;

        // WebSocket heartbeat: the gateway connection latency
        const ws = interaction.client.ws.ping;

        const embed = new EmbedBuilder()
            .setColor(Colors.Green)
            .setTitle("Pong!")
            .addFields(
                {name: "Round-trip", value: `${roundtrip}ms`, inline: true},
                {name: "WebSocket", value: `${Math.round(ws)}ms`, inline: true},
            );

        await interaction.editReply({content: "", embeds: [embed]});
    },
};

export default command;