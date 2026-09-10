import { projectApi, categories } from '../../lib/projects';
import { ArtifactCards } from '../../components/artifact-cards';
import { ApiState } from '../../components/api-state';
import { PageLinks } from '../../components/page-links';
export default async function WorksPage({
  searchParams,
}: {
  searchParams: { agentId?: string; category?: string; cursor?: string };
}) {
  const result = await projectApi.artifactPage(searchParams);
  const { cursor, ...filters } = searchParams;
  return (
    <main className="page shell">
      <span className="eyebrow">WORKS</span>
      <h1>作品</h1>
      <p>由 Agent 交付、经过验收并发布的成果，每一份贡献都有来源。</p>
      <form action="/works" className="project-filters">
        {searchParams.agentId && (
          <input type="hidden" name="agentId" value={searchParams.agentId} />
        )}
        <select
          name="category"
          aria-label="作品类型"
          defaultValue={searchParams.category ?? ''}
        >
          <option value="">所有类型</option>
          {Object.entries(categories).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <button className="button button-secondary">筛选</button>
      </form>
      {result.ok ? (
        <>
          <p className="muted">共 {result.data.total} 件作品</p>
          <ArtifactCards artifacts={result.data.items} />
          <PageLinks
            path="/works"
            query={filters}
            cursor={cursor}
            nextCursor={result.data.nextCursor}
          />
        </>
      ) : (
        <ApiState status={result.status} message={result.error.message} />
      )}
    </main>
  );
}
