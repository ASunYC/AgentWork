import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, lstat, readFile, writeFile, realpath } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { readJson, writeJson, withFileLock } from './local-files.mjs';

const exec = promisify(execFile);
const digest = (value) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function exists(path) {
  try {
    return await lstat(path);
  } catch (e) {
    if (e.code === 'ENOENT') return undefined;
    throw e;
  }
}

export async function initializeProject(client, input, options = {}) {
  if (!options.directory)
    throw new Error('A new project directory is required');
  const directory = resolve(options.directory);
  if (directory === dirname(directory))
    throw new Error('Do not initialize at a filesystem root');
  if (
    options.createRemote &&
    !/^[a-zA-Z0-9][a-zA-Z0-9-]*\/[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(
      options.createRemote,
    )
  )
    throw new Error('--create-remote requires GitHub owner/repository');
  if (options.visibility && !['private', 'public'].includes(options.visibility))
    throw new Error('Repository visibility must be private or public');
  const remoteUrl = options.createRemote
    ? `https://github.com/${options.createRemote}.git`
    : input.gitUrl;
  if (options.createRemote && input.gitUrl && input.gitUrl !== remoteUrl)
    throw new Error('Git URL and requested GitHub repository differ');
  // Validate the shared contract on the API before creating files or remote repositories.
  const projectInput = await client.call('/v2/projects/validate', {
    ...input,
    gitUrl: remoteUrl,
  });
  const who = await client.call('/v2/access/me');
  const stateDirectory = join(client.directory, 'operations');
  await mkdir(stateDirectory, { recursive: true, mode: 0o700 });
  const stateFile = join(stateDirectory, `${digest(directory)}.json`);
  const command = async (program, args, cwd = directory) => {
    if (program === 'gh' && options.githubCommand)
      return options.githubCommand(args);
    try {
      return (
        await exec(program, args, {
          cwd,
          env: options.env ?? process.env,
          windowsHide: true,
          timeout: 120_000,
          maxBuffer: 1024 * 1024,
        })
      ).stdout.trim();
    } catch (e) {
      // Git/credential helpers may print URLs or credentials; keep their raw stderr out of public output.
      throw new Error(
        `${program} ${args[0]} failed${e.code === 'ENOENT' ? ': executable not installed' : ` (exit ${e.code ?? 'timeout'})`}. Check repository access and local Git configuration, then retry the same command.`,
      );
    }
  };
  const git = (...args) => command('git', args);
  const requestDigest = digest({
    projectInput,
    createRemote: options.createRemote ?? null,
    visibility: options.visibility ?? 'private',
    agentId: who.agent.id,
  });
  return withFileLock(`${stateFile}.lock`, async () => {
    let state = await readJson(stateFile);
    if (state && state.requestDigest !== requestDigest)
      throw new Error(
        'This directory belongs to a different initialization request. Reuse the original settings or choose another directory.',
      );
    if (!state) {
      if (await exists(directory))
        throw new Error(
          'Target directory already exists. Use project-bind for an existing repository.',
        );
      state = {
        operationId: randomUUID(),
        requestDigest,
        directory,
        stage: 'PENDING',
      };
      await writeJson(stateFile, state);
    }
    const save = async (stage) => {
      state.stage = stage;
      await writeJson(stateFile, state);
    };
    const writeOwned = async (relativePath, content) => {
      const path = join(directory, relativePath);
      const info = await exists(path);
      if (info) {
        if (
          info.isSymbolicLink() ||
          !info.isFile() ||
          (await readFile(path, 'utf8')) !== content
        )
          throw new Error(
            `Initialization file changed: ${relativePath}. No files were overwritten.`,
          );
      } else await writeFile(path, content, { flag: 'wx' });
    };
    try {
      if (state.stage === 'READY') {
        if (
          !(await exists(directory)) ||
          (await realpath(directory)) !== state.realDirectory
        )
          throw new Error(
            'Initialized directory is no longer present at the recorded location',
          );
        const binding = await readJson(
          join(directory, '.agentwork', 'project.json'),
        );
        if (
          binding?.projectId !== state.project.id ||
          binding.platformUrl !== client.url ||
          (await git('config', '--get', 'remote.origin.url')) !==
            projectInput.gitUrl
        )
          throw new Error('Initialized repository binding has changed');
        return { ...state.result, resumed: true };
      }
      if (!(await exists(directory))) {
        await mkdir(dirname(directory), { recursive: true });
        await mkdir(directory);
        state.realDirectory = await realpath(directory);
        await save('PENDING');
      }
      if (
        !state.realDirectory ||
        (await realpath(directory)) !== state.realDirectory
      )
        throw new Error(
          'Project directory identity changed; initialization stopped',
        );
      await command('git', [
        'check-ref-format',
        '--branch',
        projectInput.defaultBranch,
      ]);
      const gitDir = await exists(join(directory, '.git'));
      if (gitDir?.isSymbolicLink() || (gitDir && !gitDir.isDirectory()))
        throw new Error('Unexpected Git directory; initialization stopped');
      if (!gitDir) await git('init', '-b', projectInput.defaultBranch);
      await writeOwned(
        'README.md',
        `# ${projectInput.name}\n\n${projectInput.description}\n`,
      );
      await writeOwned(
        '.gitignore',
        '.env\n.env.*\n!.env.example\nnode_modules/\n.agentwork/local/\n',
      );
      if (!state.initialCommit) {
        let head;
        try {
          head = await git('rev-parse', '--verify', 'HEAD');
        } catch {
          /* New repository has no commit. */
        }
        const message = `Initialize project (AgentWork ${state.operationId})`;
        if (head) {
          if ((await git('log', '-1', '--format=%s')) !== message)
            throw new Error(
              'Repository has unrelated commits; initialization stopped',
            );
          state.initialCommit = head;
        } else {
          await git('add', '--', 'README.md', '.gitignore');
          await git(
            '-c',
            `user.name=${who.agent.name}`,
            '-c',
            `user.email=${who.agent.id}@agents.agentwork.invalid`,
            '-c',
            'commit.gpgSign=false',
            'commit',
            '-m',
            message,
            '--only',
            '--',
            'README.md',
            '.gitignore',
          );
          state.initialCommit = await git('rev-parse', 'HEAD');
        }
        await save('LOCAL_READY');
      }
      if (options.createRemote && !state.remoteCreated) {
        if (
          state.remoteCreationAttempted &&
          !options.useExistingRemote &&
          !options.retryRemoteCreate
        )
          throw new Error(
            'Remote creation had an uncertain result. Inspect the requested repository: use --use-existing-remote if it exists, or --retry-remote-create only after confirming it does not.',
          );
        if (!options.useExistingRemote) {
          await command('gh', ['auth', 'status', '--hostname', 'github.com']);
          state.remoteCreationAttempted = true;
          await save('REMOTE_PENDING');
          await command('gh', [
            'repo',
            'create',
            options.createRemote,
            `--${options.visibility ?? 'private'}`,
          ]);
        }
        state.remoteCreated = true;
        await save('REMOTE_READY');
      }
      const remotes = await git('remote');
      if (remotes.split('\n').includes('origin')) {
        if (
          (await git('config', '--get', 'remote.origin.url')) !==
          projectInput.gitUrl
        )
          throw new Error('Existing origin differs from the project Git URL');
      } else await git('remote', 'add', 'origin', projectInput.gitUrl);
      const pushCommit = async (commit, allowedPrevious) => {
        const remoteHeads = await git(
          'ls-remote',
          '--heads',
          '--',
          projectInput.gitUrl,
        );
        const lines = remoteHeads ? remoteHeads.split('\n') : [];
        const current = lines
          .find((line) =>
            line.endsWith(`\trefs/heads/${projectInput.defaultBranch}`),
          )
          ?.split(/\s+/)[0];
        if (current === commit) return;
        if (lines.length && (!allowedPrevious || current !== allowedPrevious))
          throw new Error(
            'Remote repository has unrelated history. Use checkout/project-bind; no force push was attempted.',
          );
        await git(
          'push',
          '--',
          projectInput.gitUrl,
          `${commit}:refs/heads/${projectInput.defaultBranch}`,
        );
      };
      if (!state.pushed) {
        await pushCommit(state.initialCommit);
        state.pushed = true;
        await save('PUSHED');
      }
      if (!state.project) {
        state.project = await client.call(
          '/v2/projects',
          projectInput,
          state.operationId,
        );
        await save('REGISTERED');
      }
      const bindingDir = join(directory, '.agentwork');
      if (!(await exists(bindingDir))) await mkdir(bindingDir);
      if ((await lstat(bindingDir)).isSymbolicLink())
        throw new Error('Project binding directory must not be a symlink');
      await writeOwned(
        '.agentwork/project.json',
        `${JSON.stringify({ platformUrl: client.url, projectId: state.project.id, protocolVersion: 2 }, null, 2)}\n`,
      );
      if (!state.bindingCommit) {
        const message = `Bind AgentWork project ${state.project.id}`;
        const head = await git('rev-parse', 'HEAD');
        if (head !== state.initialCommit) {
          if (
            (await git('log', '-1', '--format=%s')) !== message ||
            (await git('rev-parse', 'HEAD^')) !== state.initialCommit
          )
            throw new Error(
              'Repository changed while initialization was incomplete',
            );
          state.bindingCommit = head;
        } else {
          await git('add', '--', '.agentwork/project.json');
          await git(
            '-c',
            `user.name=${who.agent.name}`,
            '-c',
            `user.email=${who.agent.id}@agents.agentwork.invalid`,
            '-c',
            'commit.gpgSign=false',
            'commit',
            '-m',
            message,
            '--only',
            '--',
            '.agentwork/project.json',
          );
          state.bindingCommit = await git('rev-parse', 'HEAD');
        }
        await save('BOUND');
      }
      await pushCommit(state.bindingCommit, state.initialCommit);
      state.result = {
        directory,
        projectId: state.project.id,
        slug: state.project.slug,
        operationId: state.operationId,
        stage: 'READY',
        gitUrl: projectInput.gitUrl,
        commit: state.bindingCommit,
      };
      await save('READY');
      return state.result;
    } catch (error) {
      throw new Error(
        `${error.message}\nOperation ${state.operationId}, stage ${state.stage}. Re-run the same initialization to resume. Local and remote repositories have been preserved.`,
      );
    }
  });
}

export async function bindProject(client, projectId, directory) {
  if (!projectId) throw new Error('Project ID is required');
  directory = await realpath(resolve(directory));
  const context = await client.call(`/v2/projects/${projectId}/context`);
  const run = async (args) => {
    try {
      return (
        await exec('git', args, {
          cwd: directory,
          windowsHide: true,
          timeout: 30_000,
        })
      ).stdout.trim();
    } catch {
      throw new Error(
        'Could not inspect the Git repository; check the local repository and origin configuration',
      );
    }
  };
  if (
    (await realpath(await run(['rev-parse', '--show-toplevel']))) !== directory
  )
    throw new Error('Bind from the repository root');
  if (
    (await run(['config', '--get', 'remote.origin.url'])) !==
    context.project.gitUrl
  )
    throw new Error('Repository origin does not match the platform project');
  const configDir = join(directory, '.agentwork');
  if (!(await exists(configDir))) await mkdir(configDir);
  if ((await lstat(configDir)).isSymbolicLink())
    throw new Error('Binding directory must not be a symlink');
  const path = join(configDir, 'project.json');
  if ((await exists(path))?.isSymbolicLink())
    throw new Error('Binding file must not be a symlink');
  const value = { platformUrl: client.url, projectId, protocolVersion: 2 };
  const previous = await readJson(path);
  if (
    previous &&
    (previous.platformUrl !== value.platformUrl ||
      previous.projectId !== projectId ||
      previous.protocolVersion !== 2)
  )
    throw new Error('Repository is already bound to another project');
  if (!previous)
    await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, {
      flag: 'wx',
    });
  return { directory, ...value };
}

export async function findProjectBinding(start = process.cwd()) {
  let directory = resolve(start);
  while (true) {
    const path = join(directory, '.agentwork', 'project.json');
    if ((await exists(path))?.isFile()) {
      const value = await readJson(path);
      if (
        value?.protocolVersion !== 2 ||
        !/^[0-9a-f-]{36}$/i.test(value.projectId ?? '') ||
        typeof value.platformUrl !== 'string'
      )
        throw new Error('Invalid .agentwork/project.json binding');
      return { ...value, directory };
    }
    if (
      (await exists(join(directory, '.git'))) ||
      directory === dirname(directory)
    )
      return undefined;
    directory = dirname(directory);
  }
}

export async function checkoutProject(client, projectId, directory) {
  if (!directory) throw new Error('A new checkout directory is required');
  directory = resolve(directory);
  if (await exists(directory))
    throw new Error('Target already exists; choose a new checkout directory');
  const { project } = await client.call(`/v2/projects/${projectId}/context`);
  try {
    await exec(
      'git',
      [
        'clone',
        '--branch',
        project.defaultBranch,
        '--',
        project.gitUrl,
        directory,
      ],
      { windowsHide: true, timeout: 120_000, maxBuffer: 1024 * 1024 },
    );
  } catch {
    throw new Error(
      'Git clone failed. Check repository permissions, branch and destination. Any partial checkout was preserved.',
    );
  }
  await bindProject(client, projectId, directory);
  return { directory, projectId, slug: project.slug };
}
