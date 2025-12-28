import { CSSProperties, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";

type VirtualizedListProps<T> = {
  items: T[];
  itemKey: (item: T, index: number) => string;
  renderItem: (item: T, index: number) => ReactNode;
  estimateSize?: number;
  overscan?: number;
  className?: string;
  style?: CSSProperties;
};

type ItemMeasurement = {
  start: number;
  size: number;
};

function findStartIndex(offsets: ItemMeasurement[], scrollTop: number): number {
  let low = 0;
  let high = offsets.length - 1;
  let answer = 0;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const item = offsets[mid];
    if (item.start + item.size >= scrollTop) {
      answer = mid;
      high = mid - 1;
    } else {
      low = mid + 1;
    }
  }

  return answer;
}

export function VirtualizedList<T>({
  items,
  itemKey,
  renderItem,
  estimateSize = 240,
  overscan = 4,
  className,
  style,
}: VirtualizedListProps<T>) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(600);
  const [measurements, setMeasurements] = useState<Map<string, number>>(new Map());

  const sizes = useMemo(
    () => items.map((item, index) => measurements.get(itemKey(item, index)) ?? estimateSize),
    [estimateSize, itemKey, items, measurements]
  );

  const offsets = useMemo(() => {
    const list: ItemMeasurement[] = [];
    let cursor = 0;
    sizes.forEach((size) => {
      list.push({ start: cursor, size });
      cursor += size;
    });
    return list;
  }, [sizes]);

  const totalHeight = offsets.length ? offsets[offsets.length - 1].start + offsets[offsets.length - 1].size : 0;

  const startIndex = useMemo(() => {
    if (!offsets.length) return 0;
    const overscanTop = Math.max(0, scrollTop - overscan * estimateSize);
    return findStartIndex(offsets, overscanTop);
  }, [estimateSize, offsets, overscan, scrollTop]);

  const endIndex = useMemo(() => {
    if (!offsets.length) return -1;
    const maxVisible = scrollTop + viewportHeight + overscan * estimateSize;
    let index = startIndex;
    while (index < offsets.length && offsets[index].start < maxVisible) {
      index += 1;
    }
    return Math.min(index, items.length);
  }, [estimateSize, items.length, offsets, overscan, scrollTop, startIndex, viewportHeight]);

  const handleScroll = useCallback(() => {
    setScrollTop(containerRef.current?.scrollTop ?? 0);
  }, []);

  const handleMeasure = useCallback((key: string, node: HTMLElement | null) => {
    if (!node) return;
    const rect = node.getBoundingClientRect();
    const height = rect.height;
    if (!height || Number.isNaN(height)) return;
    setMeasurements((prev) => {
      const current = prev.get(key);
      if (current === height) return prev;
      const next = new Map(prev);
      next.set(key, height);
      return next;
    });
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver((entries) => {
            const entry = entries[0];
            if (!entry) return;
            setViewportHeight(entry.contentRect.height || 0);
          })
        : null;

    if (observer) {
      observer.observe(container);
    } else {
      const update = () => setViewportHeight(container.clientHeight || window.innerHeight || 600);
      update();
      window.addEventListener("resize", update);
      return () => window.removeEventListener("resize", update);
    }

    return () => observer?.disconnect();
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => container.removeEventListener("scroll", handleScroll);
  }, [handleScroll]);

  const visibleItems = useMemo(() => {
    if (endIndex < startIndex) return [];
    return items.slice(startIndex, endIndex).map((item, localIndex) => {
      const globalIndex = startIndex + localIndex;
      return { item, index: globalIndex };
    });
  }, [endIndex, items, startIndex]);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{
        position: "relative",
        overflowY: "auto",
        width: "100%",
        ...style,
      }}
    >
      <div style={{ height: totalHeight, position: "relative", width: "100%" }}>
        {visibleItems.map(({ item, index }) => {
          const key = itemKey(item, index);
          const measurement = offsets[index];
          const top = measurement?.start ?? 0;
          return (
            <div
              key={key}
              style={{ position: "absolute", top, left: 0, right: 0 }}
              ref={(node) => handleMeasure(key, node)}
            >
              {renderItem(item, index)}
            </div>
          );
        })}
      </div>
    </div>
  );
}
