import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { CrossTalkClient } from '../client/sdk.js';
import { DIALECT_V1 } from '../dialect/dictionary.js';
import { DialectEngine } from '../dialect/engine.js';
const agentName = process.env.CROSSTALK_AGENT_NAME || 'Antigravity-Agent';
const agentRole = process.env.CROSSTALK_AGENT_ROLE || 'pair-programmer';
const crosstalkUrl = process.env.CROSSTALK_URL || 'ws://localhost:4488';
const crosstalkChannel = process.env.CROSSTALK_CHANNEL || 'default';
let client = null;
async function getClient() {
    if (client)
        return client;
    client = new CrossTalkClient({
        url: crosstalkUrl,
        channel: crosstalkChannel,
        name: agentName,
        role: agentRole,
        environment: 'ide',
        workspace: process.cwd(),
        currentTask: 'Ready in IDE conversation'
    });
    try {
        await client.connect();
    }
    catch (err) {
        console.error(`[crosstalk-mcp] Warning: Could not connect to hub at ${crosstalkUrl}: ${err.message}`);
    }
    return client;
}
const TOOLS = [
    {
        name: 'crosstalk_check_mesh',
        description: 'Check active AI agents on the CrossTalk network, what they are currently working on, and all active file locks.',
        inputSchema: {
            type: 'object',
            properties: {},
            required: []
        }
    },
    {
        name: 'crosstalk_get_dialect_dictionary',
        description: 'Fetch the versioned XDialect shorthand dictionary (v1.0.0). Contains token codes (!LCK, !REL, #REF, &WAIT), bitfield definitions, and grammar for ultra-concise lossless agent-to-agent communication.',
        inputSchema: {
            type: 'object',
            properties: {},
            required: []
        }
    },
    {
        name: 'crosstalk_send_shorthand',
        description: 'Send a high-density, lossless XDialect shorthand message to the agent mesh (e.g. `!LCK @src/auth.ts #REF "jwt logic" &WAIT`). Automatically translates to English for humans while transmitting as compact bits across agents.',
        inputSchema: {
            type: 'object',
            properties: {
                shorthand: {
                    type: 'string',
                    description: 'Concise XDialect expression, e.g. `!LCK @src/auth.ts #REF "jwt tokens" ~180 &WAIT`'
                }
            },
            required: ['shorthand']
        }
    },
    {
        name: 'crosstalk_announce',
        description: 'Broadcast an announcement or status update to all connected agents on the mesh (e.g. "Starting refactor of authentication" or "Feature complete").',
        inputSchema: {
            type: 'object',
            properties: {
                task: {
                    type: 'string',
                    description: 'Description of what you are working on or announcing to other agents'
                },
                status: {
                    type: 'string',
                    enum: ['working', 'idle', 'waiting'],
                    description: 'Your current operational status'
                }
            },
            required: ['task']
        }
    },
    {
        name: 'crosstalk_lock_file',
        description: 'Acquire a cooperative file lock before editing a file to prevent other agents from modifying it simultaneously. If another agent holds it, returns conflict details.',
        inputSchema: {
            type: 'object',
            properties: {
                filePath: {
                    type: 'string',
                    description: 'The path of the file you want to lock before editing'
                },
                reason: {
                    type: 'string',
                    description: 'Explanation of what you are changing so other agents know why it is locked'
                },
                ttlSeconds: {
                    type: 'number',
                    description: 'Duration to hold the lock in seconds (default: 300)'
                }
            },
            required: ['filePath', 'reason']
        }
    },
    {
        name: 'crosstalk_unlock_file',
        description: 'Release a previously claimed file lock after completing your edits.',
        inputSchema: {
            type: 'object',
            properties: {
                filePath: {
                    type: 'string',
                    description: 'The file path to release'
                }
            },
            required: ['filePath']
        }
    },
    {
        name: 'crosstalk_send_message',
        description: 'Send a direct message to a specific agent on the mesh to coordinate tasks, request lock handoffs, or avoid collisions.',
        inputSchema: {
            type: 'object',
            properties: {
                toAgent: {
                    type: 'string',
                    description: 'The ID or name of the agent you want to message'
                },
                message: {
                    type: 'string',
                    description: 'The content of your message'
                }
            },
            required: ['toAgent', 'message']
        }
    },
    {
        name: 'crosstalk_read_inbox',
        description: 'Check unread messages, mentions, or file conflict alerts sent directly to you by other agents.',
        inputSchema: {
            type: 'object',
            properties: {},
            required: []
        }
    }
];
export async function runMcpServer() {
    const server = new Server({
        name: 'crosstalk-mcp',
        version: '1.0.0'
    }, {
        capabilities: {
            tools: {}
        }
    });
    server.setRequestHandler(ListToolsRequestSchema, async () => {
        return { tools: TOOLS };
    });
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
        const { name, arguments: args } = request.params;
        const c = await getClient();
        try {
            switch (name) {
                case 'crosstalk_get_dialect_dictionary': {
                    return {
                        content: [
                            {
                                type: 'text',
                                text: JSON.stringify(DIALECT_V1, null, 2)
                            }
                        ]
                    };
                }
                case 'crosstalk_send_shorthand': {
                    const shorthand = String(args?.shorthand || '');
                    const parsed = DialectEngine.parse(shorthand);
                    const human = DialectEngine.toHuman(parsed);
                    const bits = DialectEngine.packToBits(parsed);
                    c.sendShorthand(shorthand);
                    return {
                        content: [
                            {
                                type: 'text',
                                text: `SUCCESS: Dispatched XDialect shorthand "${shorthand}" (${bits.length} wire bytes).\nHuman translation: "${human}"`
                            }
                        ]
                    };
                }
                case 'crosstalk_check_mesh': {
                    const state = await c.getMeshState();
                    return {
                        content: [
                            {
                                type: 'text',
                                text: JSON.stringify({
                                    myAgentId: c.agentId,
                                    dialectVersion: c.dialect.version,
                                    connectedAgents: state.agents.map((a) => ({
                                        id: a.id,
                                        name: a.name,
                                        role: a.role,
                                        status: a.status,
                                        currentTask: a.currentTask,
                                        lockedFiles: a.lockedFiles
                                    })),
                                    activeLocks: state.locks.map((l) => ({
                                        file: l.file,
                                        holderName: l.holderName,
                                        reason: l.reason,
                                        expiresInSeconds: Math.max(0, Math.round((l.expiresAt - Date.now()) / 1000))
                                    }))
                                }, null, 2)
                            }
                        ]
                    };
                }
                case 'crosstalk_announce': {
                    const task = String(args?.task || '');
                    const status = args?.status || 'working';
                    c.updateTask(task, status);
                    c.broadcast(`[ANNOUNCEMENT] ${task}`);
                    return {
                        content: [
                            {
                                type: 'text',
                                text: `Broadcast sent to mesh: "${task}". Status updated to ${status}.`
                            }
                        ]
                    };
                }
                case 'crosstalk_lock_file': {
                    const filePath = String(args?.filePath || '');
                    const reason = String(args?.reason || 'Editing file');
                    const ttl = Number(args?.ttlSeconds || 300);
                    const res = await c.lockFile(filePath, reason, ttl);
                    if (res.success) {
                        return {
                            content: [
                                {
                                    type: 'text',
                                    text: `SUCCESS: Lock acquired on "${filePath}". Other agents have been notified not to touch it while you are working. Reason: "${reason}".`
                                }
                            ]
                        };
                    }
                    else {
                        return {
                            content: [
                                {
                                    type: 'text',
                                    text: `LOCK REJECTED: File "${filePath}" is already held by agent "${res.holder?.name || 'Unknown'}" (Reason: "${res.reason}"). Please wait or message them with crosstalk_send_message before editing.`
                                }
                            ]
                        };
                    }
                }
                case 'crosstalk_unlock_file': {
                    const filePath = String(args?.filePath || '');
                    c.unlockFile(filePath);
                    return {
                        content: [
                            {
                                type: 'text',
                                text: `SUCCESS: File "${filePath}" has been released and unlocked for other agents.`
                            }
                        ]
                    };
                }
                case 'crosstalk_send_message': {
                    const toAgent = String(args?.toAgent || '');
                    const message = String(args?.message || '');
                    const state = await c.getMeshState();
                    const target = state.agents.find((a) => a.id === toAgent || a.name.toLowerCase() === toAgent.toLowerCase());
                    const targetId = target ? target.id : toAgent;
                    c.sendDirectMessage(targetId, message);
                    return {
                        content: [
                            {
                                type: 'text',
                                text: `Direct message delivered to ${target?.name || targetId}: "${message}"`
                            }
                        ]
                    };
                }
                case 'crosstalk_read_inbox': {
                    const inbox = await c.fetchInbox(0);
                    return {
                        content: [
                            {
                                type: 'text',
                                text: JSON.stringify(inbox, null, 2)
                            }
                        ]
                    };
                }
                default:
                    throw new Error(`Unknown tool: ${name}`);
            }
        }
        catch (err) {
            return {
                isError: true,
                content: [
                    {
                        type: 'text',
                        text: `CrossTalk error: ${err.message}`
                    }
                ]
            };
        }
    });
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('[crosstalk-mcp] MCP server running on stdio transport.');
}
if (process.argv[1] && (process.argv[1].endsWith('mcp/server.ts') || process.argv[1].endsWith('mcp/server.js'))) {
    runMcpServer().catch((err) => {
        console.error('[crosstalk-mcp] Fatal error:', err);
        process.exit(1);
    });
}
