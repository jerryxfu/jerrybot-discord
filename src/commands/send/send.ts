import {SlashCommandBuilder} from "discord.js";
import type {Command, Subcommand} from "../../types/command.js";

import message from "./message.js";
import thinking from "./thinking.js";
import history from "./history.js";

const subcommands: Subcommand[] = [message, thinking, history];

const data = new SlashCommandBuilder()
    .setName("send")
    .setDescription("Make the bot send a message.");

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
