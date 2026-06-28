import {ActivityType, Colors, EmbedBuilder, MessageFlags, PresenceUpdateStatus, SlashCommandSubcommandBuilder,} from "discord.js";
import type {Subcommand} from "../../types/command.js";

const subcommand: Subcommand = {
    data: new SlashCommandSubcommandBuilder()
        .setName("presence")
        .setDescription("Sets or clears the bot's presence.")
        .addStringOption((option) =>
            option
                .setName("type")
                .setDescription("Activity type.")
                .addChoices(
                    {name: "Playing", value: "Playing"},
                    {name: "Watching", value: "Watching"},
                    {name: "Listening", value: "Listening"},
                    {name: "Competing", value: "Competing"},
                    {name: "Custom", value: "Custom"},
                )
                .setRequired(false),
        )
        .addStringOption((option) =>
            option
                .setName("text")
                .setDescription("The status text.")
                .setRequired(false),
        )
        .addBooleanOption((option) =>
            option
                .setName("clear")
                .setDescription("Clear the presence instead.")
                .setRequired(false),
        ),

    async execute(interaction) {
        const clear = interaction.options.getBoolean("clear") ?? false;

        if (clear) {
            interaction.client.user.setPresence({activities: []});
            await interaction.reply({
                content: "Presence cleared.",
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        const typeInput = interaction.options.getString("type") ?? "Playing";
        const text = interaction.options.getString("text");

        if (!text) {
            await interaction.reply({
                content: "Provide `text`, or use `clear: true` to remove the presence.",
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        const typeMap: Record<string, ActivityType> = {
            Playing: ActivityType.Playing,
            Watching: ActivityType.Watching,
            Listening: ActivityType.Listening,
            Competing: ActivityType.Competing,
            Custom: ActivityType.Custom,
        };
        const type = typeMap[typeInput] ?? ActivityType.Playing;

        interaction.client.user.setPresence({
            activities: [{name: text, type}],
            status: PresenceUpdateStatus.Online,
        });

        const now = Math.floor(Date.now() / 1000);
        const embed = new EmbedBuilder()
            .setColor(Colors.Green)
            .setTitle("Presence updated")
            .addFields(
                {name: "Activity", value: `**${typeInput}** ${text}`, inline: false},
                {name: "At", value: `<t:${now}:F>`, inline: false},
            );

        await interaction.reply({embeds: [embed]});
    },
};

export default subcommand;