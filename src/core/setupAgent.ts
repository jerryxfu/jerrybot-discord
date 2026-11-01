import Anthropic from "@anthropic-ai/sdk";
import {AGENT_MULTIAGENT, AGENT_NAME, AGENT_TOOLS, EFFORT, MODEL, SYSTEM_PROMPT} from "../chat/config.js";
import {CUSTOM_TOOLS} from "../chat/tools.js";

/**
 * One-time setup for the chat agent, run with `pnpm agent:setup`.
 *
 * - No CHAT_ENVIRONMENT_ID: creates the sandbox environment.
 * - No CHAT_AGENT_ID: creates the agent. Otherwise updates it to match
 *   chat/config.ts (a new version; running conversations keep the old one).
 *
 * Paste any printed IDs into .env.
 */
const client = new Anthropic();

const environmentId = process.env.CHAT_ENVIRONMENT_ID;
if (!environmentId) {
    const environment = await client.beta.environments.create({
        name: "jerrybot-chat",
        // Unrestricted so web search covers every site and the sandbox can
        // clone any public repo. Keep secrets out of the sandbox.
        config: {type: "cloud", networking: {type: "unrestricted"}},
    });
    console.log(`Created environment. Add to .env:\nCHAT_ENVIRONMENT_ID=${environment.id}\n`);
} else {
    console.log(`Using environment ${environmentId}.`);
}

const definition: Anthropic.Beta.AgentCreateParams = {
    name: AGENT_NAME,
    model: {id: MODEL, effort: EFFORT},
    system: SYSTEM_PROMPT,
    tools: [...AGENT_TOOLS, ...CUSTOM_TOOLS],
    multiagent: AGENT_MULTIAGENT,
};

const agentId = process.env.CHAT_AGENT_ID;
if (!agentId) {
    const agent = await client.beta.agents.create(definition);
    console.log(`Created agent (version ${agent.version}). Add to .env:\nCHAT_AGENT_ID=${agent.id}`);
} else {
    const agent = await client.beta.agents.update(agentId, definition);
    console.log(`Updated agent ${agent.id} to version ${agent.version}.`);
}
