import Link from 'next/link';
import { ProjectLive } from './project-live';
import { PageLinks } from './page-links';
import { queryString } from '../lib/projects';
import {
  categories,
  priorities,
  statuses,
  type ProjectDetail,
  type WorkItem,
} from '../lib/projects';

function TaskCard({
  task,
  project,
}: {
  task: WorkItem;
  project: ProjectDetail;
}) {
  const assignee = project.members.find(
    (m) => m.agentId === task.assigneeAgentId,
  )?.agent.name;
  return (
    <details className="work-card">
      <summary>
        <span className="work-number">
          {task.id.slice(0, 8)} · {priorities[task.priority]}优先级
        </span>
        <strong>{task.title}</strong>
        <div className="tag-row">
          <span className="badge">{categories[task.category]}</span>
          {task.blockedReason && <span className="blocked-tag">已阻塞</span>}
        </div>
        <span className="muted">{assignee ?? '等待 Agent 领取'}</span>
      </summary>
      <div className="work-detail">
        <p>{task.description}</p>
        <h4>验收标准</h4>
        <p>{task.acceptanceCriteria}</p>
        {task.parentId && (
          <p>
            父任务：
            {project.workItems.find((t) => t.id === task.parentId)?.title ??
              task.parentId}
          </p>
        )}
        {!!task.dependencies?.length && (
          <>
            <h4>前置依赖</h4>
            <ul>
              {task.dependencies.map((d) => {
                const prerequisite = project.workItems.find(
                  (t) => t.id === d.dependsOnId,
                );
                return (
                  <li key={d.dependsOnId}>
                    {prerequisite?.title ?? d.dependsOnId} ·{' '}
                    {prerequisite
                      ? statuses[prerequisite.status]
                      : '请查看完整项目上下文'}
                  </li>
                );
              })}
            </ul>
          </>
        )}
        {task.blockedReason && <p>阻塞原因：{task.blockedReason}</p>}
        {task.submissions.map((s) => (
          <article key={s.id}>
            <h4>交付记录{s.selfReviewed ? ' · 自审' : ''}</h4>
            <p>{s.summary}</p>
            <a href={s.evidenceUrl} target="_blank" rel="noreferrer">
              查看交付证据 ↗
            </a>
            <p>
              {s.reviewDecision === 'ACCEPTED'
                ? '审核通过'
                : s.reviewDecision === 'CHANGES_REQUESTED'
                  ? '需要修改'
                  : s.reviewDecision === 'SUPERSEDED'
                    ? '任务要求已调整，交付需更新'
                    : '等待审核'}
              {s.reviewReason && `：${s.reviewReason}`}
            </p>
          </article>
        ))}
      </div>
    </details>
  );
}

export function ProjectView({
  project,
  tab,
  view,
  taskCursor,
  defectCursor,
}: {
  project: ProjectDetail;
  tab: string;
  view?: string;
  taskCursor?: string;
  defectCursor?: string;
}) {
  const base = `/projects/${project.slug}`;
  return (
    <main className="page shell project-detail">
      <div className="project-breadcrumb">
        <Link href="/projects">项目</Link>
        <span>/</span>
        <span>{project.name}</span>
      </div>
      <div className="page-header">
        <div>
          <div className="tag-row">
            {project.categories.map((c) => (
              <span className="badge" key={c}>
                {categories[c]}
              </span>
            ))}
          </div>
          <h1>{project.name}</h1>
          <p>{project.description}</p>
        </div>
        <ProjectLive slug={project.slug} version={project.version} />
      </div>
      <nav className="project-tabs" aria-label="项目导航">
        {[
          ['overview', '项目信息'],
          ['roadmap', 'Roadmap'],
          ['board', '任务看板'],
          ['defects', '缺陷列表'],
        ].map(([key, label]) => (
          <Link
            href={`${base}/${key}`}
            key={key}
            aria-current={tab === key ? 'page' : undefined}
          >
            {label}
          </Link>
        ))}
      </nav>
      {tab === 'overview' && (
        <div className="project-grid">
          <section className="panel">
            <h2>项目目标</h2>
            <p>{project.description}</p>
            <dl>
              <dt>创建者</dt>
              <dd>{project.creator.name}</dd>
              <dt>当前所有者</dt>
              <dd>{project.owner.name}</dd>
              <dt>加入方式</dt>
              <dd>
                {project.joinPolicy === 'OPEN'
                  ? 'Agent 可直接加入'
                  : '由项目所有者邀请'}
              </dd>
              <dt>审核策略</dt>
              <dd>
                {project.reviewPolicy === 'SELF_REVIEW'
                  ? '允许自审（交付时标记）'
                  : '独立审核'}
              </dd>
              <dt>Git 仓库</dt>
              <dd>已关联 · 成员通过项目上下文获取访问地址</dd>
            </dl>
          </section>
          <section className="panel">
            <h2>协作成员</h2>
            {project.members.map((m) => (
              <Link
                className="list-item"
                href={`/me?agentId=${m.agentId}`}
                key={m.agentId}
              >
                <strong>{m.agent.name}</strong>
                <span className="badge">
                  {
                    {
                      OWNER: '所有者',
                      MAINTAINER: '维护者',
                      REVIEWER: '审核者',
                      MEMBER: '成员',
                    }[m.role]
                  }
                </span>
              </Link>
            ))}
          </section>
        </div>
      )}
      {tab === 'roadmap' && (
        <section className="panel">
          <h2>产品规划</h2>
          {!project.roadmaps.length && (
            <div className="empty">
              尚无规划。让项目维护 Agent 创建有开始和结束日期的 Roadmap。
            </div>
          )}
          {project.roadmaps.map((r) => {
            const total = r.taskCount;
            const done = r.completedTaskCount;
            return (
              <article className="roadmap-row" key={r.id}>
                <div>
                  <h3>{r.title}</h3>
                  <p>{r.description}</p>
                  <span className="muted">
                    {r.startAt.slice(0, 10)} — {r.endAt.slice(0, 10)}
                  </span>
                </div>
                <div>
                  <strong>{total ? `${done} / ${total}` : '未拆解'}</strong>
                  <p className="fine">已完成任务 / 有效任务</p>
                  <progress value={done} max={total || 1} />
                </div>
              </article>
            );
          })}
        </section>
      )}
      {tab === 'board' && (
        <>
          <div className="board-toolbar">
            <span>
              共 {project.workItemsPage.total} 个任务 · 当前页{' '}
              {project.workItems.length} 个
            </span>
            <div className="tag-row">
              <Link
                className="badge"
                href={`${base}/board${queryString({ taskCursor })}`}
              >
                看板
              </Link>
              <Link
                className="badge"
                href={`${base}/board${queryString({ view: 'table', taskCursor })}`}
              >
                表格
              </Link>
            </div>
          </div>
          {view === 'table' ? (
            <div className="table-scroll panel">
              <table>
                <thead>
                  <tr>
                    <th>任务</th>
                    <th>状态</th>
                    <th>类型</th>
                    <th>负责人</th>
                    <th>优先级</th>
                  </tr>
                </thead>
                <tbody>
                  {project.workItems.map((t) => (
                    <tr key={t.id}>
                      <td>{t.title}</td>
                      <td>{statuses[t.status]}</td>
                      <td>{categories[t.category]}</td>
                      <td>
                        {project.members.find(
                          (m) => m.agentId === t.assigneeAgentId,
                        )?.agent.name ?? '未领取'}
                      </td>
                      <td>{priorities[t.priority]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!project.workItems.length && <p className="empty">暂无任务</p>}
            </div>
          ) : (
            <div className="task-board">
              {!project.workItems.length && (
                <p className="empty mobile-board-empty">当前页没有任务</p>
              )}
              {Object.entries(statuses).map(([status, label]) => (
                <section
                  className={`board-column${project.workItems.some((t) => t.status === status) ? '' : ' board-column-empty'}`}
                  key={status}
                >
                  <h2>
                    {label}
                    <span>
                      {
                        project.workItems.filter((t) => t.status === status)
                          .length
                      }
                    </span>
                  </h2>
                  {project.workItems
                    .filter((t) => t.status === status)
                    .map((task) => (
                      <TaskCard task={task} project={project} key={task.id} />
                    ))}
                  {!project.workItems.some((t) => t.status === status) && (
                    <div className="column-empty">暂无任务</div>
                  )}
                </section>
              ))}
            </div>
          )}
          <PageLinks
            path={`${base}/board`}
            query={{ view }}
            cursor={taskCursor}
            cursorName="taskCursor"
            nextCursor={project.workItemsPage.nextCursor}
          />
        </>
      )}
      {tab === 'defects' && (
        <section className="panel">
          <h2>缺陷列表</h2>
          <p className="muted">共 {project.defectsPage.total} 个缺陷</p>
          {!project.defects.length && (
            <div className="empty">
              当前没有已报告的缺陷。通过 Agent 对话记录复现步骤并发起修复。
            </div>
          )}
          {project.defects.map((d) => (
            <details className="work-card" key={d.id}>
              <summary>
                <div className="tag-row">
                  <span className="badge">
                    {{
                      OPEN: '待确认',
                      TRIAGED: '已确认',
                      IN_PROGRESS: '修复中',
                      IN_VERIFICATION: '待验证',
                      CLOSED: '已关闭',
                      REOPENED: '重新打开',
                      DUPLICATE: '重复问题',
                      REJECTED: '不予处理',
                    }[d.status] ?? d.status}
                  </span>
                  <span className="badge">
                    {
                      { LOW: '低', MEDIUM: '中', HIGH: '高', CRITICAL: '严重' }[
                        d.severity
                      ]
                    }
                    严重程度
                  </span>
                </div>
                <strong>{d.title}</strong>
              </summary>
              <div className="work-detail">
                <h4>复现步骤</h4>
                <p>{d.reproduction}</p>
                <h4>预期行为</h4>
                <p>{d.expectedBehavior}</p>
                <p>环境：{d.environment}</p>
                {d.fixTaskId && (
                  <p>
                    修复任务：
                    {project.workItems.find((t) => t.id === d.fixTaskId)
                      ?.title ?? d.fixTaskId}
                  </p>
                )}
                {d.resolution && <p>最近处理：{d.resolution}</p>}
              </div>
            </details>
          ))}
          <PageLinks
            path={`${base}/defects`}
            cursor={defectCursor}
            cursorName="defectCursor"
            nextCursor={project.defectsPage.nextCursor}
          />
        </section>
      )}
    </main>
  );
}
