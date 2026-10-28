# GitHub repository configuration

The repository stays private until its owner explicitly publishes it. This setup never changes visibility or enables a paid security product.

## Active while private

- CI checks Node 22 and 24, production compilation, formatting, real Redis integration, browser OAuth, and all dependencies for high/critical advisories.
- `CI gate` fails if any required job fails, is skipped or is cancelled. It is the stable status used by branch rules.
- All action references use full commit SHAs and checkout does not persist credentials. Actions policy permits only GitHub-owned actions, requires SHA pinning, defaults to read-only tokens and prohibits bot review approvals.
- Dependabot vulnerability alerts, automated security updates, and weekly npm/Actions version updates.
- Squash-only merging, PR title/body for commit messages, automatic deletion of merged branches, and branch updates from the PR interface.
- CODEOWNERS, security reporting guidance, contribution instructions, issue forms, and a PR template.

The current GitHub plan rejects rulesets on this private personal repository. Main protection therefore cannot be enforced while it remains private on that plan. The desired rules live in `.github/rulesets/main.json`. Upgrading to Pro permits the ordinary branch rules while private; CodeQL and secret-protection availability have separate eligibility requirements.

## When making the repository public

After the owner changes visibility, authenticate with `gh` as a repository administrator and run:

```sh
npm run github:configure
```

The command is idempotent and applies `.github/repository-settings.json`, updates the named main ruleset, and enables public-only security features. It never changes visibility. It configures:

- Pull requests required for main, with no direct-push bypass actors.
- Successful `CI gate` from the GitHub Actions integration and an up-to-date branch.
- Resolved review threads, linear history, no force pushes, and no deletion of main.
- CodeQL results required, blocking error-level alerts and high/critical security findings.
- Secret scanning, secret push protection, private vulnerability reporting, approval for all external-fork workflows, and auto-merge support.

Approving-review count is deliberately zero: this is a solo-maintained personal repository, and GitHub does not allow authors to approve their own PRs. PRs and CI remain mandatory. Raise the approval count and require code owners once there is another active maintainer.

The CodeQL workflow automatically runs when visibility becomes public, then on PRs, main pushes, weekly, and manual dispatch. Wait for its first main-branch analysis to finish before merging PRs governed by the code-scanning rule. CodeQL is skipped while private because this personal repository does not have an eligible code-security plan.

For future setup checks:

```sh
gh api repos/Zeryther/wynncraft-mcp/actions/permissions
gh api repos/Zeryther/wynncraft-mcp/actions/permissions/workflow
gh api repos/Zeryther/wynncraft-mcp/rulesets
gh api repos/Zeryther/wynncraft-mcp --jq '.security_and_analysis'
```

No deployment credentials are needed in GitHub Actions. Configure Wynncraft and Upstash secrets in Gigadrive runtime variables, not repository files or PRs.
