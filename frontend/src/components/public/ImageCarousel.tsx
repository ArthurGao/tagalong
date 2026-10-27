// CSS scroll-snap: swipeable on phones without a carousel library.
export function ImageCarousel({ images, title }: { images: string[]; title: string }) {
  if (!images.length) return null;
  return (
    <div className="-mx-4 flex snap-x snap-mandatory gap-2 overflow-x-auto px-4 sm:mx-0 sm:px-0" aria-label={title}>
      {images.map((src, i) => (
        // eslint-disable-next-line @next/next/no-img-element -- merchant uploads on our storage domain
        <img
          key={src}
          src={src}
          alt={i === 0 ? title : ''}
          className="aspect-[4/3] w-[88%] shrink-0 snap-center rounded-[var(--radius)] object-cover sm:w-full"
          loading={i === 0 ? 'eager' : 'lazy'}
        />
      ))}
    </div>
  );
}
