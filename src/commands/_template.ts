import {EmbedBuilder, MessageFlags, SlashCommandBuilder,} from "discord.js";
import type {Command} from "../types/command.js";

// guards. each is `if (await ...) return;`.
// import {
//   failsPermission,
//   failsSelfTarget,
//   failsHierarchy,
//   PermissionFlagsBits,
// } from "../utils/guards.js";

/**
 * TEMPLATE
 *   1. Copy to its folder
 *   2. Configure the command
 *   3. Write the logic in execute().
 *   4. Register it in core/loadCommands.ts (import + add to the array).
 *   5. Run `pnpm deploy` so Discord knows about it.
 */
const command: Command = {
    data: new SlashCommandBuilder()
        .setName("name") // lowercase, no spaces, 1-32 chars
        .setDescription("What this command does."),
    // .addStringOption((option) =>
    //   option.setName("input").setDescription("Some text.").setRequired(true),
    // ),

    async execute(interaction) {
        // If this command must run in a server, keep this guard. It also
        // narrows interaction.member to GuildMember for everything below.
        if (!interaction.inCachedGuild()) {
            await interaction.reply({
                content: "This command can only be used in a server.",
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        // const member = interaction.member; // typed GuildMember (guild-only)

        // Read options (the `true` makes a required option non-nullable):
        // const input = interaction.options.getString("input", true);

        // Guards
        // if (await failsPermission(interaction, member,
        //   PermissionFlagsBits.ManageMessages,
        //   "You don't have permission to do that.")) return;

        // Reply
        const embed = new EmbedBuilder()
            .setColor(0x5865f2) // blurple
            .setTitle("Title")
            .setDescription("Replace me.")
            .setTimestamp();

        await interaction.reply({embeds: [embed]});
    },
};

export default command;