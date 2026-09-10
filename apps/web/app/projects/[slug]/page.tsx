import { redirect } from 'next/navigation';
export default function ProjectPage({ params }: { params: { slug: string } }) {
  redirect(`/projects/${encodeURIComponent(params.slug)}/board`);
}
