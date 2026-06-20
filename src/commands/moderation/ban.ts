import {EmbedBuilder, MessageFlags, PermissionFlagsBits, SlashCommandBuilder,} from "discord.js";
import type {Command} from "../../types/command.js";
import {guildMemberIsAbove} from "../utils.js";

const command: Command = {
    data: new SlashCommandBuilder()
        .setName("ban")
        .setDescription("Bans a user from the guild.")
        .addUserOption((option) =>
            option.setName("user").setDescription("The user to ban.").setRequired(true),
        )
        .addStringOption((option) =>
            option
                .setName("reason")
                .setDescription("The reason for the ban.")
                .setRequired(false),
        )
        // Hides the command from members lacking this permission,
        .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),

    async execute(interaction) {
        // DM guard
        if (!interaction.inCachedGuild()) {
            await interaction.reply({
                content: "This command can only be used in a server.",
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        const target = interaction.options.getUser("user", true);
        const reason = interaction.options.getString("reason") ?? "No reason provided.";
        const member = interaction.member; // typed as GuildMember thanks to inCachedGuild()
        const targetMember = interaction.guild.members.cache.get(target.id);

        // permission guard
        if (!member.permissions.has(PermissionFlagsBits.BanMembers)) {
            await interaction.reply({
                content: "You don't have permission to ban members.",
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        // idiot guard
        if (target.id === interaction.user.id) {
            await interaction.reply({
                content: "You cannot ban yourself.",
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        // Role hierarchy check
        if (targetMember && !guildMemberIsAbove(member, targetMember)) {
            await interaction.reply({
                content: "You cannot ban someone with an equal or higher role.",
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        // Can the bot actually ban this member?
        if (targetMember && !targetMember.bannable) {
            await interaction.reply({
                content: "I don't have permission to ban that user.",
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        try {
            await interaction.guild.members.ban(target, {reason});

            const embed = new EmbedBuilder()
                .setColor(0x57f287) // green
                .setTitle("Member banned")
                .setDescription(`Banned ${target.tag}.`)
                .addFields({name: "Reason", value: reason})
                .setTimestamp();

            await interaction.reply({embeds: [embed]});
        } catch (err) {
            console.error("ban failed:", err);
            await interaction.reply({
                content: "Something went wrong while banning that user.",
                flags: MessageFlags.Ephemeral,
            });
        }
    },
};

export default command;
