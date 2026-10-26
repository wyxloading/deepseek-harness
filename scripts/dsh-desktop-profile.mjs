/** Inherit the web profile's plugins and patch layer into the Desktop profile. */

import { copyFileSync, existsSync, readFileSync, renameSync, writeFileSync, mkdirSync } from 'node:fs'
import { basename, join } from 'node:path'
import { homedir } from 'node:os'

/** Desktop's own pnpm workspace settings, matching the shell's profile manager. */
const DESKTOP_WORKSPACE = [
  'packages:',
  '  - .',
  '',
  'nodeLinker: hoisted',
  'autoInstallPeers: false',
  'allowBuilds:',
  '  node-pty: true',
  '  koffi: true',
  '  fs-ext: true',
  '  "@deepseek-ai/dsh-subprocess-local": true',
  "  '@google/genai': false",
  '  protobufjs: false',
  '  node-addon-require-builtin: false',
  '',
].join('\n')

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function backup(path) {
  const stamp = new Date().toISOString().replace(/[:.]/gu, '-')
  const target = `${path}.bak-${stamp}`
  renameSync(path, target)
  return target
}

const args = process.argv.slice(2)
const reseed = args.includes('--reseed')
const without = args.find((value) => value.startsWith('--without='))?.slice('--without='.length)
  .split(',').map((name) => name.trim()).filter((name) => name.length > 0) ?? []
const home = args.find((value) => value.startsWith('--home='))?.slice('--home='.length) ?? process.env.DSH_HOME ?? join(homedir(), '.dsh')
const source = join(home, 'profiles', 'web')
const target = join(home, 'profiles', 'desktop')

if (!existsSync(join(source, 'package.json'))) {
  console.log(`dsh desktop: no web profile at ${source}; the Desktop profile starts from the shipped template`)
  process.exit(0)
}

mkdirSync(target, { recursive: true })
const web = readJson(join(source, 'package.json'))
const inherited = web.dsh?.profile?.bundles ?? []
const dependencies = web.dependencies ?? {}
const manifestPath = join(target, 'package.json')
const existing = existsSync(manifestPath) ? readJson(manifestPath) : undefined

if (existing !== undefined && !reseed && without.length === 0) {
  const current = new Set(existing.dsh?.profile?.bundles ?? [])
  const missing = inherited.filter((name) => !current.has(name))
  const extra = [...current].filter((name) => !inherited.includes(name))
  console.log(`dsh desktop: profile already exists at ${target} (use --reseed to re-inherit, --without= to drop bundles)`)
  if (missing.length > 0) console.log(`dsh desktop: web bundles not in Desktop: ${missing.join(', ')}`)
  if (extra.length > 0) console.log(`dsh desktop: Desktop-only bundles kept: ${extra.join(', ')}`)
  process.exit(0)
}

/** Drop requested bundles from a bundle list, reporting names it did not carry. */
function withoutBundles(list) {
  if (without.length === 0) return list
  const dropped = new Set(without)
  const kept = list.filter((name) => !dropped.has(name))
  const absent = without.filter((name) => !list.includes(name))
  if (absent.length > 0) console.log(`dsh desktop: --without ignored for bundles not present: ${absent.join(', ')}`)
  console.log(`dsh desktop: dropped bundles: ${without.filter((name) => list.includes(name)).join(', ') || '(none)'}`)
  return kept
}

if (existing !== undefined && !reseed) {
  // A drop-only run keeps the Desktop profile's own manifest and rewrites just its bundles.
  const profile = existing.dsh?.profile ?? {}
  const next = {
    ...existing,
    dsh: { ...existing.dsh, profile: { ...profile, bundles: withoutBundles(profile.bundles ?? []) } },
  }
  writeFileSync(manifestPath, `${JSON.stringify(next, undefined, 2)}\n`)
  console.log(`dsh desktop: profile bundles now: ${(next.dsh.profile.bundles ?? []).join(', ')}`)
  process.exit(0)
}

const bundles = withoutBundles([...inherited])
const manifest = {
  name: `dsh-profile-${basename(target)}`,
  private: true,
  dependencies,
  dsh: {
    profile: {
      bundles: [...bundles],
      ...(web.dsh?.profile?.patchReload === undefined ? {} : { patchReload: web.dsh.profile.patchReload }),
    },
  },
}

if (existing !== undefined) console.log(`dsh desktop: previous manifest backed up to ${backup(manifestPath)}`)
writeFileSync(manifestPath, `${JSON.stringify(manifest, undefined, 2)}\n`)

const patchSource = join(source, 'cordis.patch.yml')
const patchTarget = join(target, 'cordis.patch.yml')
if (existsSync(patchSource) && (!existsSync(patchTarget) || reseed)) {
  if (existsSync(patchTarget)) console.log(`dsh desktop: previous patch backed up to ${backup(patchTarget)}`)
  copyFileSync(patchSource, patchTarget)
}

const workspacePath = join(target, 'pnpm-workspace.yaml')
if (!existsSync(workspacePath)) writeFileSync(workspacePath, DESKTOP_WORKSPACE)

// A profile can own settings (model choice, base URL, presets) beside its manifest.
const settingsSource = join(source, 'settings.yaml')
const settingsTarget = join(target, 'settings.yaml')
if (existsSync(settingsSource) && (!existsSync(settingsTarget) || reseed)) {
  if (existsSync(settingsTarget)) console.log(`dsh desktop: previous settings backed up to ${backup(settingsTarget)}`)
  copyFileSync(settingsSource, settingsTarget)
}

const pluginCount = Object.keys(dependencies).length
console.log(`dsh desktop: inherited ${String(pluginCount)} plugin(s) and ${String(bundles.length)} bundle(s) from ${source}`)
