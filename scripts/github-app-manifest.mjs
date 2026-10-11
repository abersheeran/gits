export function appManifest(instanceUrl, redirectUrl) {
  const url = new URL(instanceUrl);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
    url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Instance URL must be an HTTP(S) origin');
  }
  const origin = url.origin;
  return {
    name: `gits-${url.hostname}`.slice(0, 34),
    url: origin,
    hook_attributes: { url: `${origin}/api/github/webhook` },
    redirect_url: redirectUrl,
    callback_urls: [`${origin}/api/github/oauth/callback`],
    setup_url: `${origin}/api/github/setup`,
    setup_on_update: true,
    public: true,
    default_permissions: { contents: 'read', metadata: 'read', members: 'read' },
    default_events: ['push', 'repository'],
    request_oauth_on_install: false
  };
}

export function conversionSecrets(result) {
  if (!Number.isSafeInteger(result.id) || result.id <= 0 ||
    !['slug', 'client_id', 'client_secret', 'webhook_secret', 'pem']
      .every((key) => typeof result[key] === 'string' && result[key].length > 0)) {
    throw new Error('Invalid GitHub App conversion response');
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(result.slug) ||
    [result.client_id, result.client_secret, result.webhook_secret].some((s) => /\s/.test(s))) {
    throw new Error('Invalid GitHub App credentials');
  }
  return {
    GITHUB_APP_ID: String(result.id),
    GITHUB_APP_SLUG: result.slug,
    GITHUB_APP_CLIENT_ID: result.client_id,
    GITHUB_APP_CLIENT_SECRET: result.client_secret,
    GITHUB_APP_PRIVATE_KEY: Buffer.from(result.pem, 'utf8').toString('base64'),
    GITHUB_APP_WEBHOOK_SECRET: result.webhook_secret
  };
}

export function updateEnv(current, secrets) {
  let output = current.replace(/\r\n/g, '\n');
  for (const [key, value] of Object.entries(secrets)) {
    const pattern = new RegExp(`^${key}=.*$`, 'm');
    if (pattern.test(output)) {
      output = output.replace(pattern, () => `${key}=${value}`);
    } else {
      output = output.replace(/\n?$/, '\n') + `${key}=${value}\n`;
    }
  }
  return output;
}
