addEventListener('fetch', event => {
    event.respondWith(handleRequest(event.request))
})

async function handleRequest(request) {
  const GITHUB_USERNAME = ''
  const GITHUB_PAT = ''
  const GITHUB_REPO_PREFIX = ''
  const DIR = ''

  // 用户设置的密码，如果未设置则使用 GitHub PAT 的值
  const CHECK_PASSWORD = '' || GITHUB_PAT

  const GITLAB_PATS = {
    1: 'repoAPI-1',
    2: 'repoAPI-2',
    3: 'repoAPI-3',
  }

  const GITLAB_PROJECT_IDS = {
    1: 'repoID-1',
    2: 'repoID-2',
    3: 'repoID-3',
  }

  const REPOS = Object.keys(GITLAB_PATS).map(Number)

  const url = new URL(request.url)
  const FILE = url.pathname.split('/').pop()

  // 使用 CHECK_PASSWORD 检查是否为新的测试路径
  if (url.pathname === `/${CHECK_PASSWORD}`) {
    return await listProjects(REPOS, GITHUB_USERNAME, GITHUB_REPO_PREFIX, GITLAB_PROJECT_IDS, GITHUB_PAT, GITLAB_PATS)
  }

  // 构建 GitHub 的 URL 列表
  const githubUrls = REPOS.map(index => ({
    url: `https://raw.githubusercontent.com/${GITHUB_USERNAME}/${GITHUB_REPO_PREFIX}${index}/main/${DIR}/${FILE}`,
    headers: {
      'Authorization': `token ${GITHUB_PAT}`,
      'Accept': 'application/vnd.github.v3.raw'
    }
  }))

  // 构建 GitLab 的 URL 列表
  const gitlabUrls = REPOS.map(index => ({
    url: `https://gitlab.com/api/v4/projects/${GITLAB_PROJECT_IDS[index]}/repository/files/${encodeURIComponent(`${DIR}/${FILE}`)}/raw?ref=main`,
    headers: {
      'PRIVATE-TOKEN': GITLAB_PATS[index]
    }
  }))

  // 合并 GitHub 和 GitLab 的请求
  const requests = [...githubUrls, ...gitlabUrls].map(({ url, headers }) => {
    return fetch(new Request(url, {
      method: request.method,
      headers: headers
    })).then(response => {
      if (response.ok) return response;
      throw new Error(`Not Found in ${url}`);
    })
  })

  try {
    const response = await Promise.any(requests)
    const newResponse = new Response(response.body, response)
    newResponse.headers.delete('Authorization')
    newResponse.headers.delete('PRIVATE-TOKEN')
    return newResponse
  } catch (error) {
    return new Response(`404: Cannot find the ${FILE} in the GitHub and Gitlab picture cluster.`, { status: 404 })
  }
}

async function listProjects(repos, githubUsername, githubRepoPrefix, gitlabProjectIds, githubPat, gitlabPats) {
  let result = 'GitHub and GitLab Nodes status:\n\n';

  // 获取 GitHub 用户名
  const actualGithubUsername = await getGitHubUsername(githubPat);

  // 检查 GitHub 项目
  for (const repo of repos) {
    const githubStatus = await checkGitHubRepo(githubUsername, `${githubRepoPrefix}${repo}`, githubPat);
    result += `GitHub: ${githubRepoPrefix}${repo} - ${githubStatus} (Username: ${actualGithubUsername})\n`;
  }

  // 检查 GitLab 项目
  for (const repo of repos) {
    const gitlabUrl = `https://gitlab.com/api/v4/projects/${gitlabProjectIds[repo]}`;
    const [gitlabStatus, gitlabUsername] = await checkGitLabProject(gitlabUrl, gitlabPats[repo]);
    result += `GitLab: Project ID ${gitlabProjectIds[repo]} - ${gitlabStatus} (Username: ${gitlabUsername})\n`;
  }

  return new Response(result, {
    headers: { 'Content-Type': 'text/plain' }
  });
}

async function getGitHubUsername(pat) {
  const url = 'https://api.github.com/user';
  try {
    const response = await fetch(url, {
      headers: {
        'Authorization': `token ${pat}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'Cloudflare Worker'
      }
    });
    
    if (response.status === 200) {
      const data = await response.json();
      return data.login;
    } else {
      console.error('GitHub API Error:', response.status);
      return 'Unknown';
    }
  } catch (error) {
    console.error('GitHub request error:', error);
    return 'Error';
  }
}

async function checkGitHubRepo(owner, repo, pat) {
  const url = `https://api.github.com/repos/${owner}/${repo}`;
  try {
    const response = await fetch(url, {
      headers: {
        'Authorization': `token ${pat}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'Cloudflare Worker'
      }
    });
    
    const data = await response.json();
    
    if (response.status === 200) {
      return `working (${data.private ? 'private' : 'public'})`;
    } else if (response.status === 404) {
      return 'not found';
    } else {
      console.error('GitHub API Error:', response.status, data.message);
      return `error: ${response.status} - ${data.message}`;
    }
  } catch (error) {
    console.error('GitHub request error:', error);
    return `error: ${error.message}`;
  }
}

async function checkGitLabProject(url, pat) {
  try {
    const response = await fetch(url, {
      headers: {
        'PRIVATE-TOKEN': pat
      }
    });
    if (response.status === 200) {
      const data = await response.json();
      return [`working (${data.visibility})`, data.owner.username];
    } else if (response.status === 404) {
      return ['not found', 'Unknown'];
    } else {
      return ['disconnect', 'Unknown'];
    }
  } catch (error) {
    return ['disconnect', 'Error'];
  }
}