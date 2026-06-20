import type {GuildMember} from "discord.js";

/** True if `a`'s highest role is strictly above `b`'s. */
export function guildMemberIsAbove(a: GuildMember, b: GuildMember): boolean {
    return a.roles.highest.comparePositionTo(b.roles.highest) > 0;
}