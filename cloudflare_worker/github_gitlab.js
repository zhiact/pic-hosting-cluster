addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request))
})

// 处理所有进入的 HTTP 请求
async function handleRequest(request) {
  // 定义 GitLab 配置
  const GITLAB_CONFIGS = [
    { name: 'repo1', id: 'repoID1', token: 'repoToken1' },
    { name: 'repo2', id: 'repoID2', token: 'repoToken2' },
    { name: 'repo3', id: 'repoID3', token: 'repoToken3' },
    { name: 'repo4', id: 'repoID4', token: 'repoToken4' },
  ]

  // 定义 GitHub 配置
  const GITHUB_REPOS = ['']    // 留空的话，代表与 GitLab 的名字 GITLAB_CONFIGS.name 一样。如果 GitHub 节点与 GitLab 不一样，可以用 ['ghRepo1','ghRepo2','ghRepo3','ghRepo4']
  const GITHUB_USERNAME = ''
  const GITHUB_PAT = ''

  // 定义集群访问目录 
  const DIR = ''

  // 定义集群里全部节点连接状态，默认为 GitHub PAT
  const CHECK_PASSWORD = '' || GITHUB_PAT

  const isValidGithubRepos = Array.isArray(GITHUB_REPOS) && 
    GITHUB_REPOS.length > 0 && 
    GITHUB_REPOS.some(repo => repo.trim() !== '')

  const githubRepos = isValidGithubRepos 
    ? GITHUB_REPOS.filter(repo => repo.trim() !== '')
    : GITLAB_CONFIGS.map(config => config.name)

  const url = new URL(request.url)
  const FILE = url.pathname.split('/').pop()

  const from = url.searchParams.get('from')?.toLowerCase()

  if (url.pathname === `/${CHECK_PASSWORD}`) {
    return await listProjects(GITLAB_CONFIGS, githubRepos, GITHUB_USERNAME, GITHUB_PAT)
  }

  const startTime = Date.now()

  // 根据不同的访问方式构建请求
  let requests = []

  if (from === 'where') {
    // 获取文件信息模式
    const githubRequests = githubRepos.map(repo => ({
      url: `https://api.github.com/repos/${GITHUB_USERNAME}/${repo}/contents/${DIR}/${FILE}`,
      headers: {
        'Authorization': `token ${GITHUB_PAT}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'Cloudflare Worker'
      },
      source: 'github',
      repo: repo,
      processResponse: async (response) => {
        if (!response.ok) throw new Error('Not found')
        const data = await response.json()
        return {
          size: data.size,
          exists: true
        }
      }
    }))

    const gitlabRequests = GITLAB_CONFIGS.map(config => ({
      url: `https://gitlab.com/api/v4/projects/${config.id}/repository/files/${encodeURIComponent(`${DIR}/${FILE}`)}?ref=main`,
      headers: {
        'PRIVATE-TOKEN': config.token
      },
      source: 'gitlab', 
      repo: config.name,
      processResponse: async (response) => {
        if (!response.ok) throw new Error('Not found')
        const data = await response.json()
        const size = atob(data.content).length
        return {
          size: size,
          exists: true
        }
      }
    }))

    requests = [...githubRequests, ...gitlabRequests]
  } else {
    // 获取文件内容模式的代码保持不变...
    if (from === 'github') {
      requests = githubRepos.map(repo => ({
        url: `https://raw.githubusercontent.com/${GITHUB_USERNAME}/${repo}/main/${DIR}/${FILE}`,
        headers: {
          'Authorization': `token ${GITHUB_PAT}`,
          'User-Agent': 'Cloudflare Worker'
        },
        source: 'github',
        repo: repo
      }))
    } else if (from === 'gitlab') {
      requests = GITLAB_CONFIGS.map(config => ({
        url: `https://gitlab.com/api/v4/projects/${config.id}/repository/files/${encodeURIComponent(`${DIR}/${FILE}`)}/raw?ref=main`,
        headers: {
          'PRIVATE-TOKEN': config.token
        },
        source: 'gitlab',
        repo: config.name
      }))
    } else {
      requests = [
        ...githubRepos.map(repo => ({
          url: `https://raw.githubusercontent.com/${GITHUB_USERNAME}/${repo}/main/${DIR}/${FILE}`,
          headers: {
            'Authorization': `token ${GITHUB_PAT}`,
            'User-Agent': 'Cloudflare Worker'
          },
          source: 'github',
          repo: repo
        })),
        ...GITLAB_CONFIGS.map(config => ({
          url: `https://gitlab.com/api/v4/projects/${config.id}/repository/files/${encodeURIComponent(`${DIR}/${FILE}`)}/raw?ref=main`,
          headers: {
            'PRIVATE-TOKEN': config.token
          },
          source: 'gitlab',
          repo: config.name
        }))
      ]
    }
  }

  // 发送请求并处理响应
  const fetchPromises = requests.map(({ url, headers, source, repo, processResponse }) => {
    return fetch(new Request(url, {
      method: 'GET',
      headers: headers
    })).then(async response => {
      if (from === 'where') {
        // 对于 where 查询，使用特定的响应处理逻辑
        try {
          const result = await processResponse(response)
          const endTime = Date.now()
          const duration = endTime - startTime
          
          const formattedSize = result.size > 1024 * 1024 
            ? `${(result.size / (1024 * 1024)).toFixed(2)} MB`
            : `${(result.size / 1024).toFixed(2)} kB`

          return {
            fileName: FILE,
            size: formattedSize,
            source: `${source} (${repo})`,
            duration: `${duration}ms`
          }
        } catch (error) {
          throw new Error(`Not found in ${source} (${repo})`)
        }
      } else {
        // 对于内容获取，直接返回响应
        if (!response.ok) {
          throw new Error(`Not found in ${source} (${repo})`)
        }
        return response
      }
    }).catch(error => {
      throw new Error(`Error in ${source} (${repo}): ${error.message}`)
    })
  })

  try {
    if (requests.length === 0) {
      throw new Error('No valid source specified')
    }

    // 使用 Promise.any 获取第一个成功的响应
    const result = await Promise.any(fetchPromises)
    
    if (from === 'where') {
      return new Response(JSON.stringify(result, null, 2), {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      })
    } else {
      const newResponse = new Response(result.body, result)
      newResponse.headers.delete('Authorization')
      newResponse.headers.delete('PRIVATE-TOKEN')
      return newResponse
    }
  } catch (error) {
    const sourceText = from === 'where'
      ? 'in any repository'
      : from 
        ? `from ${from}`
        : 'in the GitHub and GitLab picture cluster'
    return new Response(`404: Cannot find the ${FILE} ${sourceText}.`, { status: 404 })
  }
}

async function listProjects(gitlabConfigs, githubRepos, githubUsername, githubPat) {
  let result = 'GitHub and GitLab Nodes status:\n\n';

  try {
    // 并发执行所有检查
    const [username, ...allChecks] = await Promise.all([
      getGitHubUsername(githubPat),
      ...githubRepos.map(repo => 
        checkGitHubRepo(githubUsername, repo, githubPat)
      ),
      ...gitlabConfigs.map(config => 
        checkGitLabProject(`https://gitlab.com/api/v4/projects/${config.id}`, config.token)
      )
    ])

    // 处理 GitHub 检查结果
    const githubResults = allChecks.slice(0, githubRepos.length)
    const gitlabResults = allChecks.slice(githubRepos.length)

    // 添加 GitHub 结果到输出
    githubRepos.forEach((repo, index) => {
      result += `GitHub: ${repo} - ${githubResults[index]} (Username: ${username})\n`
    })

    // 添加 GitLab 结果到输出
    gitlabConfigs.forEach((config, index) => {
      const [status, username] = gitlabResults[index]
      result += `GitLab: Project ID ${config.id} - ${status} (Username: ${username})\n`
    })

  } catch (error) {
    result += `Error during status check: ${error.message}\n`
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