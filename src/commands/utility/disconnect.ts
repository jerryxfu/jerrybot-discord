import {Colors, EmbedBuilder, MessageFlags, PermissionFlagsBits, SlashCommandBuilder,} from "discord.js";
import type {Command} from "../../types/command.js";
import {failsPermission} from "../../utils/guards.js";

const command: Command = {
    data: new SlashCommandBuilder()
        .setName("disconnect")
        .setDescription("Disconnects everyone in your voice channel."),

    async execute(interaction) {
        if (!interaction.inCachedGuild()) {
            await interaction.reply({
                content: "This command can only be used in a server.",
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        const member = interaction.member;

        if (await failsPermission(interaction, member, PermissionFlagsBits.MoveMembers,
            "You don't have permission to disconnect members.")) return;

        // You must be in a voice channel to use this.
        const source = member.voice.channel;
        if (!source) {
            await interaction.reply({
                content: "You need to be in a voice channel to use this.",
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        // Snapshot the members now ; the collection mutates as we disconnect people.
        const members = [...source.members.values()];

        await interaction.deferReply();

        let disconnected = 0;
        let failed = 0;
        for (const m of members) {
            try {
                await m.voice.setChannel(null);
                disconnected++;
            } catch {
                failed++;
            }
        }

        const plural = disconnected === 1 ? "" : "s";
        let description = `Disconnected ${disconnected} member${plural} from ${source}.`;
        if (failed > 0) {
            description += `\nFailed to disconnect ${failed}.`;
        }

        const embed = new EmbedBuilder()
            .setColor(failed === 0 ? Colors.Green : disconnected === 0 ? Colors.Red : Colors.Yellow)
            .setTitle("Voice disconnect")
            .setDescription(description)
            .setTimestamp();

        await interaction.editReply({embeds: [embed]});
    },
};

export default command;