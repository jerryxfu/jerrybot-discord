import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelType,
    Colors,
    ComponentType,
    EmbedBuilder,
    MessageFlags,
    PermissionFlagsBits,
    SlashCommandBuilder,
} from "discord.js";
import type {Command} from "../../types/command.js";
import {failsPermission} from "../../utils/guards.js";

const command: Command = {
    data: new SlashCommandBuilder()
        .setName("purge")
        .setDescription("Bulk-deletes messages in this channel.")
        .addIntegerOption((option) =>
            option
                .setName("amount")
                .setDescription("How many messages to delete (1-50).")
                .setMinValue(1)
                .setMaxValue(50)
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

        if (await failsPermission(interaction, member, PermissionFlagsBits.ManageMessages,
            "You don't have permission to manage messages.")) return;

        const channel = interaction.channel;
        if (!channel || channel.type !== ChannelType.GuildText) {
            await interaction.reply({
                content: "This only works in a regular text channel.",
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        const amount = interaction.options.getInteger("amount", true);

        // Confirmation buttons.
        const confirm = new ButtonBuilder()
            .setCustomId("purge_confirm")
            .setLabel(`Delete ${amount}`)
            .setStyle(ButtonStyle.Danger);
        const cancel = new ButtonBuilder()
            .setCustomId("purge_cancel")
            .setLabel("Cancel")
            .setStyle(ButtonStyle.Secondary);
        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(confirm, cancel);

        // withResponse gives us the message handle to attach a collector to.
        const prompt = await interaction.reply({
            content: `Delete the last **${amount}** message${amount === 1 ? "" : "s"} in this channel?`,
            components: [row],
            flags: MessageFlags.Ephemeral,
            withResponse: true,
        });

        const message = prompt.resource!.message!;

        let click;
        try {
            // awaitMessageComponent resolves on the first matching click, rejects on timeout.
            click = await message.awaitMessageComponent({
                componentType: ComponentType.Button,
                filter: (i) => i.user.id === interaction.user.id,
                time: 15_000,
            });
        } catch {
            await interaction.editReply({
                content: "Timed out — nothing was deleted.",
                components: [],
            });
            return;
        }

        if (click.customId === "purge_cancel") {
            await click.update({content: "Cancelled.", components: []});
            return;
        }

        // Confirmed. Acknowledge the button click, then delete.
        await click.update({content: "Purging...", components: []});

        const deleted = await channel.bulkDelete(amount, true);

        const embed = new EmbedBuilder()
            .setColor(Colors.Green)
            .setDescription(
                `Deleted **${deleted.size}** message${deleted.size === 1 ? "" : "s"}.` +
                (deleted.size < amount
                    ? `\n*Some messages couldn't be deleted (older than 14 days).*`
                    : ""),
            );

        await interaction.followUp({content: "", embeds: [embed], components: []});
        await interaction.deleteReply();
    },
};

export default command;