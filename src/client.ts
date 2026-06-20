import type {ClientOptions} from "discord.js";
import {Client, Collection} from "discord.js";
import type {Command} from "./types/command.js";

/**
 * Client subclass that carries the command map.
 */
export class BotClient extends Client {
    public commands = new Collection<string, Command>();

    constructor(options: ClientOptions) {
        super(options);
    }
}

declare module "discord.js" {
    interface Client {
        commands: Collection<string, Command>;
    }
}
