import { WorkspaceRequiredError } from '@yarnpkg/cli'
import { CommandContext, Configuration, Project, treeUtils } from '@yarnpkg/core'
import { Command, Usage, Option } from 'clipanion'
import { getTree } from '../utils'

export class LicensesListCommand extends Command<CommandContext> {
  static paths = [[`licenses`, `list`]]

  recursive = Option.Boolean(`-R,--recursive`, false, {
    description: `Include transitive dependencies (dependencies of direct dependencies)`
  })

  production = Option.Boolean(`--production`, false, {
    description: `Exclude development dependencies`
  })

  json = Option.Boolean(`--json`, false, {
    description: `Format output as JSON`
  })

  static usage: Usage = Command.Usage({
    description: `display the licenses for all packages in the project`,
    details: `
      This command prints the license information for packages in the project. By default, only direct dependencies are listed.

      If \`-R,--recursive\` is set, the listing will include transitive dependencies (dependencies of direct dependencies).

      If \`--production\` is set, the listing will exclude development dependencies.
    `,
    examples: [
      [`List all licenses of direct dependencies`, `$0 licenses list`],
      [`List all licenses of direct and transitive dependencies`, `$0 licenses list --recursive`],
      [`List all licenses of production dependencies only`, `$0 licenses list --production`]
    ]
  })

  async execute(): Promise<void> {
    const configuration = await Configuration.find(this.context.cwd, this.context.plugins)
    const { project, workspace } = await Project.find(configuration, this.context.cwd)

    if (!workspace) {
      throw new WorkspaceRequiredError(project.cwd, this.context.cwd)
    }

    await project.restoreInstallState()

    const tree = await getTree(project, this.json, this.recursive, this.production)

    treeUtils.emitTree(tree, {
      configuration,
      stdout: this.context.stdout,
      json: this.json,
      separators: 1
    })
  }
}
