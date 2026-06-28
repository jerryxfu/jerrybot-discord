import {SlashCommandBuilder} from "discord.js";
import type {Command, Subcommand} from "../../types/command.js";
import {failsSudo} from "../../utils/guards.js";

import stop from "./stop.js";
import restart from "./restart.js";
import presence from "./presence.js";

const subcommands: Subcommand[] = [stop, restart, presence];

const data = new SlashCommandBuilder()
    .setName("sudo")
    .setDescription("Owner-only bot controls.");

for (const sub of subcommands) {
    data.addSubcommand(sub.data);
}

const command: Command = {
    data,

    async execute(interaction) {
        // One owner check covers every subcommand.
        if (await failsSudo(interaction)) return;

        const name = interaction.options.getSubcommand();
        const sub = subcommands.find((s) => s.data.name === name);
        await sub?.execute(interaction);
    },
};

export default command;