import {ChannelType, Colors, EmbedBuilder, MessageFlags, PermissionFlagsBits, SlashCommandBuilder,} from "discord.js";
import type {Command} from "../../types/command.js";
import {failsPermission} from "../../utils/guards.js";

const command: Command = {
    data: new SlashCommandBuilder()
        .setName("move")
        .setDescription("Moves everyone in your voice channel to another one.")
        .addChannelOption((option) =>
            option
                .setName("channel")
                .setDescription("The voice channel to move everyone to.")
                .addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice)
                .setRequired(true),
        ),

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
            "You don't have permission to move members.")) return;

        // You must be in a voice channel to use this.
        const source = member.voice.channel;
        if (!source) {
            await interaction.reply({
                content: "You need to be in a voice channel to use this.",
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        const target = interaction.options.getChannel("channel", true, [
            ChannelType.GuildVoice,
            ChannelType.GuildStageVoice,
        ]);

        if (target.id === source.id) {
            await interaction.reply({
                content: "You're already in that channel.",
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        // Snapshot the members now; the collection mutates as we move people.
        const members = [...source.members.values()];

        await interaction.deferReply();

        let moved = 0;
        let failed = 0;
        for (const member of members) {
            try {
                await member.voice.setChannel(target);
                moved++;
            } catch {
                failed++;
            }
        }

        const plural = moved === 1 ? "" : "s";
        let description = `Moved ${moved} member${plural} from ${source} to ${target}.`;
        if (failed > 0) {
            description += `\nFailed to move ${failed}.`;
        }

        const embed = new EmbedBuilder()
            .setColor(failed === 0 ? Colors.Green : moved === 0 ? Colors.Red : Colors.Yellow)
            .setTitle("Voice move")
            .setDescription(description)
            .setTimestamp();

        await interaction.editReply({embeds: [embed]});
    },
};

export default command;