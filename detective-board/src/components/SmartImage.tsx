import React, { useEffect, useMemo, useRef, useState } from 'react';

export interface SmartImageProps {
  urls: string[];
  alt: string;
  style?: React.CSSProperties;
  className?: string;
  onResolved?: (url: string, index: number) => void;
}

export const SmartImage: React.FC<SmartImageProps> = ({ urls, alt, style, className, onResolved }) => {
  const list = useMemo(() => urls.filter(Boolean), [urls]);
  const [idx, setIdx] = useState(0);
  const reportedRef = useRef<string | null>(null);

  useEffect(() => {
    // reset index when urls change
    setIdx(0);
    reportedRef.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list.join('|')]);

  const src = list[idx] || '';

  return (
    // eslint-disable-next-line jsx-a11y/alt-text
    <img
      src={src}
      alt={alt}
      style={style}
      className={className}
      onLoad={(e) => {
        const current = (e.currentTarget as HTMLImageElement).src;
        if (reportedRef.current !== current) {
          reportedRef.current = current;
          onResolved?.(current, idx);
        }
      }}
      onError={() => {
        setIdx((i) => (i < list.length - 1 ? i + 1 : i));
      }}
    />
  );
};

export default SmartImage;
