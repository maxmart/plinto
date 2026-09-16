/**
 * Plinto CORS Proxy — Cloudflare Worker
 *
 * Routes requests of the form:
 *   https://proxy.dev/<target-host>/<path>
 * to:
 *   https://<target-host>/<path>
 *
 * Enforces allowlists for both request origin and target host. Both are
 * env vars; see wrangler.toml. With no ALLOWED_ORIGINS at all the worker
 * serves nothing, rather than serving everyone.
 */

export default {
  async fetch(request, env) {
    if (!env.ALLOWED_ORIGINS) {
      return new Response('ALLOWED_ORIGINS is not set; see wrangler.toml', { status: 500 });
    }

    if (request.method === 'OPTIONS') {
      return handlePreflight(request, env);
    }

    const url = new URL(request.url);
    const segments = url.pathname.replace(/^\//, '').split('/');
    const targetHost = segments[0];

    if (!targetHost) {
      return new Response('Missing target host in path', { status: 400 });
    }

    // Validate origin. Only when one is present: plain <img>/<video> loads are
    // sent without an Origin header, and the allowlist exists to gate CORS
    // reads, not to pretend non-browser clients can't fetch (curl never sends
    // Origin either way).
    const origin = request.headers.get('Origin');
    const allowedOrigins = parseList(env.ALLOWED_ORIGINS);
    if (origin && !matchesPattern(origin, allowedOrigins)) {
      return new Response('Origin not allowed', { status: 403 });
    }

    // Validate target
    const allowedTargets = parseList(
      env.ALLOWED_TARGETS ?? 'github.com,*.githubusercontent.com,*.amazonaws.com'
    );
    if (!matchesPattern(targetHost, allowedTargets)) {
      return new Response('Target host not allowed', { status: 403 });
    }

    // Build target URL
    const targetPath = '/' + segments.slice(1).join('/') + (url.search || '');
    const targetUrl = `https://${targetHost}${targetPath}`;

    // Forward request headers, strip hop-by-hop and host
    const forwardHeaders = new Headers(request.headers);
    forwardHeaders.delete('host');
    forwardHeaders.delete('origin');
    forwardHeaders.delete('cf-connecting-ip');
    forwardHeaders.delete('cf-ipcountry');
    forwardHeaders.delete('cf-ray');
    forwardHeaders.delete('cf-visitor');
    forwardHeaders.delete('x-forwarded-for');
    forwardHeaders.delete('x-forwarded-proto');

    let upstreamResponse;
    try {
      upstreamResponse = await fetch(targetUrl, {
        method: request.method,
        headers: forwardHeaders,
        body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
        redirect: 'manual',
      });
    } catch (err) {
      return new Response(`Upstream fetch failed: ${err.message}`, { status: 502 });
    }

    // Copy response headers
    const responseHeaders = new Headers(upstreamResponse.headers);

    // Rewrite Location header so redirects stay on the proxy
    const location = responseHeaders.get('Location');
    if (location && /^https?:\/\//.test(location)) {
      const rewritten = location.replace(/^https?:\/\//, '');
      responseHeaders.set('Location', `/${rewritten}`);
    }

    // Set CORS headers
    if (origin) {
      responseHeaders.set('Access-Control-Allow-Origin', origin);
      responseHeaders.set('Access-Control-Allow-Credentials', 'true');
    } else {
      responseHeaders.set('Access-Control-Allow-Origin', '*');
    }
    responseHeaders.set('Vary', 'Origin');

    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers: responseHeaders,
    });
  },
};

function handlePreflight(request, env) {
  const origin = request.headers.get('Origin');
  const allowedOrigins = parseList(env.ALLOWED_ORIGINS);

  if (!matchesPattern(origin ?? '', allowedOrigins)) {
    return new Response('Origin not allowed', { status: 403 });
  }

  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': origin ?? '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': request.headers.get('Access-Control-Request-Headers') ?? '*',
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin',
    },
  });
}

/**
 * Split a comma-separated env var into trimmed, non-empty strings.
 */
function parseList(str) {
  if (!str || str.trim() === '*') return ['*'];
  return str
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Test a value against a list of patterns.
 *
 * Supported patterns:
 *   *                  — match everything
 *   *.example.com      — match any subdomain of example.com
 *   http://localhost:* — match localhost with any port
 *   exact string       — literal equality
 */
function matchesPattern(value, patterns) {
  for (const pattern of patterns) {
    if (pattern === '*') return true;
    if (pattern === value) return true;

    if (pattern.startsWith('*.')) {
      // Subdomain wildcard: *.example.com matches foo.example.com
      const suffix = pattern.slice(1); // .example.com
      if (value.endsWith(suffix)) return true;
    } else if (pattern.endsWith(':*')) {
      // Port wildcard: http://localhost:* matches http://localhost:3000
      const prefix = pattern.slice(0, -1); // http://localhost:
      if (value.startsWith(prefix)) return true;
    }
  }
  return false;
}
