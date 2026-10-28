import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';

// Intentionally fixed to this personal repository. This script never changes visibility.
const repo = 'Zeryther/wynncraft-mcp';
const base = `repos/${repo}`;
function api(method, path, body) {
  const args = ['api', '--method', method, path, '-H', 'X-GitHub-Api-Version: 2022-11-28'];
  if (body !== undefined) args.push('--input', '-');
  const result = spawnSync('gh', args, {
    encoding: 'utf8',
    ...(body === undefined ? {} : { input: JSON.stringify(body) }),
  });
  if (result.error) throw result.error;
  let data;
  try {
    data = result.stdout.trim() ? JSON.parse(result.stdout) : undefined;
  } catch {
    /* gh may report an empty error */
  }
  if (result.status !== 0) {
    const error = new Error(data?.message ?? `GitHub API request failed: ${method} ${path}`);
    error.status = Number(data?.status ?? result.stderr.match(/HTTP (\d+)/)?.[1]);
    throw error;
  }
  return data;
}
const metadata = api('GET', base);
const isPublic = metadata.visibility === 'public';
console.log(`Configuring ${repo} (${metadata.visibility}); visibility will not change.`);
const settings = JSON.parse(
  await readFile(new URL('../.github/repository-settings.json', import.meta.url), 'utf8'),
);
if (!isPublic) delete settings.allow_auto_merge; // Free personal private repos cannot use auto-merge.
api('PATCH', base, settings);
console.log('Applied repository features and squash-merge policy.');
api('PUT', `${base}/vulnerability-alerts`);
api('PUT', `${base}/automated-security-fixes`);
console.log('Enabled Dependabot vulnerability alerts and security updates.');
api('PUT', `${base}/actions/permissions`, {
  enabled: true,
  allowed_actions: 'selected',
  sha_pinning_required: true,
});
api('PUT', `${base}/actions/permissions/selected-actions`, {
  github_owned_allowed: true,
  verified_allowed: false,
  patterns_allowed: [],
});
api('PUT', `${base}/actions/permissions/workflow`, {
  default_workflow_permissions: 'read',
  can_approve_pull_request_reviews: false,
});
console.log(
  'Restricted Actions to GitHub-owned actions pinned by SHA, read-only defaults, and no bot review approvals.',
);
api('PUT', `${base}/topics`, {
  names: ['wynncraft', 'mcp', 'model-context-protocol', 'typescript', 'oauth', 'upstash'],
});
for (const [name, color, description] of [
  ['dependencies', '0366d6', 'Dependency updates'],
  ['security', 'd73a4a', 'Security-related changes'],
]) {
  try {
    api('POST', `${base}/labels`, { name, color, description });
  } catch (error) {
    if (error.status !== 422) throw error;
  }
}

const desiredRuleset = JSON.parse(
  await readFile(new URL('../.github/rulesets/main.json', import.meta.url), 'utf8'),
);
if (!isPublic)
  desiredRuleset.rules = desiredRuleset.rules.filter((rule) => rule.type !== 'code_scanning');
try {
  const existing = api('GET', `${base}/rulesets`).find((rule) => rule.name === desiredRuleset.name);
  api(
    existing ? 'PUT' : 'POST',
    `${base}/rulesets${existing ? `/${existing.id}` : ''}`,
    desiredRuleset,
  );
  console.log(
    'Enabled main protection: PRs, CI gate, up-to-date branches, resolved threads, linear history, no force pushes/deletion.',
  );
} catch (error) {
  if (isPublic || error.status !== 403) throw error;
  console.warn(
    'PENDING: GitHub requires Pro or public visibility for rulesets on this private repository. Re-run after publishing.',
  );
}
if (isPublic) {
  api('PUT', `${base}/private-vulnerability-reporting`);
  api('PATCH', base, {
    security_and_analysis: {
      secret_scanning: { status: 'enabled' },
      secret_scanning_push_protection: { status: 'enabled' },
    },
  });
  api('PUT', `${base}/actions/permissions/fork-pr-contributor-approval`, {
    approval_policy: 'all_external_contributors',
  });
  console.log(
    'Enabled private vulnerability reporting, secret scanning/push protection, and external-fork workflow approval. CodeQL is enforced by the main ruleset.',
  );
} else {
  console.warn(
    'PENDING until public: CodeQL workflow, secret scanning/push protection, private vulnerability reporting, fork approvals, and auto-merge.',
  );
}
