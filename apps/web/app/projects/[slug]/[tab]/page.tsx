import { notFound } from 'next/navigation';
import { projectApi } from '../../../../lib/projects';
import { ApiState } from '../../../../components/api-state';
import { ProjectView } from '../../../../components/project-view';

export default async function ProjectPage({
  params,
  searchParams,
}: {
  params: { slug: string; tab: string };
  searchParams: { view?: string; taskCursor?: string; defectCursor?: string };
}) {
  if (!['overview', 'roadmap', 'board', 'defects'].includes(params.tab))
    notFound();
  const result = await projectApi.get(params.slug, {
    taskCursor: searchParams.taskCursor,
    defectCursor: searchParams.defectCursor,
  });
  if (!result.ok) {
    if (result.status === 404) notFound();
    return (
      <main className="page shell">
        <ApiState status={result.status} message={result.error.message} />
      </main>
    );
  }
  return (
    <ProjectView
      project={result.data}
      tab={params.tab}
      view={searchParams.view}
      taskCursor={searchParams.taskCursor}
      defectCursor={searchParams.defectCursor}
    />
  );
}
