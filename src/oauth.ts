import type { Request, Response, Express } from 'express';
import express from 'express';
import type {
  OAuthServerProvider,
  AuthorizationParams,
} from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type {
  OAuthClientInformationFull,
  OAuthTokens,
  OAuthTokenRevocationRequest,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import {
  InvalidGrantError,
  InvalidTokenError,
  InvalidRequestError,
  InvalidScopeError,
  UnsupportedGrantTypeError,
} from '@modelcontextprotocol/sdk/server/auth/errors.js';
import { mcpAuthRouter } from '@modelcontextprotocol/sdk/server/auth/router.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import { opaque, digest, type Store } from './store.js';
import { readJson, API_BASE, type Fetch } from './api.js';

export type OAuthConfig = {
  publicUrl: string;
  clientId: string;
  clientSecret?: string;
  scopes: string[];
};
type Transaction = {
  clientId: string;
  params: AuthorizationParams & { resource?: URL | string };
  browser: string;
  verifier: string;
};
type Grant = {
  clientId: string;
  redirectUri: string;
  challenge: string;
  resource: string;
  upstreamToken: string;
  scopes: string[];
};
type Credential = { clientId: string; upstreamToken: string; resource: string; expiresAt: number };
const TOKEN_TTL = 24 * 60 * 60;
const COOKIE = '__Host-wynncraft_oauth';
const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

export class WynncraftOAuthProvider implements OAuthServerProvider {
  readonly resource: string;
  readonly clientsStore;
  constructor(
    readonly config: OAuthConfig,
    readonly store: Store,
    readonly fetcher: Fetch = fetch,
  ) {
    this.resource = new URL('/mcp', config.publicUrl).href;
    this.clientsStore = {
      getClient: (id: string) => store.get<OAuthClientInformationFull>(`client:${digest(id)}`),
      registerClient: async (
        input: Omit<OAuthClientInformationFull, 'client_id' | 'client_id_issued_at'>,
      ) => {
        // Public MCP clients use PKCE. Never fetch client-supplied URLs.
        if (input.token_endpoint_auth_method && input.token_endpoint_auth_method !== 'none')
          throw new InvalidRequestError(
            'Register as a public client with token_endpoint_auth_method=none',
          );
        if (input.redirect_uris.length > 10)
          throw new InvalidRequestError('Too many redirect URIs');
        for (const redirect of input.redirect_uris) {
          const url = new URL(redirect);
          if (
            url.username ||
            url.password ||
            url.hash ||
            (url.protocol !== 'https:' &&
              !(
                url.protocol === 'http:' &&
                ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
              ))
          )
            throw new InvalidRequestError('Redirect URIs must use HTTPS or HTTP loopback');
        }
        const client: OAuthClientInformationFull = {
          ...input,
          client_id: opaque(),
          client_id_issued_at: Math.floor(Date.now() / 1000),
          token_endpoint_auth_method: 'none',
          grant_types: ['authorization_code'],
          response_types: ['code'],
        };
        delete client.client_secret;
        await store.put(`client:${digest(client.client_id)}`, client, 30 * 24 * 60 * 60);
        return client;
      },
    };
  }
  async authorize(client: OAuthClientInformationFull, params: AuthorizationParams, res: Response) {
    if (params.resource?.href !== this.resource)
      throw new InvalidRequestError('resource must identify this MCP endpoint');
    if (params.scopes?.some((s) => s !== 'wynncraft:read'))
      throw new InvalidScopeError('Only wynncraft:read is supported');
    if (!/^[A-Za-z0-9_-]{43}$/u.test(params.codeChallenge))
      throw new InvalidRequestError('Invalid S256 challenge');
    const state = opaque(),
      browser = opaque(),
      verifier = opaque();
    await this.store.put(
      `state:${digest(state)}`,
      { clientId: client.client_id, params, browser: digest(browser), verifier },
      300,
    );
    res.cookie(COOKIE, browser, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 300_000,
    });
    const url = new URL('https://wynncraft.com/authorize');
    for (const [k, v] of Object.entries({
      client_id: this.config.clientId,
      redirect_uri: new URL('/oauth/callback', this.config.publicUrl).href,
      response_type: 'code',
      scope: this.config.scopes.join(' '),
      state,
      code_challenge: digest(verifier),
      code_challenge_method: 'S256',
      // Wynncraft's current authorization page requires this alias in addition to the documented method.
      code_challenge_type: 'S256',
    }))
      url.searchParams.set(k, v);
    res.redirect(302, url.href);
  }
  async callback(req: Request, res: Response) {
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    const transaction = await this.store.get<Transaction>(`state:${digest(state)}`);
    if (!transaction || !this.browserMatches(req, transaction.browser)) {
      res.status(400).send('Login expired or browser state mismatch. Restart login.');
      return;
    }
    // Consume only after browser binding has been checked; GETDEL prevents replay across instances.
    const consumed = await this.store.take<Transaction>(`state:${digest(state)}`);
    if (!consumed) {
      res.status(400).send('Login already used.');
      return;
    }
    if (req.query.error || typeof req.query.code !== 'string') {
      const redirect = new URL(consumed.params.redirectUri);
      redirect.searchParams.set('error', req.query.error ? 'access_denied' : 'server_error');
      if (consumed.params.state !== undefined)
        redirect.searchParams.set('state', consumed.params.state);
      res.clearCookie(COOKIE, { httpOnly: true, secure: true, sameSite: 'lax', path: '/' });
      res.redirect(302, redirect.href);
      return;
    }
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code: req.query.code,
      client_id: this.config.clientId,
      redirect_uri: new URL('/oauth/callback', this.config.publicUrl).href,
      code_verifier: consumed.verifier,
    });
    if (this.config.clientSecret) body.set('client_secret', this.config.clientSecret);
    const response = await this.fetcher(`${API_BASE}/oauth/token`, {
      method: 'POST',
      body,
      headers: { Accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      res.status(502).send('Wynncraft token exchange failed. Restart login.');
      return;
    }
    const token = (await readJson(response)) as { access_token?: unknown; scope?: unknown };
    if (
      typeof token.access_token !== 'string' ||
      typeof token.scope !== 'string' ||
      !token.scope.split(' ').includes('identify')
    )
      throw new Error('Invalid Wynncraft token response');
    // Renew browser binding so consent gets its full five-minute lifetime after login.
    const browser = req.headers.cookie
      ?.split(';')
      .map((c) => c.trim())
      .find((c) => c.startsWith(`${COOKIE}=`))
      ?.slice(COOKIE.length + 1);
    res.cookie(COOKIE, browser!, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 300_000,
    });
    const consent = opaque();
    const grant: Grant = {
      clientId: consumed.clientId,
      redirectUri: consumed.params.redirectUri,
      challenge: consumed.params.codeChallenge,
      resource: this.resource,
      upstreamToken: token.access_token,
      scopes: token.scope.split(' '),
    };
    await this.store.put(
      `consent:${digest(consent)}`,
      { grant, browser: consumed.browser, state: consumed.params.state },
      300,
    );
    const client = await this.clientsStore.getClient(consumed.clientId);
    res.setHeader(
      'Content-Security-Policy',
      `default-src 'none'; form-action 'self' ${new URL(grant.redirectUri).origin}; frame-ancestors 'none'; base-uri 'none'`,
    );
    res
      .type('html')
      .send(
        `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Connect Wynncraft</title><main><h1>Connect your Wynncraft account</h1><p>Allow <strong>${escapeHtml(client?.client_name ?? 'MCP client')}</strong> to read Wynncraft data using your account?</p><p>Client ID: <code>${escapeHtml(consumed.clientId)}</code></p><p>Return address: <code>${escapeHtml(grant.redirectUri)}</code></p><p>Wynncraft permissions: ${escapeHtml(grant.scopes.join(', '))}</p><p>This includes private data allowed by these permissions. Only continue if you started this connection and trust this client.</p><form method="post" action="/oauth/consent"><input type="hidden" name="consent" value="${consent}"><button name="decision" value="allow">Allow connection</button> <button name="decision" value="deny">Cancel</button></form></main></html>`,
      );
  }
  private browserMatches(req: Request, expected: string) {
    const value = req.headers.cookie
      ?.split(';')
      .map((c) => c.trim())
      .find((c) => c.startsWith(`${COOKIE}=`))
      ?.slice(COOKIE.length + 1);
    return !!value && digest(value) === expected;
  }
  async consent(req: Request, res: Response) {
    if (req.get('origin') !== new URL(this.config.publicUrl).origin) {
      res.sendStatus(403);
      return;
    }
    const id = typeof req.body?.consent === 'string' ? req.body.consent : '';
    const pending = await this.store.get<{ grant: Grant; browser: string; state?: string }>(
      `consent:${digest(id)}`,
    );
    if (!pending || !this.browserMatches(req, pending.browser)) {
      res.status(400).send('Consent expired. Restart login.');
      return;
    }
    if (!(await this.store.take(`consent:${digest(id)}`))) {
      res.sendStatus(400);
      return;
    }
    const url = new URL(pending.grant.redirectUri);
    if (pending.state !== undefined) url.searchParams.set('state', pending.state);
    if (req.body.decision === 'allow') {
      const code = opaque();
      await this.store.put(`code:${digest(code)}`, pending.grant, 120);
      url.searchParams.set('code', code);
    } else url.searchParams.set('error', 'access_denied');
    res.clearCookie(COOKIE, { httpOnly: true, secure: true, sameSite: 'lax', path: '/' });
    res.redirect(303, url.href);
  }
  async challengeForAuthorizationCode(client: OAuthClientInformationFull, code: string) {
    const grant = await this.store.get<Grant>(`code:${digest(code)}`);
    if (!grant || grant.clientId !== client.client_id)
      throw new InvalidGrantError('Invalid authorization code');
    return grant.challenge;
  }
  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    code: string,
    _verifier?: string,
    redirectUri?: string,
    resource?: URL,
  ): Promise<OAuthTokens> {
    const grant = await this.store.get<Grant>(`code:${digest(code)}`);
    if (
      !grant ||
      grant.clientId !== client.client_id ||
      grant.redirectUri !== redirectUri ||
      grant.resource !== resource?.href
    )
      throw new InvalidGrantError('Code binding mismatch');
    if (!(await this.store.take(`code:${digest(code)}`)))
      throw new InvalidGrantError('Authorization code already used');
    const token = opaque();
    await this.store.put(
      `token:${digest(token)}`,
      {
        clientId: client.client_id,
        upstreamToken: grant.upstreamToken,
        resource: grant.resource,
        expiresAt: Math.floor(Date.now() / 1000) + TOKEN_TTL,
      },
      TOKEN_TTL,
    );
    return {
      access_token: token,
      token_type: 'Bearer',
      expires_in: TOKEN_TTL,
      scope: 'wynncraft:read',
    };
  }
  async exchangeRefreshToken(): Promise<OAuthTokens> {
    throw new UnsupportedGrantTypeError('Reauthorize when the MCP access token expires');
  }
  async credential(token: string) {
    const credential = await this.store.get<Credential>(`token:${digest(token)}`);
    if (
      !credential ||
      credential.resource !== this.resource ||
      credential.expiresAt <= Date.now() / 1000
    )
      throw new InvalidTokenError('Token invalid or expired');
    return credential;
  }
  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const credential = await this.credential(token);
    return {
      token,
      clientId: credential.clientId,
      scopes: ['wynncraft:read'],
      expiresAt: credential.expiresAt,
      resource: new URL(credential.resource),
    };
  }
  async revokeToken(client: OAuthClientInformationFull, request: OAuthTokenRevocationRequest) {
    const credential = await this.store.get<Credential>(`token:${digest(request.token)}`);
    if (credential?.clientId === client.client_id)
      await this.store.delete(`token:${digest(request.token)}`);
  }
}

export function installOAuth(app: Express, provider: WynncraftOAuthProvider) {
  app.use(
    mcpAuthRouter({
      provider,
      issuerUrl: new URL(provider.config.publicUrl),
      resourceServerUrl: new URL(provider.resource),
      scopesSupported: ['wynncraft:read'],
      resourceName: 'Wynncraft MCP',
    }),
  );
  const browserHeaders = (_req: Request, res: Response, next: () => void) => {
    res.set({
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'same-origin',
      'Content-Security-Policy':
        "default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
      'X-Content-Type-Options': 'nosniff',
    });
    next();
  };
  app.get('/oauth/callback', browserHeaders, (req, res) => provider.callback(req, res));
  app.post(
    '/oauth/consent',
    browserHeaders,
    express.urlencoded({ extended: false, limit: '4kb' }),
    (req, res) => provider.consent(req, res),
  );
  return requireBearerAuth({
    verifier: provider,
    requiredScopes: ['wynncraft:read'],
    resourceMetadataUrl: new URL(
      '/.well-known/oauth-protected-resource/mcp',
      provider.config.publicUrl,
    ).href,
    expectedResource: new URL(provider.resource),
  });
}
