import {
  Project,
  Workspace,
  Cache,
  ThrowReport,
  Descriptor,
  Package,
  treeUtils,
  structUtils,
  miscUtils,
  formatUtils,
  Manifest,
  IdentHash
} from '@yarnpkg/core'
import { PortablePath, ppath, npath, Filename } from '@yarnpkg/fslib'
import hostedGitInfo from 'hosted-git-info'
import { resolveLinker } from './linkers'

/**
 * Root directory of this plugin, for use in automated tests
 */
export const pluginRootDir: PortablePath =
  npath.basename(__dirname) === '@yarnpkg'
    ? // __dirname = `<rootDir>/bundles/@yarnpkg`
      ppath.join(npath.toPortablePath(__dirname), '../..' as PortablePath)
    : // __dirname = `<rootDir>/src`
      ppath.join(npath.toPortablePath(__dirname), '..' as PortablePath)

/**
 * Get the license tree for a project
 *
 * @param {Project} project - Yarn project
 * @param {Workspace} workspace - Current workspace
 * @param {boolean} json - Whether to output as JSON
 * @param {boolean} recursive - Whether to compute licenses recursively
 * @param {boolean} production - Whether to exclude devDependencies
 * @returns {treeUtils.TreeNode} Root tree node
 */
export const getTree = async (
  project: Project,
  workspace: Workspace,
  json: boolean,
  recursive: boolean,
  production: boolean
): Promise<treeUtils.TreeNode> => {
  const rootChildren: treeUtils.TreeMap = {}
  const root: treeUtils.TreeNode = { children: rootChildren }

  const sortedPackages = await getSortedPackages(project, workspace, recursive, production)

  const linker = resolveLinker(project.configuration.get('nodeLinker'))

  for (const [descriptor, pkg] of sortedPackages.entries()) {
    const packagePath = await linker.getPackagePath(project, pkg)
    if (packagePath === null) continue

    const packageManifest: ManifestWithLicenseInfo = JSON.parse(
      await linker.fs.readFilePromise(ppath.join(packagePath, Filename.manifest), 'utf8')
    )

    const { license, url, vendorName, vendorUrl } = getLicenseInfoFromManifest(packageManifest)
    const locator = structUtils.convertPackageToLocator(pkg)
    const key = structUtils.stringifyLocator(
      structUtils.isVirtualLocator(locator) ? structUtils.devirtualizeLocator(locator) : locator
    )
    const packageNode: treeUtils.TreeNode = {
      value: formatUtils.tuple(formatUtils.Type.DEPENDENT, {
        locator,
        descriptor
      })
    }
    const value = {
      package: packageNode,
      ...(url
        ? {
            url: {
              value: formatUtils.tuple(formatUtils.Type.NO_HINT, stringifyKeyValue('URL', url, json))
            }
          }
        : {}),
      ...(vendorName
        ? {
            vendorName: {
              value: formatUtils.tuple(formatUtils.Type.NO_HINT, stringifyKeyValue('VendorName', vendorName, json))
            }
          }
        : {}),
      ...(vendorUrl
        ? {
            vendorUrl: {
              value: formatUtils.tuple(formatUtils.Type.NO_HINT, stringifyKeyValue('VendorUrl', vendorUrl, json))
            }
          }
        : {}),
      license: {
        value: formatUtils.tuple(formatUtils.Type.NO_HINT, license)
      }
    }

    const node: treeUtils.TreeNode = {
      children: value
    }

    rootChildren[key] = node
  }

  return root
}

const getDescriptorsRecursive = (
  project: Project,
  workspace: Workspace | null,
  dependencies: Map<IdentHash, Descriptor>,
  descriptorsSoFar: Descriptor[],
  production: boolean,
  recursive: boolean
): Array<Descriptor> => {
  const descriptors: Descriptor[] = []
  for (const [identHash, descriptor] of dependencies.entries()) {
    if (production && workspace && workspace.manifest.devDependencies.has(identHash)) {
      continue
    }
    if (descriptorsSoFar.includes(descriptor)) {
      continue
    }
    descriptors.push(descriptor)
    if (recursive) {
      const resolution = project.storedResolutions.get(descriptor.descriptorHash)
      if (!resolution) {
        throw new Error(`Assertion failed: The resolution should have been registered`)
      }
      const pkg = project.storedPackages.get(resolution)

      if (!pkg) {
        console.log(`Assertion failed: The package could not be found`)
        continue
      }
      descriptors.push(
        ...getDescriptorsRecursive(
          project,
          null,
          pkg.dependencies,
          [...descriptorsSoFar, ...descriptors],
          production,
          recursive
        )
      )
    }
  }
  return descriptors
}

/**
 * Get a sorted map of packages for the project
 *
 * @param {Project} project - Yarn project
 * @param {Workspace} workspace - Yarn workspace
 * @param {boolean} recursive - Whether to get packages recursively
 * @param {boolean} production - Whether to exclude devDependencies
 * @returns {Promise<Map<Descriptor, Package>>} Map of packages in the project
 */
export const getSortedPackages = async (
  project: Project,
  workspace: Workspace,
  recursive: boolean,
  production: boolean
): Promise<Map<Descriptor, Package>> => {
  const packages = new Map<Descriptor, Package>()
  let storedDescriptors: Set<Descriptor>
  const workspaces = workspace.getRecursiveWorkspaceDependencies({
    dependencies: production ? ['dependencies'] : Manifest.hardDependencies
  })
  workspaces.add(workspace)
  storedDescriptors = new Set()

  if (recursive) {
    const cache = await Cache.find(project.configuration, { immutable: true })
    await project.resolveEverything({ report: new ThrowReport(), cache })
  }
  for (const workspace of workspaces) {
    storedDescriptors = new Set([
      ...getDescriptorsRecursive(
        project,
        workspace,
        workspace.dependencies,
        [...storedDescriptors],
        production,
        recursive
      ),
      ...storedDescriptors
    ])
  }

  const sortedDescriptors = miscUtils.sortMap(storedDescriptors, [
    (descriptor) => structUtils.stringifyIdent(descriptor),
    // store virtual descriptors before non-virtual descriptors because the `node-modules` linker prefers virtual
    (descriptor) => (structUtils.isVirtualDescriptor(descriptor) ? '0' : '1'),
    (descriptor) => descriptor.range
  ])

  const seenDescriptorHashes = new Set<string>()

  for (const descriptor of sortedDescriptors.values()) {
    const identHash = project.storedResolutions.get(descriptor.descriptorHash)
    if (!identHash) continue
    const pkg = project.storedPackages.get(identHash)
    if (!pkg) continue

    const { descriptorHash } = structUtils.isVirtualDescriptor(descriptor)
      ? structUtils.devirtualizeDescriptor(descriptor)
      : descriptor
    if (seenDescriptorHashes.has(descriptorHash)) continue
    seenDescriptorHashes.add(descriptorHash)

    packages.set(descriptor, pkg)
  }

  return packages
}

type Author = { name?: string; email?: string; url?: string }

/**
 * Get author information from a manifest's author string
 *
 * @param {string} author - format: "name (url) <email>"
 * @returns {Author} parsed author information
 */
export function parseAuthor(author: string) {
  const result: Author = {}

  const nameMatch = author.match(/^([^(<]+)/)
  if (nameMatch) {
    const name = nameMatch[0].trim()
    if (name) {
      result.name = name
    }
  }

  const emailMatch = author.match(/<([^>]+)>/)
  if (emailMatch) {
    result.email = emailMatch[1]
  }

  const urlMatch = author.match(/\(([^)]+)\)/)
  if (urlMatch) {
    result.url = urlMatch[1]
  }

  return result
}

/**
 * Get license information from a manifest
 *
 * @param {ManifestWithLicenseInfo} manifest - Manifest with license information
 * @returns {LicenseInfo} License information
 */
export const getLicenseInfoFromManifest = (manifest: ManifestWithLicenseInfo): LicenseInfo => {
  const { license, licenses, repository, homepage, author } = manifest

  const vendor = typeof author === 'string' ? parseAuthor(author) : author

  const getNormalizedLicense = () => {
    if (license) {
      return normalizeManifestLicenseValue(license)
    }
    if (licenses) {
      if (!Array.isArray(licenses)) {
        return normalizeManifestLicenseValue(licenses)
      }
      if (licenses.length === 1) {
        return normalizeManifestLicenseValue(licenses[0])
      }
      if (licenses.length > 1) {
        return `(${licenses.map(normalizeManifestLicenseValue).join(' OR ')})`
      }
    }
    return UNKNOWN_LICENSE
  }

  return {
    license: getNormalizedLicense(),
    url: normalizeManifestRepositoryUrl(repository) || homepage,
    vendorName: vendor?.name,
    vendorUrl: homepage || vendor?.url
  }
}

type ManifestWithLicenseInfo = {
  name: string
  license?: ManifestLicenseValue
  licenses?: ManifestLicenseValue | ManifestLicenseValue[]
  repository?: { url: string } | string
  homepage?: string
  author?: { name: string; url: string }
}

type ManifestLicenseValue = string | { type: string }

const UNKNOWN_LICENSE = 'UNKNOWN'

/**
 * Normalize a manifest license value into a license string
 *
 * @param {ManifestLicenseValue} manifestLicenseValue - Manifest license value
 * @returns {string} License string
 */
const normalizeManifestLicenseValue = (manifestLicenseValue: ManifestLicenseValue): string =>
  (typeof manifestLicenseValue !== 'string' ? manifestLicenseValue.type : manifestLicenseValue) || UNKNOWN_LICENSE

type LicenseInfo = {
  license: string
  url?: string
  vendorName?: string
  vendorUrl?: string
}

/**
 * Normalize a manifest repository value into a repository URL, if found
 *
 * @param {ManifestWithLicenseInfo['repository']} manifestRepositoryValue - Manifest repository value
 * @returns {string|undefined} Repository URL, if found
 */
const normalizeManifestRepositoryUrl = (
  manifestRepositoryValue: ManifestWithLicenseInfo['repository']
): string | undefined => {
  const rawRepositoryUrl =
    typeof manifestRepositoryValue === 'string' ? manifestRepositoryValue : manifestRepositoryValue?.url
  if (!rawRepositoryUrl) return rawRepositoryUrl
  const hosted = hostedGitInfo.fromUrl(rawRepositoryUrl)
  return !hosted ? rawRepositoryUrl : hosted.https({ noGitPlus: true })
}

const stringifyKeyValue = (key: string, value: string, json: boolean) => {
  return json ? value : `${key}: ${value}`
}
