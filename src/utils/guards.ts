import type {ChatInputCommandInteraction, GuildMember, PermissionResolvable,} from "discord.js";
import {MessageFlags, PermissionFlagsBits} from "discord.js";

/**
 * Guards are small checks that live at the top of a command's execute().
 *
 * Contract: a guard returns `true` if the command should STOP (the guard has
 * already sent an ephemeral reply explaining why)
 */

/** Sends an ephemeral reply, used internally by the guards. */
async function reject(
    interaction: ChatInputCommandInteraction,
    content: string,
): Promise<true> {
    await interaction.reply({content, flags: MessageFlags.Ephemeral});
    return true;
}

/**
 * Stops if the command was used outside a cached guild (e.g. in DMs).
 * On success, the interaction is narrowed for the caller via the type guard.
 */
export async function failsInGuild(
    interaction: ChatInputCommandInteraction,
    message = "This command can only be used in a server.",
): Promise<boolean> {
    if (!interaction.inCachedGuild()) {
        return reject(interaction, message);
    }
    return false;
}

/** Stops if the invoking member lacks the given permission(s). */
export async function failsPermission(
    interaction: ChatInputCommandInteraction,
    member: GuildMember,
    permission: PermissionResolvable,
    message = "You don't have permission to use this command.",
): Promise<boolean> {
    if (!member.permissions.has(permission)) {
        return reject(interaction, message);
    }
    return false;
}

/** Stops if `member` is NOT strictly above `target` in role hierarchy. */
export async function failsHierarchy(
    interaction: ChatInputCommandInteraction,
    member: GuildMember,
    target: GuildMember,
    message = "You cannot target someone with an equal or higher role.",
): Promise<boolean> {
    if (!guildMemberIsAbove(member, target)) {
        return reject(interaction, message);
    }
    return false;
}

/** Stops if `a.id === b.id`, i.e. the user is targeting themselves. */
export async function failsSelfTarget(
    interaction: ChatInputCommandInteraction,
    selfId: string,
    targetId: string,
    message = "You cannot target yourself.",
): Promise<boolean> {
    if (selfId === targetId) {
        return reject(interaction, message);
    }
    return false;
}

/** True if `a`'s highest role is strictly above `b`'s. */
export function guildMemberIsAbove(a: GuildMember, b: GuildMember): boolean {
    return a.roles.highest.comparePositionTo(b.roles.highest) > 0;
}

// Per user allowlist
const SUDO_IDS = [
    "611633988515266562", // jerryxf
];

// Per-guild role allowlist: members with any of these roles can use sudo commands
const SUDO_ROLES: Record<string, string[]> = {
    "631939549332897842": [ // jerry server
        "642107004076163103", // sudo
    ],
};

export async function failsSudo(
    interaction: ChatInputCommandInteraction,
    message = "You're not allowed to use this command.",
): Promise<boolean> {
    const app = await interaction.client.application.fetch();
    const ownerId = app.owner && "id" in app.owner ? app.owner.id : null;
    const allowedUsers = [ownerId, ...SUDO_IDS].filter((id): id is string => Boolean(id));

    // Owner or explicitly-listed user
    if (allowedUsers.includes(interaction.user.id)) {
        return false;
    }

    // Role-based
    if (interaction.inCachedGuild()) {
        const guildRoles = SUDO_ROLES[interaction.guildId];
        if (guildRoles && interaction.member.roles.cache.hasAny(...guildRoles)) {
            return false;
        }
    }

    // Denied.
    await interaction.reply({content: message, flags: MessageFlags.Ephemeral});
    return true;
}

export {PermissionFlagsBits};
