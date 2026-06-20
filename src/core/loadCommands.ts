import type {Command} from "../types/command.js";

// Each command is imported explicitly. To add one: import it, add it to the array
import ban from "../commands/moderation/ban.js";
import kick from "../commands/moderation/kick.js";
import timeout from "../commands/moderation/timeout.js";

export const commands: Command[] = [ban, kick, timeout];
