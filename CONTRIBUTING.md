# Contributing

Use Node.js 22.14 or newer, run `npm ci`, and make changes in a branch with a pull request.

Before submitting:

```sh
npm run format:check
npm run check
npx playwright install chromium
npm run test:browser
```

Set `TEST_REDIS_URL` to an isolated Redis 6.2+ instance to run the storage integration test. CI provides a disposable Redis container. Never point tests at a production database: the integration test deliberately kills other Redis connections.

OAuth changes should include browser, replay-resistance and account-isolation coverage. Tool schemas are generated from the official Wynncraft OpenAPI specification with `npm run api:update`; do not edit `src/operations.json` by hand.

Keep private infrastructure code and credentials out of changes and logs. Report vulnerabilities through [SECURITY.md](SECURITY.md). Pull requests run with read-only repository permissions; external contributors may need maintainer approval for workflows once the repository is public.
