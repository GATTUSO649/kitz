import { createHash, randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { basename, relative, resolve } from 'node:path'
import { discoverNpmAuditTargets } from './dependency-scanner.js'

type LockedPackage = {
  name?: string
  version?: string
  license?: string | { type?: string }
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  resolved?: string
  dev?: boolean
}

type PackageLock = { name?: string; version?: string; lockfileVersion?: number; packages?: Record<string, LockedPackage> }

function safePackageName(name: string) {
  if (!name.startsWith('@')) return encodeURIComponent(name)
  const [scope, packageName] = name.slice(1).split('/')
  return `%40${encodeURIComponent(scope ?? '')}/${encodeURIComponent(packageName ?? '')}`
}

function packageRef(projectPath: string, packagePath: string, name: string, version: string) {
  const identity = `${projectPath}\0${packagePath}\0${name}\0${version}`
  const fingerprint = createHash('sha256').update(identity).digest('hex').slice(0, 20)
  return `urn:kitculture:package:${fingerprint}`
}

function resolveDependencyKey(packageKey: string, dependencyName: string, packages: Record<string, LockedPackage>) {
  let base = packageKey
  while (base) {
    const candidate = `${base}/node_modules/${dependencyName}`
    if (packages[candidate]) return candidate
    const separator = base.lastIndexOf('/')
    base = separator < 0 ? '' : base.slice(0, separator)
  }
  const rootCandidate = `node_modules/${dependencyName}`
  return packages[rootCandidate] ? rootCandidate : null
}

function readLockfile(lockfile: string): PackageLock {
  return JSON.parse(readFileSync(lockfile, 'utf8')) as PackageLock
}

function projectBom(projectRoot: string, repositoryRoot: string) {
  const lockfile = resolve(projectRoot, 'package-lock.json')
  const lock = readLockfile(lockfile)
  const packages = lock.packages ?? {}
  const projectPath = relative(repositoryRoot, projectRoot).replaceAll('\\', '/') || '.'
  const rootPackage = packages[''] ?? {}
  const projectName = rootPackage.name ?? lock.name ?? basename(projectRoot)
  const projectVersion = rootPackage.version ?? lock.version ?? '0.0.0'
  const rootRef = packageRef(projectPath, '', projectName, projectVersion)
  const refs = new Map<string, string>()
  const components: Record<string, unknown>[] = [{
    type: 'application',
    name: projectName,
    version: projectVersion,
    'bom-ref': rootRef,
    properties: [{ name: 'kitculture:projectPath', value: projectPath }],
  }]

  for (const [packageKey, locked] of Object.entries(packages)) {
    if (!packageKey || !locked.version || !locked.name || packageKey.includes('/node_modules/.')) continue
    const ref = packageRef(projectPath, packageKey, locked.name, locked.version)
    refs.set(packageKey, ref)
    const license = typeof locked.license === 'string' ? locked.license : locked.license?.type
    const component: Record<string, unknown> = {
      type: 'library',
      name: locked.name,
      version: locked.version,
      'bom-ref': ref,
      purl: `pkg:npm/${safePackageName(locked.name)}@${encodeURIComponent(locked.version)}`,
      scope: locked.dev ? 'optional' : 'required',
      properties: [{ name: 'kitculture:projectPath', value: projectPath }],
    }
    if (license) component.licenses = [{ license: { name: license } }]
    components.push(component)
  }

  const dependencies: { ref: string; dependsOn: string[] }[] = []
  for (const [packageKey, locked] of Object.entries(packages)) {
    const ref = packageKey ? refs.get(packageKey) : rootRef
    if (!ref) continue
    const dependencyNames = new Set([
      ...Object.keys(locked.dependencies ?? {}),
      ...Object.keys(locked.devDependencies ?? {}),
      ...Object.keys(locked.optionalDependencies ?? {}),
      ...Object.keys(locked.peerDependencies ?? {}),
    ])
    const dependsOn = [...dependencyNames]
      .map((dependencyName) => resolveDependencyKey(packageKey, dependencyName, packages))
      .filter((key): key is string => key !== null)
      .map((key) => refs.get(key))
      .filter((dependencyRef): dependencyRef is string => dependencyRef !== undefined)
    dependencies.push({ ref, dependsOn: [...new Set(dependsOn)].sort() })
  }

  return { components, dependencies }
}

export function generateCycloneDxSbom(cwd: string) {
  const targets = discoverNpmAuditTargets(cwd)
  if (!targets.length) throw new Error('SBOM_LOCKFILES_NOT_FOUND')
  const repositoryRoot = targets.find((target) => existsSync(resolve(target.root, 'platform', 'package-lock.json')))?.root ?? targets[0].root
  const projectBoms = targets.map((target) => projectBom(target.root, repositoryRoot))
  const components = projectBoms.flatMap((bom) => bom.components)
  const dependencies = projectBoms.flatMap((bom) => bom.dependencies)
  return {
    bomFormat: 'CycloneDX',
    specVersion: '1.5',
    serialNumber: `urn:uuid:${randomUUID()}`,
    version: 1,
    metadata: { timestamp: new Date().toISOString(), component: { type: 'application', name: 'KitCulture Kitz and MarketHub monorepo' } },
    components,
    dependencies,
  }
}