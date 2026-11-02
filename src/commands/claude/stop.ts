import {MessageFlags, SlashCommandSubcommandBuilder} from "discord.js";
import type {Subcommand} from "../../types/command.js";
import {CHAT_GUILDS} from "../../chat/config.js";
import {stopChat} from "../../chat/conversation.js";

const subcommand: Subcommand = {
    data: new SlashCommandSubcommandBuilder()
        .setName("stop")
        .setDescription("Ends Claude's conversation in this channel for good, even when it's stuck."),

    async execute(interaction) {
        if (!interaction.guildId || !CHAT_GUILDS.includes(interaction.guildId)) {
            await interaction.reply({content: "Chat isn't on in this server.", flags: MessageFlags.Ephemeral});
            return;
        }

        // Ending it can take a few seconds (it reads the spend and archives the session).
        await interaction.deferReply();
        const stopped = await stopChat(interaction.channelId, "stopped with /claude stop");
        await interaction.editReply(stopped
            ? "Stopped. The next mention starts a fresh conversation."
            : "There's no conversation here to stop.");
    },
};

export default subcommand;
