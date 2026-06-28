import {Colors, EmbedBuilder, MessageFlags, SlashCommandSubcommandBuilder} from "discord.js";
import type {Subcommand} from "../../types/command.js";

const subcommand: Subcommand = {
    data: new SlashCommandSubcommandBuilder()
        .setName("restart")
        .setDescription("Restarts the bot."),

    async execute(interaction) {
        const now = Math.floor(Date.now() / 1000);

        const embed = new EmbedBuilder()
            .setColor(Colors.Yellow) // green
            .setTitle("Bot restarting")
            .setDescription("Restarting now by PM2")
            .addFields(
                {name: "By", value: `${interaction.user}`, inline: true},
                {name: "At", value: `<t:${now}:F> (<t:${now}:R>)`, inline: true},
            );

        await interaction.reply({embeds: [embed]});

        console.log(`Restart requested by ${interaction.user.tag}.`);
        await interaction.client.destroy();
        process.exit(1); // non-zero -> PM2 restarts it
    },
};

export default subcommand;