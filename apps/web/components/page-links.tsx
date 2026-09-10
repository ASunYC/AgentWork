import Link from 'next/link';
import { queryString } from '../lib/projects';

export function PageLinks({
  path,
  query = {},
  cursor,
  nextCursor,
  cursorName = 'cursor',
}: {
  path: string;
  query?: Record<string, string | undefined>;
  cursor?: string;
  nextCursor: string | null;
  cursorName?: string;
}) {
  if (!cursor && !nextCursor) return null;
  return (
    <nav aria-label="分页" className="board-toolbar">
      {cursor ? (
        <Link
          className="button button-secondary"
          href={`${path}${queryString(query)}`}
        >
          返回第一页
        </Link>
      ) : (
        <span />
      )}
      {nextCursor && (
        <Link
          className="button button-secondary"
          href={`${path}${queryString({ ...query, [cursorName]: nextCursor })}`}
        >
          下一页
        </Link>
      )}
    </nav>
  );
}
