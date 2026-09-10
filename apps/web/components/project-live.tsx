'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

export function ProjectLive({
  slug,
  version,
}: {
  slug: string;
  version: number;
}) {
  const router = useRouter();
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    const poll = async () => {
      if (document.visibilityState === 'visible') {
        try {
          const response = await fetch(
            `/api/projects/${encodeURIComponent(slug)}/version`,
            { cache: 'no-store', signal: controller.signal },
          );
          if (!response.ok) throw new Error('Unavailable');
          const latest = (await response.json()) as { version: number };
          if (!Number.isSafeInteger(latest.version) || latest.version < 1)
            throw new Error('Invalid project version');
          if (!stopped) {
            setOffline(false);
            if (latest.version !== version) router.refresh();
          }
        } catch {
          if (!stopped) setOffline(true);
        }
      }
      if (!stopped) timer = setTimeout(poll, 5000);
    };
    timer = setTimeout(poll, 5000);
    return () => {
      stopped = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [router, slug, version]);
  return (
    <span className="observer-notice" role="status">
      只读观察 · {offline ? '更新暂不可用' : '自动更新'}
    </span>
  );
}
