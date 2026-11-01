import {ChannelType, Colors, EmbedBuilder, escapeMarkdown, MessageFlags, SlashCommandSubcommandBuilder,} from "discord.js";
import type {Subcommand} from "../../types/command.js";
import {readSends, type SendEntry} from "../../utils/sendHistory.js";

const PREVIEW_CHARS = 120;

function describe(entry: SendEntry): string {
    const when = `<t:${Math.floor(entry.at / 1000)}:R>`;
    const via = entry.kind === "thinking" ? " · *thinking*" : "";
    const preview = entry.content.length > PREVIEW_CHARS
        ? entry.content.slice(0, PREVIEW_CHARS) + "…"
        : entry.content;
    return `${when} <@${entry.userId}> → <#${entry.channelId}>${via}\n> ${escapeMarkdown(preview).replaceAll("\n", " ")}`;
}

const subcommand: Subcommand = {
    data: new SlashCommandSubcommandBuilder()
        .setName("history")
        .setDescription("Shows who recently used /send in this server.")
        .addUserOption((option) =>
            option
                .setName("user")
                .setDescription("Only show sends by this user.")
                .setRequired(false),
        )
        .addChannelOption((option) =>
            option
                .setName("channel")
                .setDescription("Only show sends to this channel.")
                .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
                .setRequired(false),
        )
        .addIntegerOption((option) =>
            option
                .setName("limit")
                .setDescription("How many entries to show, 1-25. Defaults to 10.")
                .setMinValue(1)
                .setMaxValue(25)
                .setRequired(false),
        ),

    async execute(interaction) {
        if (!interaction.inCachedGuild()) {
            await interaction.reply({
                content: "This command can only be used in a server.",
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        const user = interaction.options.getUser("user");
        const channel = interaction.options.getChannel("channel");
        const limit = interaction.options.getInteger("limit") ?? 10;

        const entries = await readSends(
            (e) =>
                e.guildId === interaction.guildId &&
                (!user || e.userId === user.id) &&
                (!channel || e.channelId === channel.id),
            limit,
        );

        const embed = new EmbedBuilder()
            .setColor(Colors.Blurple)
            .setTitle("Send history")
            .setDescription(
                entries.length > 0
                    ? entries.map(describe).join("\n\n").slice(0, 4096)
                    : "Nothing matches.",
            );

        await interaction.reply({embeds: [embed], flags: MessageFlags.Ephemeral});
    },
};

export default subcommand;
