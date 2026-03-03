export function CardSkeleton() {
  return (
    <div className="animate-pulse rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
      <div className="h-5 w-3/4 rounded bg-gray-200" />
      <div className="mt-3 h-4 w-1/2 rounded bg-gray-200" />
      <div className="mt-4 h-4 w-1/3 rounded bg-gray-200" />
    </div>
  );
}

export function GridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: count }).map((_, i) => (
        <CardSkeleton key={i} />
      ))}
    </div>
  );
}

export function PhotoGridSkeleton({ count = 9 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="animate-pulse rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
          <div className="aspect-video bg-gray-200" />
          <div className="p-3">
            <div className="h-4 w-2/3 rounded bg-gray-200" />
          </div>
        </div>
      ))}
    </div>
  );
}
