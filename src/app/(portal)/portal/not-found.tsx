/** Portal 404. Plain and portal-styled; no staff links. */

export default function PortalNotFound() {
  return (
    <div className="py-10 text-center">
      <h1 className="text-xl font-semibold">Page not found</h1>
      <p className="mt-2 text-sm text-ink-3">
        We could not find what you were looking for.
      </p>
    </div>
  );
}
