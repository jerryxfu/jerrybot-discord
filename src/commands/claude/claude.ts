import {SlashCommandBuilder} from "discord.js";
import type {Command, Subcommand} from "../../types/command.js";

import help from "./help.js";
import list from "./list.js";
import stop from "./stop.js";

const subcommands: Subcommand[] = [help, list, stop];

const data = new SlashCommandBuilder()
    .setName("claude")
    .setDescription("Control the Claude chat.");

for (const sub of subcommands) {
    data.addSubcommand(sub.data);
}

const command: Command = {
    data,

    async execute(interaction) {
        const name = interaction.options.getSubcommand();
        const sub = subcommands.find((s) => s.data.name === name);
        await sub?.execute(interaction);
    },
};

export default command;
