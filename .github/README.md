# Repository automation

## Automatic pull requests

[`auto-pull-request.yml`](workflows/auto-pull-request.yml) opens a pull request from a pushed branch into the repository's default branch (`main` currently).

- Pushes to the default branch, branch deletions, and tags do not create PRs.
- A branch with an open PR keeps that PR; subsequent commits appear in it automatically.
- Branches without code differences from the default branch are skipped.
- The workflow can also be run manually from the Actions tab after selecting a non-default branch.
- The workflow does not rewrite branches, push commits, assign reviewers, or merge PRs.

### Enable PR creation

In **Settings → Actions → General → Workflow permissions**, enable **Allow GitHub Actions to create and approve pull requests**. Organization policy may restrict this setting.

The workflow uses the built-in `GITHUB_TOKEN` with `contents: read` and `pull-requests: write`. No personal access token is required. The repository setting is still necessary; declaring YAML permissions cannot override a disabled setting.

The SHA-pinned official `actions/github-script` action opens PRs through GitHub's API. It is used instead of a working-tree action because the commits already exist on the pushed branch. No checkout or execution of contributor code is needed.

### Checks and bot events

[`checks.yml`](workflows/checks.yml) already validates pushed commits. Depending on GitHub's token and repository policies, workflows triggered by an automatically created PR may not run automatically or may require approval. The push checks continue to run independently. This workflow does not bypass branch protection or approve/merge its PRs.
