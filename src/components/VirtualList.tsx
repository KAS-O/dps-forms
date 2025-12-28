import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";

type VirtualListProps<T> = {
  items: readonly T[];
  height: number;
  estimateItemHeight?: number;
  overscan?: number;
  className?: string;
  renderItem: (item: T, index: number) => ReactNode;
  itemKey?: (item: T, index: number) => string | number;
};

/**
 * Lightweight virtualization helper that does not rely on external libraries.
 * It measures rendered items on the fly and only keeps the visible subset in the DOM.
 */
export function VirtualList<T>({
  items,
  height,
  estimateItemHeight = 160,
  overscan = 3,
  className,
  renderItem,
  itemKey,
}: VirtualListProps<T>) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sizesRef = useRef<number[]>([]);
  const [sizeVersion, setSizeVersion] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);

  const ensureSizeArray = useCallback(() => {
    if (sizesRef.current.length === items.length) return;
    const next: number[] = [];
    for (let i = 0; i < items.length; i += 1) {
      next[i] = sizesRef.current[i] ?? estimateItemHeight;
    }
    sizesRef.current = next;
    setSizeVersion((v) => v + 1);
  }, [estimateItemHeight, items.length]);

  useEffect(() => {
    ensureSizeArray();
  }, [ensureSizeArray]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handleScroll = () => setScrollTop(el.scrollTop);
    el.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", handleScroll);
    };
  }, []);

  const setMeasuredSize = useCallback(
    (index: number, size: number) => {
      if (size <= 0) return;
      if (sizesRef.current[index] !== size) {
        sizesRef.current[index] = size;
        setSizeVersion((v) => v + 1);
      }
    },
    [setSizeVersion]
  );

  const layout = useMemo(() => {
    ensureSizeArray();
    const positions: number[] = new Array(items.length);
    let offset = 0;
    const version = sizeVersion;
    offset += version ? 0 : 0;
    for (let i = 0; i < items.length; i += 1) {
      positions[i] = offset;
      offset += sizesRef.current[i] ?? estimateItemHeight;
    }
    return { positions, totalHeight: offset };
  }, [ensureSizeArray, estimateItemHeight, items.length, sizeVersion]);

  const overscanPx = overscan * estimateItemHeight;
  const startOffset = Math.max(0, scrollTop - overscanPx);
  let startIndex = 0;
  while (
    startIndex < items.length &&
    layout.positions[startIndex] + (sizesRef.current[startIndex] ?? estimateItemHeight) < startOffset
  ) {
    startIndex += 1;
  }

  const maxOffset = scrollTop + height + overscanPx;
  let endIndex = startIndex;
  while (endIndex < items.length && layout.positions[endIndex] < maxOffset) {
    endIndex += 1;
  }

  const visible: number[] = [];
  for (let i = startIndex; i < endIndex; i += 1) {
    visible.push(i);
  }

  return (
    <div ref={containerRef} className={className} style={{ height, overflowY: "auto", position: "relative" }}>
      <div style={{ height: layout.totalHeight, position: "relative" }}>
        {visible.map((index) => {
          const item = items[index];
          const key = itemKey ? itemKey(item, index) : index;
          const top = layout.positions[index];
          return (
            <div
              key={key}
              style={{ position: "absolute", top, left: 0, right: 0 }}
              ref={(node) => {
                if (node) {
                  setMeasuredSize(index, node.getBoundingClientRect().height);
                }
              }}
            >
              {renderItem(item, index)}
            </div>
          );
        })}
      </div>
    </div>
  );
}
