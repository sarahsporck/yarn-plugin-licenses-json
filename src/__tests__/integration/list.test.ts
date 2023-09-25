import { Configuration, Project, treeUtils } from '@yarnpkg/core'
import { ppath, npath, PortablePath } from '@yarnpkg/fslib'
import PnpPlugin from '@yarnpkg/plugin-pnp'
import NpmPlugin from '@yarnpkg/plugin-npm'
import { pluginRootDir, getTree } from '../../utils'
import { execSync } from 'child_process'
import { Writable } from 'stream'

describe.each(['pnp', 'node-modules', 'pnpm'])('licenses list (%s)', (linker) => {
  const cwd = npath.join(__dirname, 'fixtures', `test-package-${linker}`)
  beforeAll(() => {
    execSync('yarn', { cwd })
  })

  it('should list licenses', () => {
    const stdout = execSync('yarn licenses list', { cwd }).toString()
    expect(stdout).toMatchSnapshot()
  })

  it('should list licenses recursively', () => {
    const stdout = execSync('yarn licenses list --recursive', {
      cwd
    }).toString()
    expect(stdout).toMatchSnapshot()
  })

  it('should list licenses for production', () => {
    const stdout = execSync('yarn licenses list --production', {
      cwd
    }).toString()
    expect(stdout).toMatchSnapshot()
  })

  it('should list licenses recursively for production', () => {
    const stdout = execSync('yarn licenses list --recursive --production', {
      cwd
    }).toString()
    expect(stdout).toMatchSnapshot()
  })

  it('should list licenses as json', () => {
    const stdout = execSync('yarn licenses list --json', { cwd }).toString()
    expect(stdout).toMatchSnapshot()
  })
})

describe('licenses list (node-modules with aliases)', () => {
  const cwd = npath.join(__dirname, 'fixtures', `test-package-node-modules-aliases`)
  beforeAll(() => {
    execSync('yarn', { cwd })
  })

  it('should include aliases in licenses list', () => {
    const stdout = execSync('yarn licenses list', { cwd }).toString()
    expect(stdout).toContain('babel-loader@npm:8.2.4')
  })
})

describe('getTree', () => {
  it.each([
    ['non-recursively', false, false, false],
    ['recursively', true, false, false],
    ['non-recursively for production', false, true, false],
    ['recursively for production', true, true, false]
  ])('should list licenses %s', async (description, recursive, production) => {
    const cwd = ppath.join(
      pluginRootDir,
      'src/__tests__/integration/fixtures/test-package-node-modules' as PortablePath
    )
    const configuration = await Configuration.find(
      cwd,
      {
        modules: new Map([
          [`@yarnpkg/plugin-pnp`, PnpPlugin],
          [`@yarnpkg/plugin-npm`, NpmPlugin]
        ]),
        plugins: new Set([`@yarnpkg/plugin-pnp`, `@yarnpkg/plugin-npm`])
      },
      { useRc: false }
    )
    const { project, workspace } = await Project.find(configuration, cwd)

    if (!workspace) {
      throw Error('Workspace should exist')
    }
    await project.restoreInstallState()

    const tree = await getTree(project, workspace, false, recursive, production)

    let stdout = ''
    const stdoutStream = new Writable({
      write: (chunk, enc, next) => {
        stdout += chunk.toString()
        next()
      }
    })

    treeUtils.emitTree(tree, {
      configuration,
      stdout: stdoutStream,
      json: false,
      separators: 1
    })
    await new Promise((resolve) => setImmediate(resolve))

    expect(stdout).toMatchSnapshot()
  })
})
