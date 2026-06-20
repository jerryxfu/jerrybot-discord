import type {Command} from "../types/command.js";

// Each command is imported explicitly. To add one: import it, add it to the array
import ban from "../commands/moderation/ban.js";

export const commands: Command[] = [ban];
