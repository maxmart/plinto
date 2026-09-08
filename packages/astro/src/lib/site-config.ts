/**
 * The site's resolved configuration, assembled from the virtual module and
 * nothing else.
 *
 * It exists apart from `plinto.ts` because of what `plinto.ts` does besides hold
 * the config: it imports the block registry and builds the editing runtime from
 * it at module scope. Anything that reached for `config` there took an edge to
 * that whole graph, and a block on the other side of it closed a cycle —
 * plinto → virtual:plinto-blocks → the site's registry → a block →
 * useCollection → server-collection → plinto. Native ESM tolerates that; Vite's
 * SSR module runner hands back a namespace whose exports are not yet assigned,
 * so the registry read a block as `undefined` and the admin died on start with
 * a stack pointing at the loop that read it rather than at the cycle.
 *
 * A leaf cannot close a cycle. Import from here, not from `plinto.ts`, unless
 * the runtime itself is what you need — the same rule `locale-dir.ts` follows.
 */
import { i18n, content, git, storage, partials } from 'virtual:plinto-config';
import type { ResolvedConfig } from '@plinto/core/resolved-config';

export const config: ResolvedConfig = { i18n, content, git, storage, partials };
