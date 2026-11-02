import {EmbedBuilder, MessageFlags, SlashCommandSubcommandBuilder} from "discord.js";
import type {Subcommand} from "../../types/command.js";
import {EMBED_COLOR, ESCALATE_MODEL, IDLE_MS, MODEL, RESUME_WINDOW_MS, UNANSWERED_BEFORE_SLEEP} from "../../chat/config.js";
import {modelName} from "../../chat/footers.js";

// The guide goes out as an embed; false sends the plain-text version instead.
const AS_EMBED = true;

/** The guide's content, shared by the embed and the text version. */
interface Guide {
    title: string;
    intro: string;
    sleep: string[];
    keywordsHint: string;
    keywords: string[];
    reactions: string;
    abilities: string;
    commands: string[];
}

/** `mention` is the bot's <@id>: it shows as a clickable @name and pings nobody (the guide allows no mentions). */
function guide(name: string, mention: string): Guide {
    return {
        title: `Talking to ${name}`,
        intro: `Mention ${mention} to start a conversation in this channel. It follows the whole channel and answers what's meant for it.`,
        sleep: [
            `**Sleeps** after ${duration(IDLE_MS)} without messages, after ${UNANSWERED_BEFORE_SLEEP} messages in a row ` +
            "that weren't for it, or when told to",
            `**Wakes up** with everything from before if you mention it within ${duration(RESUME_WINDOW_MS)}; ` +
            "after that, it starts fresh",
        ],
        keywordsHint: `Right after the mention, like \`@${name} thread escalate ...\``,
        keywords: [
            "`thread`: start the conversation in a new thread",
            `\`escalate\` (or \`ultrathink\`): use ${modelName(ESCALATE_MODEL)} instead of ${modelName(MODEL)}, ` +
            "at the start or partway through",
            "`stop`: stop what it's doing right now",
            "`sleep`: pause; a mention wakes it up",
            "`reset` (or `clear`): end the conversation, so the next mention starts fresh",
        ],
        reactions: "✅ started · 🔥 escalated · 🔁 woke up · 👍 already escalated · ⏹️ stopped · 🧹 reset",
        abilities: "See images and PDFs you attach, send files back, search the web, read public repos and TechNexus, " +
            "look at other channels, and create or comment on TechNexus issues (after someone clicks the button).",
        commands: [
            "`/claude stop`: end the conversation in this channel if the bot is stuck",
            "`/claude list`: every conversation, awake or asleep",
        ],
    };
}

function asEmbed(g: Guide): EmbedBuilder {
    const list = (lines: string[]) => lines.map((line) => `- ${line}`).join("\n");
    return new EmbedBuilder()
        .setColor(EMBED_COLOR)
        .setTitle(g.title)
        .setDescription(`${g.intro}\n${list(g.sleep)}`)
        .addFields(
            {name: "Keywords", value: `${g.keywordsHint}\n${list(g.keywords)}`},
            {name: "Reactions", value: g.reactions},
            {name: "It can", value: g.abilities},
            {name: "Commands", value: list(g.commands)},
        );
}

function asText(g: Guide): string {
    const list = (lines: string[]) => lines.map((line) => `- ${line}`);
    return [
        `### ${g.title}`,
        g.intro,
        ...list(g.sleep),
        "",
        `**Keywords** (${g.keywordsHint.charAt(0).toLowerCase()}${g.keywordsHint.slice(1)}):`,
        ...list(g.keywords),
        "",
        `**Reactions**: ${g.reactions}`,
        "",
        `**It can**: ${g.abilities}`,
        "",
        "**Commands**:",
        ...list(g.commands),
    ].join("\n");
}

/** "5 min", "1 hour", "12 hours" */
function duration(ms: number): string {
    const minutes = Math.round(ms / 60_000);
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.round(minutes / 60);
    return hours === 1 ? "1 hour" : `${hours} hours`;
}

const subcommand: Subcommand = {
    data: new SlashCommandSubcommandBuilder()
        .setName("help")
        .setDescription("How to talk to Claude: keywords, reactions, what it can do.")
        .addBooleanOption((option) =>
            option
                .setName("public")
                .setDescription("Post it in the channel for everyone (by default, only you see it)."),
        ),

    async execute(interaction) {
        const name = interaction.guild?.members.me?.displayName ?? interaction.client.user.displayName;
        const g = guide(name, `<@${interaction.client.user.id}>`);
        const visibility = interaction.options.getBoolean("public") ? {} : {flags: MessageFlags.Ephemeral} as const;
        await interaction.reply(AS_EMBED
            ? {embeds: [asEmbed(g)], allowedMentions: {parse: []}, ...visibility}
            : {content: asText(g), allowedMentions: {parse: []}, ...visibility});
    },
};

export default subcommand;
