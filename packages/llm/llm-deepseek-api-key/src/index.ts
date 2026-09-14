/** API-key authentication and discovery for the official DeepSeek route. */
import type { Context } from '@deepseek-ai/cordis'
import { assertUsableApiKey, LlmError } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import { registerDeepSeekProvider, catalogModelInfo, discoverDeepSeekModels } from '@deepseek-ai/dsh-llm-deepseek'
import { Config, plainOptions, resolveAdapterOptions } from './config.ts'
import type { ResolvedDeepSeekOptions } from './config.ts'

export { Config, plainOptions, resolveAdapterOptions } from './config.ts'
export type { Options, ResolvedDeepSeekOptions } from './config.ts'
export const name = 'llm-deepseek-api-key'
export const inject = ['llm']

const PROVIDER = 'deepseek-official'

export function apply(ctx: Context, config: Config): void {
  const options = () => resolveAdapterOptions(plainOptions(config), launchEnvironmentOf(ctx))
  options()
  const settingsNs = ctx.fiber.entry?.options.id ?? name
  const resolveApiKey = async (connection: ResolvedDeepSeekOptions): Promise<string> => {
    const ref = connection.apiKeyEnv
    const credentials = ctx.get('credentials')
    if (credentials !== undefined) {
      const hit = await credentials.resolve(ref)
      if (hit !== undefined) return assertUsableApiKey(hit.value, 'llm-deepseek', ref)
    } else {
      const ambient = launchEnvironmentOf(ctx).get(ref)
      if (ambient !== undefined && ambient.value.length > 0) return assertUsableApiKey(ambient.value, 'llm-deepseek', ref)
    }
    throw new LlmError(
      `llm-deepseek: no API key for provider route "${PROVIDER}"; store ${ref} through the credentials`
      + ` service (the web Models page writes it), or export ${ref} in the launching environment`,
      'MISSING_CREDENTIAL',
    )
  }
  /**
   * Resolve the credential a discovery probe sends, or undefined when the
   * deployment supplies none: an endpoint on a private network may answer an
   * unauthenticated listing, and refusing before asking would hide that.
   * @param connection - the resolved facts of the route being interrogated.
   * @returns the credential to send, or undefined to probe without one.
   */
  const resolveDiscoveryKey = async (connection: ResolvedDeepSeekOptions): Promise<string | undefined> => {
    const ref = connection.apiKeyEnv
    const credentials = ctx.get('credentials')
    const stored = credentials === undefined ? undefined : (await credentials.resolve(ref))?.value
    const ambient = stored ?? launchEnvironmentOf(ctx).get(ref)?.value
    return ambient === undefined || ambient.length === 0 ? undefined : ambient
  }
  ctx.llm.registerConfigurableProviders([
    { provider: PROVIDER, displayName: 'DeepSeek', settingsNs, settingsPath: [] },
  ])
  registerDeepSeekProvider(ctx, PROVIDER, {
    options, providerName: 'DeepSeek',
    resolveAuth: async connection => ({ headers: { 'x-api-key': await resolveApiKey(connection) } }),
    discoverModels: (provider) => {
      const connection = options()
      return Promise.resolve(connection.models.map(model => catalogModelInfo(provider, model)))
    },
  })
  // Discovery serves the whole namespace rather than one route: a configuration
  // surface asks about the endpoint this plugin already resolves, and a draft
  // the user is still editing overrides it in the request. The reply is
  // candidate metadata the surface offers for adoption; nothing writes settings
  // from here.
  ctx.llm.registerModelDiscovery(settingsNs, (request, signal) => discoverDeepSeekModels(
    {
      baseURL: request.baseURL ?? options().baseURL,
      resolveApiKey: () => request.apiKey === undefined
        ? resolveDiscoveryKey(options())
        : Promise.resolve(request.apiKey),
    },
    signal,
  ))
}
