import type {Awaitable, ClientEvents} from "discord.js";

/**
 * An event handler. `name` is a discord.js client event; `execute` receives
 * exactly that event's arguments, fully typed via ClientEvents[Name].
 * `once` controls client.on vs client.once.
 */
export interface Event<Name extends keyof ClientEvents = keyof ClientEvents> {
    name: Name;
    once?: boolean;

    execute(...args: ClientEvents[Name]): Awaitable<void>;
}

/**
 * Identity helper that pins an event's generic at the definition site while
 * letting the registry hold a mix of event types. Define events with this
 * instead of annotating `: Event<...>`, and the registry array stays typed
 * with no `any`.
 */
export function defineEvent<Name extends keyof ClientEvents>(
    event: Event<Name>,
): Event<Name> {
    return event;
}

/** A registered event with its specific name/args correlated. */
export type AnyEvent = {
    [Name in keyof ClientEvents]: Event<Name>;
}[keyof ClientEvents];
