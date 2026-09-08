/**
 * The composition root for the Admin route.
 *
 * The admin is a React application that knows nothing about Astro; this hands
 * it the runtime built from this site's config. It has to happen inside the
 * client bundle rather than in the .astro file, because an island's props are
 * serialized and a runtime is functions and component references.
 */
import AdminPage from '@plinto/admin/components/islands/AdminPage.tsx';
import { PlintoProvider } from '@plinto/admin/context.tsx';
import { plinto } from '../plinto';

export default function AdminIsland() {
  return (
    <PlintoProvider runtime={plinto}>
      <AdminPage />
    </PlintoProvider>
  );
}
