import type {Command} from "../types/command.js";

// Each command is imported explicitly. To add one: import it, add it to the array
import ban from "../commands/moderation/ban.js";
import kick from "../commands/moderation/kick.js";
import timeout from "../commands/moderation/timeout.js";
import send from "../commands/other/send.js";
import thinking from "../commands/other/thinking.js";
import move from "../commands/utility/move.js";
import disconnect from "../commands/utility/disconnect.js";
import join from "../commands/voice/join.js";
import leave from "../commands/voice/leave.js";
import ping from "../commands/ping.js";
import sudo from "../commands/sudo/sudo.js";
import purge from "../commands/moderation/purge.js";

export const commands: Command[] = [
    ban,
    kick,
    timeout,
    send,
    thinking,
    disconnect,
    move,
    join,
    leave,
    ping,
    sudo,
    purge
];
