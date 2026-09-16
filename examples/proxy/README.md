# The git proxy

Plinto clones your repository into the browser and pushes from there. GitHub
does not send CORS headers on its git endpoints, so the browser cannot talk to
it directly; this Cloudflare Worker sits in between and forwards. That is all
it does. It holds no credentials: the editor's token travels through it in the
`Authorization` header, the same as it would to GitHub.

Copy this folder into your site's repository, edit `wrangler.toml`, deploy,
and point the integration at it:

```js
plinto({
  git: { corsProxy: 'https://plinto-proxy.<your-account>.workers.dev' },
})
```

Any isomorphic-git-compatible proxy works in its place; this one is small
enough to read.

## Configuration

Two variables, set under `[vars]` in `wrangler.toml` or on the worker in the
Cloudflare dashboard.

| Variable          | What it is                                                   |
|-------------------|--------------------------------------------------------------|
| `ALLOWED_ORIGINS` | The origins your admin is served from. Required: with it unset the worker serves nothing. |
| `ALLOWED_TARGETS` | The hosts the worker will forward to. The default covers GitHub and its LFS storage. |

Both are comma-separated lists of patterns:

- `https://example.com` — exactly that origin. The apex and `www` are two
  origins; list both if you serve both.
- `*.example.com` — any subdomain.
- `http://localhost:*` — any port, for `astro dev`.
- `*` — everything. Do not ship this for origins: the worker would forward
  anyone's requests to GitHub, from any page on the web.

The origin check gates browsers, which always send `Origin`; it is not
authentication. A request without the header, from `curl` or a media tag, is
forwarded and gets whatever GitHub says about it.

## Deploy

```bash
npx wrangler login     # once
npx wrangler deploy
```

The URL is printed at the end. A free Cloudflare account is enough.

## How a request travels

The target host is the first path segment:

```
https://plinto-proxy.you.workers.dev/github.com/owner/repo.git/info/refs?service=git-upload-pack
                                     ^^^^^^^^^^
                          forwarded to https://github.com/owner/repo.git/info/refs?...
```

The worker checks the origin and the target against the two lists, forwards
the request with its headers and body, and returns the response with
`Access-Control-Allow-Origin` set to the caller. Redirects are rewritten to
stay on the proxy, which is what makes LFS work: GitHub answers an LFS batch
with signed URLs on other hosts, hence `*.amazonaws.com` in the targets.
