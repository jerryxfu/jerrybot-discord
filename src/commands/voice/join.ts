import {ChannelType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder,} from "discord.js";
import {joinVoiceChannel} from "@discordjs/voice";
import type {Command} from "../../types/command.js";

const command: Command = {
    data: new SlashCommandBuilder()
        .setName("join")
        .setDescription("Joins your voice channel.")
        .addChannelOption((option) =>
            option
                .setName("channel")
                .setDescription("Channel to join. Defaults to your current one.")
                .addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice)
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

        const member = interaction.member;

        const channel =
            interaction.options.getChannel("channel", false, [
                ChannelType.GuildVoice,
                ChannelType.GuildStageVoice,
            ]) ?? member.voice.channel;

        if (!channel) {
            await interaction.reply({
                content: "Join a voice channel first, or pass one as an option.",
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        // Check the bot can actually connect.
        const me = interaction.guild.members.me;
        if (!me?.permissionsIn(channel).has(PermissionFlagsBits.Connect)) {
            await interaction.reply({
                content: `I don't have permission to connect to ${channel}.`,
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        joinVoiceChannel({
            channelId: channel.id,
            guildId: channel.guild.id,
            // The adapter lets @discordjs/voice talk to the gateway connection
            adapterCreator: channel.guild.voiceAdapterCreator,
        });

        await interaction.reply({content: `Joined ${channel}.`});
    },
};

export default command;