import {MessageFlags, PermissionFlagsBits, SlashCommandBuilder,} from "discord.js";
import type {Command} from "../../types/command.js";

const command: Command = {
    data: new SlashCommandBuilder()
        .setName("kick")
        .setDescription("Kicks a user from the guild.")
        .addUserOption((option) =>
            option.setName("user").setDescription("The user to kick.").setRequired(true),
        )
        .addStringOption((option) =>
            option
                .setName("reason")
                .setDescription("The reason for the kick.")
                .setRequired(false),
        ),

    async execute(interaction) {
        // don't move this into a guard because type narrowing doesn't survive a function call
        if (!interaction.inCachedGuild()) {
            await interaction.reply({
                content: "This command can only be used in a server.",
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        await interaction.reply({
            content: "This command is currently disabled. You can use discord's integrated command.",
            flags: MessageFlags.Ephemeral,
        });
        return;

        /*const member = interaction.member;
        const target = interaction.options.getUser("user", true);
        const reason = interaction.options.getString("reason") ?? "No reason provided.";
        const targetMember = interaction.guild.members.cache.get(target.id);

        if (await failsPermission(interaction, member, PermissionFlagsBits.KickMembers,
            "You don't have permission to kick members.")) return;

        if (await failsSelfTarget(interaction, interaction.user.id, target.id,
            "You cannot kick yourself.")) return;

        if (targetMember && await failsHierarchy(interaction, member, targetMember,
            "You cannot kick someone with an equal or higher role.")) return;

        // Unlike ban, kick requires the member to actually be in the guild.
        if (!targetMember) {
            await interaction.reply({
                content: "That user isn't in this server.",
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        if (!targetMember.kickable) {
            await interaction.reply({
                content: "I don't have permission to kick that user.",
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        try {
            await targetMember.kick(reason);

            const embed = new EmbedBuilder()
                .setColor(0x57f287)
                .setTitle("Member kicked")
                .setDescription(`Kicked ${target.tag}.`)
                .addFields({name: "Reason", value: reason})
                .setTimestamp();

            await interaction.reply({embeds: [embed]});
        } catch (err) {
            console.error("kick failed:", err);
            await interaction.reply({
                content: "Something went wrong while kicking that user.",
                flags: MessageFlags.Ephemeral,
            });
        }*/
    },
};

export default command;