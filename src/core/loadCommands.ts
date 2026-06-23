import type {Command} from "../types/command.js";

// Each command is imported explicitly. To add one: import it, add it to the array
import ban from "../commands/moderation/ban.js";
import kick from "../commands/moderation/kick.js";
import timeout from "../commands/moderation/timeout.js";
import send from "../commands/other/send.js";
import thinking from "../commands/other/thinking.js";
import move from "../commands/utility/move.js";
import disconnect from "../commands/utility/disconnect.js";

export const commands: Command[] = [
    ban,
    kick,
    timeout,
    send,
    thinking,
    disconnect,
    move,
];
