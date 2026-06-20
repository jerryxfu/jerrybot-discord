import type {AnyEvent} from "../types/event.js";

// Same pattern as commands: explicit imports, one array.
import ready from "../events/ready.js";
import interactionCreate from "../events/interactionCreate.js";

// AnyEvent is the union of Event<Name> over every event name, so the array
// holds different event types while each stays correlated (name <-> args).
export const events: AnyEvent[] = [ready, interactionCreate];
