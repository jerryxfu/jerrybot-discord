import {Colors, EmbedBuilder, SlashCommandSubcommandBuilder} from "discord.js";
import type {Subcommand} from "../../types/command.js";

const subcommand: Subcommand = {
    data: new SlashCommandSubcommandBuilder()
        .setName("stop")
        .setDescription("Shuts the bot down and keeps it down."),

    async execute(interaction) {
        const now = Math.floor(Date.now() / 1000);

        const embed = new EmbedBuilder()
            .setColor(Colors.Fuchsia)
            .setTitle("Bot stopping")
            .setDescription("Shutting down until restarted from the shell.")
            .addFields(
                {name: "By", value: `${interaction.user.username}`, inline: true},
                {name: "At", value: `<t:${now}:F> (<t:${now}:R>)`, inline: true},
            );

        await interaction.reply({embeds: [embed]});

        console.log(`Shutdown requested by ${interaction.user.username}.`);
        await interaction.client.destroy();
        process.exit(0);
    },
};

export default subcommand;