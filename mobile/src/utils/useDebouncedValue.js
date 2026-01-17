import { useEffect, useState } from 'react';

export function useDebouncedValue(value, delayMs = 180) {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const delay = Math.max(0, Number(delayMs) || 0);
    const id = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(id);
  }, [value, delayMs]);

  return debouncedValue;
}
