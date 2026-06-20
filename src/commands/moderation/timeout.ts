import {EmbedBuilder, MessageFlags, PermissionFlagsBits, SlashCommandBuilder,} from "discord.js";
import type {Command} from "../../types/command.js";
import {failsHierarchy, failsPermission, failsSelfTarget,} from "../../utils/guards.js";
import {parseDuration} from "../../utils/duration.js";

// Discord caps timeouts at 28 days.
const MAX_TIMEOUT_MS = 28 * 86_400_000;

const command: Command = {
    data: new SlashCommandBuilder()
        .setName("timeout")
        .setDescription("Times out a member for a duration.")
        .addUserOption((option) =>
            option.setName("user").setDescription("The user to timeout.").setRequired(true),
        )
        .addStringOption((option) =>
            option
                .setName("duration")
                .setDescription("e.g. 30s, 10m, 1h, 1d (max 28d)")
                .setRequired(true),
        )
        .addStringOption((option) =>
            option
                .setName("reason")
                .setDescription("The reason for the timeout.")
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

        const member = interaction.member;
        const target = interaction.options.getUser("user", true);
        const durationInput = interaction.options.getString("duration", true);
        const reason = interaction.options.getString("reason") ?? "No reason provided.";
        const targetMember = interaction.guild.members.cache.get(target.id);

        if (await failsPermission(interaction, member, PermissionFlagsBits.ModerateMembers,
            "You don't have permission to timeout members.")) return;

        if (await failsSelfTarget(interaction, interaction.user.id, target.id,
            "You cannot timeout yourself.")) return;

        const durationMs = parseDuration(durationInput);
        if (durationMs === null) {
            await interaction.reply({
                content: "Invalid duration. Try something like `30s`, `10m`, `1h`, or `1d`.",
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        if (durationMs > MAX_TIMEOUT_MS) {
            await interaction.reply({
                content: "Timeouts can't be longer than 28 days.",
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        if (!targetMember) {
            await interaction.reply({
                content: "That user isn't in this server.",
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        if (await failsHierarchy(interaction, member, targetMember,
            "You cannot timeout someone with an equal or higher role.")) return;

        if (!targetMember.moderatable) {
            await interaction.reply({
                content: "I don't have permission to timeout that user.",
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        try {
            await targetMember.timeout(durationMs, reason);

            // Discord renders <t:unix:R> as a live relative timestamp ("in 10 minutes").
            const expiresAt = Math.floor((Date.now() + durationMs) / 1000);

            const embed = new EmbedBuilder()
                .setColor(0x57f287)
                .setTitle("Member timed out")
                .setDescription(`Timed out ${target.tag}.`)
                .addFields(
                    {name: "Reason", value: reason},
                    {name: "Expires", value: `<t:${expiresAt}:R>`},
                )
                .setTimestamp();

            await interaction.reply({embeds: [embed]});
        } catch (err) {
            console.error("timeout failed:", err);
            await interaction.reply({
                content: "Something went wrong while timing out that user.",
                flags: MessageFlags.Ephemeral,
            });
        }
    },
};

export default command;