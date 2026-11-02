import {EmbedBuilder, SlashCommandSubcommandBuilder} from "discord.js";
import type {Subcommand} from "../../types/command.js";
import {EMBED_COLOR, MONTHLY_LIMIT_CENTS, RESUME_WINDOW_MS} from "../../chat/config.js";
import {listChats} from "../../chat/conversation.js";
import {formatCents, formatTokens, modelName} from "../../chat/footers.js";
import {monthSpentCents, spentCents} from "../../chat/spend.js";

const subcommand: Subcommand = {
    data: new SlashCommandSubcommandBuilder()
        .setName("list")
        .setDescription("Lists Claude's conversations: the ones awake, and the ones asleep that a mention can wake up."),

    async execute(interaction) {
        // Reading each session's spend takes a moment.
        await interaction.deferReply();
        const chats = listChats();
        const [spent, month] = await Promise.all([
            Promise.all(chats.map((chat) => spentCents(chat.sessionId))),
            monthSpentCents(),
        ]);

        // 🟢 <#123> · Haiku 5.5 · 45K/400K context · ||$0.30/$3.00||
        // 💤 <#456> · Sonnet 5.5 · asleep since 3 minutes ago, mention before 21:40 to wake it · ||$1.20/$8.00||
        const lines = chats.map((chat, i) => {
            const cents = spent[i];
            const cost = cents == null ? "" : ` · ||${formatCents(cents)}/${formatCents(chat.budgetCents)}||`;
            const context = `${formatTokens(chat.contextTokens)}/${formatTokens(chat.contextLimit)} context`;
            const state = chat.sleptAt === null
                ? context
                : `asleep since <t:${unix(chat.sleptAt)}:R>, mention before <t:${unix(chat.sleptAt + RESUME_WINDOW_MS)}:t> to wake it`;
            return `${chat.sleptAt === null ? "🟢" : "💤"} <#${chat.channelId}> · ${modelName(chat.model)} · ${state}${cost}`;
        });

        const embed = new EmbedBuilder()
            .setColor(EMBED_COLOR)
            .setTitle("Claude conversations")
            .setDescription(lines.length > 0 ? lines.join("\n") : "No conversations right now. Mention Claude to start one.");
        if (month !== null) embed.setFooter({text: `This month: ${formatCents(month)} of ${formatCents(MONTHLY_LIMIT_CENTS)}`});

        await interaction.editReply({embeds: [embed]});
    },
};

function unix(ms: number): number {
    return Math.floor(ms / 1000);
}

export default subcommand;
