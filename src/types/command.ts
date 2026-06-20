import type {
    Awaitable,
    ChatInputCommandInteraction,
    SlashCommandBuilder,
    SlashCommandOptionsOnlyBuilder,
    SlashCommandSubcommandsOnlyBuilder,
} from "discord.js";

/**
 * A slash command. `data` is the builder Discord registers,
 * `execute` runs when the command is invoked.
 *
 * The union on `data` covers the three shapes a builder can take after
 * you start chaining: plain, with-options, or with-subcommands.
 */
export interface Command {
    data:
        | SlashCommandBuilder
        | SlashCommandOptionsOnlyBuilder
        | SlashCommandSubcommandsOnlyBuilder;

    execute(interaction: ChatInputCommandInteraction): Awaitable<void>;
}
