import { randomBytes } from 'node:crypto'
import { devToolsMiddleware } from '@ai-sdk/devtools'
import type {
  LanguageModelV4,
  LanguageModelV4Middleware,
} from '@ai-sdk/provider'
import {
  type BrowserOutputFileAccess,
  createBrowserOutputFileAccess,
} from '@browseros/browser-mcp/output-file'
import { AGENT_LIMITS } from '@browseros/shared/constants/limits'
import type { BrowserContext } from '@browseros/shared/schemas/browser-context'
import {
  type LanguageModel,
  type ModelMessage,
  stepCountIs,
  ToolLoopAgent,
  type ToolSet,
  type UIMessage,
  wrapLanguageModel,
} from 'ai'
import { z } from 'zod'
import { logger } from '../lib/logger'
import { metrics } from '../lib/metrics'
import { buildFilesystemToolSet } from '../tools/filesystem/build-toolset'
import { createReadTool } from '../tools/filesystem/read'
import {
  type PinnedWorkspaceRoot,
  pinWorkspaceRoot,
} from '../tools/filesystem/safe-file'
import { decideActionPolicy } from './action-policy'
import { createCompactionPrepareStep, type StepWithUsage } from './compaction'
import {
  buildAgentToolCatalog,
  excludeRawPageCodeTools,
} from './credential-tool-filter'
import {
  buildInternalBrowserMcpSpec,
  buildMcpServerSpecs,
  createMcpClients,
} from './mcp-builder'
import {
  getMessageNormalizationOptions,
  normalizeMessagesForModel,
  stripReasoningFromModelMessages,
} from './message-normalization'
import { buildNudgeToolSet } from './nudge-tools'
import { buildSystemPrompt } from './prompt'
import {
  createLanguageModel,
  serializesReasoningContent,
} from './provider-factory'
import { buildAgentReasoningConfig } from './reasoning-config'
import { captureSuccessfulBuiltInRead } from './research-support-assessment'
import {
  AgentToolCallEnvelopeSchema,
  AgentToolResultEnvelopeSchema,
} from './task-contract'
import type { ResolvedAgentConfig } from './types'

// Approval signatures are process-scoped. A restart invalidates an unresolved
// approval, so recovered tasks cannot execute an action approved by stale UI.
const TOOL_APPROVAL_SECRET = randomBytes(32)
export interface AgentToolCallOptions {
  taskId: string
  assessResearchSupport?: boolean
}

/** The server-side approval check shared by production agents and fixture tests. */
export async function handleToolApproval({
  toolCall,
  tools: availableTools,
}: {
  toolCall: { toolName: string; input: unknown }
  tools?: ToolSet
}) {
  const tool = availableTools?.[toolCall.toolName] as
    | { description?: string }
    | undefined
  const decision = await decideActionPolicy({
    toolName: toolCall.toolName,
    input: toolCall.input,
    description: tool?.description,
  })
  if (decision.decision === 'deny') {
    return {
      type: 'denied' as const,
      reason: 'Blocked by the saved action policy.',
    }
  }
  if (decision.decision === 'ask') {
    return {
      type: 'user-approval' as const,
      reason: decision.reason ?? 'Review this action before it runs.',
    }
  }
  return undefined
}

export interface AiSdkAgentConfig {
  resolvedConfig: ResolvedAgentConfig
  serverPort: number
  browserToolLeaseToken: string
  browserContext?: BrowserContext
  browserosId?: string
  aiSdkDevtoolsEnabled?: boolean
  outputFileAccess?: BrowserOutputFileAccess
  resourcesDir?: string | null
  /** Override the workspace pin operation for lifecycle tests and embedders. */
  pinWorkspaceRoot?: typeof pinWorkspaceRoot
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function summarizeToolInput(input: unknown): Record<string, unknown> {
  if (!isRecord(input)) {
    return { inputType: typeof input }
  }
  const summary: Record<string, unknown> = {
    argKeys: Object.keys(input).sort(),
  }
  if (typeof input.server_name === 'string') {
    summary.serverName = input.server_name
  }
  if (typeof input.path === 'string') {
    summary.path = input.path
  }
  if (typeof input.page === 'number') {
    summary.page = input.page
  }
  if (typeof input.action === 'string') {
    summary.action = input.action
  }
  return summary
}

function toolResultIsError(result: unknown): boolean {
  return isRecord(result) && result.isError === true
}

function summarizeToolResultError(
  result: unknown,
): Record<string, unknown> | undefined {
  if (!isRecord(result) || !Array.isArray(result.content)) {
    return undefined
  }
  const textBlocks = result.content
    .filter(
      (item): item is { type: 'text'; text: string } =>
        typeof item === 'object' &&
        item !== null &&
        'type' in item &&
        item.type === 'text' &&
        'text' in item &&
        typeof item.text === 'string',
    )
    .map((item) => item.text)
  const text = textBlocks.join('\n')
  return {
    contentCount: result.content.length,
    textBlockCount: textBlocks.length,
    textLength: text.length,
    lineCount: text.length ? text.split('\n').length : 0,
  }
}

const AgentToolRunContextSchema = z
  .object({
    taskId: z.string().uuid(),
    assessResearchSupport: z.boolean().optional(),
  })
  .strict()

export function buildAgentToolRunContexts(
  tools: ToolSet,
  taskId: string,
  assessResearchSupport = false,
): Record<string, { taskId: string; assessResearchSupport?: boolean }> {
  return Object.fromEntries(
    Object.entries(tools)
      .filter(([, tool]) => tool.contextSchema !== undefined)
      .map(([toolName]) => [toolName, { taskId, assessResearchSupport }]),
  )
}

/** Add a per-call task identity to each tool's execution context and validate
 * the versioned transport envelope at the actual dispatch/result boundary. */
export function addToolEnvelopeBoundary(tools: ToolSet): ToolSet {
  const wrapped: ToolSet = {}
  for (const [toolName, tool] of Object.entries(tools)) {
    if (!tool.execute) {
      wrapped[toolName] = tool
      continue
    }
    // No current production tool has its own execution context. Refuse to
    // replace one silently: doing so would change the tool's dispatch inputs.
    if (tool.contextSchema !== undefined) {
      throw new Error(`Tool ${toolName} already defines an execution context`)
    }
    const execute = tool.execute
    wrapped[toolName] = {
      ...tool,
      contextSchema: AgentToolRunContextSchema,
      execute: async (input, options) => {
        const context = AgentToolRunContextSchema.parse(options.context)
        const callId = crypto.randomUUID()
        const call = AgentToolCallEnvelopeSchema.parse({
          version: 1,
          taskId: context.taskId,
          // Provider call IDs are deliberately not copied into this envelope.
          toolCallId: callId,
          toolName,
          input,
        })
        let output: unknown
        try {
          // The envelope is validated here but its payload remains byte-for-
          // byte/identity equivalent to the input the tool normally receives.
          output = await execute(call.input, {
            ...options,
            context: undefined,
          })
        } catch (error) {
          AgentToolResultEnvelopeSchema.parse({
            version: 1,
            taskId: call.taskId,
            toolCallId: call.toolCallId,
            toolName: call.toolName,
            ok: false,
            errorCode: 'tool_execution_error',
          })
          throw error
        }
        const isError = toolResultIsError(output)
        if (!isError && context.assessResearchSupport && toolName === 'read') {
          captureSuccessfulBuiltInRead(context.taskId, output)
        }
        const result = AgentToolResultEnvelopeSchema.parse(
          isError
            ? {
                version: 1,
                taskId: call.taskId,
                toolCallId: call.toolCallId,
                toolName: call.toolName,
                ok: false,
                errorCode: 'tool_execution_error',
              }
            : {
                version: 1,
                taskId: call.taskId,
                toolCallId: call.toolCallId,
                toolName: call.toolName,
                ok: true,
                output,
              },
        )
        // The provider sees exactly the original tool result, not the envelope.
        return isError ? output : result.output
      },
    }
  }
  return wrapped
}

/** Builds filesystem tools for model-backed sessions, with scoped readback outside full workspace mode. */
export function buildAgentFilesystemToolSet(
  resolvedConfig: ResolvedAgentConfig,
  options: {
    outputFileAccess?: BrowserOutputFileAccess
    resourcesDir?: string | null
    workspaceRoot?: PinnedWorkspaceRoot
  } = {},
): ToolSet {
  if (resolvedConfig.chatMode || !resolvedConfig.workingDir) {
    return {
      filesystem_read: createReadTool(undefined, {
        allowedOutputPaths: options.outputFileAccess?.paths,
      }),
    }
  }
  return buildFilesystemToolSet(resolvedConfig.workingDir, {
    resourcesDir: options.resourcesDir,
    workspaceRoot: options.workspaceRoot,
    readOnly: resolvedConfig.permissionMode === 'read-only',
  })
}

export class AiSdkAgent {
  private constructor(
    private _agent: ToolLoopAgent<AgentToolCallOptions, ToolSet>,
    private _messages: UIMessage[],
    private _mcpClients: Array<{ close(): Promise<void> }>,
    private conversationId: string,
    private _toolNames: Set<string>,
    private workspaceRoot?: PinnedWorkspaceRoot,
  ) {}

  /** Tool names registered on this agent — used to sanitize messages during session rebuilds. */
  get toolNames(): Set<string> {
    return this._toolNames
  }

  /** Build contexts per invocation; run identity is never retained on the cached agent. */
  getToolRunContexts(
    taskId: string,
    assessResearchSupport = false,
  ): Record<string, { taskId: string; assessResearchSupport?: boolean }> {
    return buildAgentToolRunContexts(
      this._agent.tools,
      taskId,
      assessResearchSupport,
    )
  }

  static async create(config: AiSdkAgentConfig): Promise<AiSdkAgent> {
    const contextWindow =
      config.resolvedConfig.contextWindowSize ??
      AGENT_LIMITS.DEFAULT_CONTEXT_WINDOW

    const { model: rawModel } = await createLanguageModel(config.resolvedConfig)
    const isV4Model =
      typeof rawModel === 'object' &&
      rawModel !== null &&
      'specificationVersion' in rawModel &&
      rawModel.specificationVersion === 'v4'

    let model = rawModel
    if (isV4Model && config.aiSdkDevtoolsEnabled) {
      model = wrapLanguageModel({
        model: rawModel as LanguageModelV4,
        middleware: devToolsMiddleware() as LanguageModelV4Middleware,
      })
      logger.info('AI SDK DevTools middleware enabled', {
        conversationId: config.resolvedConfig.conversationId,
        provider: config.resolvedConfig.provider,
        model: config.resolvedConfig.model,
      })
    }

    const outputFileAccess =
      config.outputFileAccess ?? createBrowserOutputFileAccess()

    const connectedMcpClients: Array<{ close(): Promise<void> }> = []
    let clientsTransferred = false
    let workspaceRoot: PinnedWorkspaceRoot | undefined
    try {
      if (!config.resolvedConfig.chatMode && config.resolvedConfig.workingDir) {
        workspaceRoot = await (config.pinWorkspaceRoot ?? pinWorkspaceRoot)(
          config.resolvedConfig.workingDir,
        )
      }
      // BrowserOS tools and managed connectors use the same required loopback
      // MCP path as ACP/external clients. This keeps guards, effects, metrics,
      // and generated-output grants behind one server-owned seam.
      const internalSpec = buildInternalBrowserMcpSpec({
        serverPort: config.serverPort,
        leaseToken: config.browserToolLeaseToken,
        readOnly:
          config.resolvedConfig.chatMode ||
          config.resolvedConfig.permissionMode === 'read-only',
      })
      const internalMcp = await createMcpClients([internalSpec])
      connectedMcpClients.push(...internalMcp.clients)
      const restrictedInternalMcp = excludeRawPageCodeTools(internalMcp.tools)
      const reservedInternalToolNames = new Set(Object.keys(internalMcp.tools))

      // Arbitrary custom MCP servers do not provide a server-enforced
      // read-only capability, so omit them entirely in Read-only mode.
      const customSpecs =
        config.resolvedConfig.permissionMode === 'read-only' ||
        config.resolvedConfig.chatMode
          ? []
          : await buildMcpServerSpecs({
              browserContext: config.browserContext,
            })
      const customMcp = await createMcpClients(customSpecs)
      connectedMcpClients.push(...customMcp.clients)
      const rawExternalMcpTools = withoutReservedInternalToolNames(
        customMcp.tools,
        reservedInternalToolNames,
      )

      // Custom MCP servers remain outside BrowserMcpModule, so their metrics
      // stay at this adapter boundary. Managed connectors arrive through the
      // internal MCP client and are already instrumented server-side.
      const externalMcpTools: ToolSet = {}
      for (const [name, t] of Object.entries(rawExternalMcpTools)) {
        const originalExecute = t.execute
        externalMcpTools[name] = {
          ...t,
          execute: originalExecute
            ? async (
                ...args: Parameters<NonNullable<typeof originalExecute>>
              ) => {
                const startTime = performance.now()
                const logBase = {
                  toolName: name,
                  source: 'chat',
                  conversationId: config.resolvedConfig.conversationId,
                  provider: config.resolvedConfig.provider,
                }
                logger.debug('External MCP chat tool started', {
                  ...logBase,
                  args: summarizeToolInput(args[0]),
                })
                try {
                  const result = await originalExecute(...args)
                  const durationMs = Math.round(performance.now() - startTime)
                  const isError = toolResultIsError(result)
                  metrics.log('tool_executed', {
                    tool_name: name,
                    duration_ms: durationMs,
                    success: !isError,
                    source: 'chat',
                  })
                  logger.debug('External MCP chat tool completed', {
                    ...logBase,
                    durationMs,
                    isError,
                  })
                  if (isError) {
                    logger.info('External MCP chat tool returned error', {
                      ...logBase,
                      durationMs,
                      errorSummary: summarizeToolResultError(result),
                    })
                  }
                  return result
                } catch (error) {
                  const errorText =
                    error instanceof Error ? error.message : String(error)
                  const durationMs = Math.round(performance.now() - startTime)
                  metrics.log('tool_executed', {
                    tool_name: name,
                    duration_ms: durationMs,
                    success: false,
                    error_message: errorText,
                    source: 'chat',
                  })
                  logger.info('External MCP chat tool threw', {
                    ...logBase,
                    durationMs,
                    error: errorText,
                  })
                  throw error
                }
              }
            : undefined,
        }
      }

      const filesystemTools = buildAgentFilesystemToolSet(
        config.resolvedConfig,
        {
          outputFileAccess,
          resourcesDir: config.resourcesDir,
          workspaceRoot,
        },
      )
      const workspaceDirForPrompt =
        !config.resolvedConfig.chatMode &&
        config.resolvedConfig.permissionMode !== 'read-only' &&
        'filesystem_write' in filesystemTools
          ? (workspaceRoot?.path ?? config.resolvedConfig.workingDir)
          : undefined
      const candidateTools = {
        ...restrictedInternalMcp.allowed,
        ...externalMcpTools,
        ...filesystemTools,
        ...buildNudgeToolSet(),
      }
      const filtered = buildAgentToolCatalog(candidateTools)
      const tools = addToolEnvelopeBoundary(filtered.tools)
      const blockedToolNames = [
        ...new Set([...restrictedInternalMcp.blocked, ...filtered.blocked]),
      ]
      if (blockedToolNames.length > 0) {
        logger.warn('Restricted tools excluded from agent catalog', {
          count: blockedToolNames.length,
          toolNames: blockedToolNames,
        })
      }

      if (
        config.resolvedConfig.isScheduledTask ||
        config.resolvedConfig.chatMode
      ) {
        delete tools.suggest_schedule
        delete tools.suggest_app_connection
      }

      // Build system prompt with optional section exclusions
      const excludeSections: string[] = []
      if (
        config.resolvedConfig.isScheduledTask ||
        config.resolvedConfig.chatMode
      ) {
        excludeSections.push('nudges')
      }
      if (config.resolvedConfig.permissionMode === 'read-only') {
        excludeSections.push('external-integrations')
      }
      const instructions = buildSystemPrompt({
        userSystemPrompt: config.resolvedConfig.userSystemPrompt,
        exclude: excludeSections,
        isScheduledTask: config.resolvedConfig.isScheduledTask,
        scheduledTaskPageId: config.browserContext?.activeTab?.pageId,
        workspaceDir: workspaceDirForPrompt,
        chatMode: config.resolvedConfig.chatMode,
        permissionMode: config.resolvedConfig.permissionMode,
        connectedApps: config.browserContext?.enabledMcpServers,
        declinedApps: config.resolvedConfig.declinedApps,
        origin: config.resolvedConfig.origin,
        generatedOutputReadAvailable: 'filesystem_read' in filesystemTools,
      })

      // Configure compaction for context window management
      const compactionPrepareStep = createCompactionPrepareStep({
        contextWindow,
      })
      const normalizationOptions = getMessageNormalizationOptions(
        config.resolvedConfig,
      )
      const stripReplayedReasoning = serializesReasoningContent(
        config.resolvedConfig.provider,
      )
      const prepareStep = async (options: {
        messages: ModelMessage[]
        steps: ReadonlyArray<StepWithUsage>
        model: LanguageModel
        runtimeContext: unknown
      }) => {
        let messages = normalizeMessagesForModel(
          options.messages,
          normalizationOptions,
        )
        if (stripReplayedReasoning) {
          messages = stripReasoningFromModelMessages(messages)
        }
        return compactionPrepareStep({ ...options, messages })
      }

      const agent = new ToolLoopAgent<AgentToolCallOptions, ToolSet>({
        model,
        instructions,
        tools,
        toolApproval: handleToolApproval,
        experimental_toolApprovalSecret: TOOL_APPROVAL_SECRET,
        stopWhen: [stepCountIs(AGENT_LIMITS.MAX_TURNS)],
        prepareStep,
        prepareCall: ({ options, ...call }) => ({
          ...call,
          toolsContext: buildAgentToolRunContexts(
            tools,
            options.taskId,
            options.assessResearchSupport,
          ),
        }),
        ...buildAgentReasoningConfig(config.resolvedConfig),
      })

      logger.info('Agent session created (v2)', {
        conversationId: config.resolvedConfig.conversationId,
        provider: config.resolvedConfig.provider,
        model: config.resolvedConfig.model,
        toolCount: Object.keys(tools).length,
      })

      const result = new AiSdkAgent(
        agent,
        [],
        connectedMcpClients,
        config.resolvedConfig.conversationId,
        new Set(Object.keys(tools)),
        workspaceRoot,
      )
      clientsTransferred = true
      return result
    } finally {
      // Before the AiSdkAgent is returned, this factory owns every connected
      // transport. Close them if prompt/tool construction fails midway.
      if (!clientsTransferred) {
        await Promise.allSettled(
          connectedMcpClients.map((client) => client.close()),
        )
        await workspaceRoot?.close()
      }
    }
  }

  get toolLoopAgent(): ToolLoopAgent<AgentToolCallOptions, ToolSet> {
    return this._agent
  }

  get messages(): UIMessage[] {
    return this._messages
  }

  set messages(msgs: UIMessage[]) {
    this._messages = msgs
  }

  appendUserMessage(content: string): void {
    this._messages.push({
      id: crypto.randomUUID(),
      role: 'user',
      parts: [{ type: 'text', text: content }],
    })
  }

  async dispose(): Promise<void> {
    for (const client of this._mcpClients) {
      await client.close().catch(() => {})
    }
    await this.workspaceRoot?.close()
    logger.info('Agent disposed', { conversationId: this.conversationId })
  }
}

function withoutReservedInternalToolNames(
  tools: ToolSet,
  reservedNames: Set<string>,
): ToolSet {
  const result: ToolSet = {}
  const skipped: string[] = []
  for (const [name, value] of Object.entries(tools)) {
    if (reservedNames.has(name)) {
      skipped.push(name)
      continue
    }
    result[name] = value
  }
  if (skipped.length > 0) {
    logger.warn(
      'External MCP tools skipped due to BrowserOS tool name collision',
      {
        toolNames: skipped,
      },
    )
  }
  return result
}

export { formatUserMessage } from './format-message'
