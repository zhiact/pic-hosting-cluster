// 用户配置区域开始 =================================

// GitLab 仓库配置列表，包含仓库名称、ID 和访问 Token
const GITLAB_CONFIGS = [
  { name: 'repo1', id: 'repoID1', token: 'repoToken1' },  // 节点1配置
  { name: 'repo2', id: 'repoID2', token: 'repoToken2' },  // 节点2配置
  { name: 'repo3', id: 'repoID3', token: 'repoToken3' },  // 节点3配置
  { name: 'repo4', id: 'repoID4', token: 'repoToken4' },  // 节点4配置
];

// GitHub 仓库列表，留空表示与 GitLab 的仓库名称一致
const GITHUB_REPOS = [''];  // 如果需要指定 GitHub 仓库名，可以在此处填写。如果 GitHub 节点与 GitLab 不一样，可以用 ['ghRepo1','ghRepo2','ghRepo3','ghRepo4']

// GitHub 用户名和个人访问令牌（PAT）
const GITHUB_USERNAME = '';  // 填写 GitHub 用户名
const GITHUB_PAT = '';      // 填写 GitHub 访问令牌

// 定义集群访问目录
const DIR = ''; // 存储的文件目录，可以为空，表示根目录

// 定义集群里全部节点连接状态的密码验证，区分大小写（优先使用自定义密码，若为空则使用 GITHUB_PAT）
const CHECK_PASSWORD = '' || GITHUB_PAT;

// 定义全局缓存时间，单位为秒，默认值为一年（31556952秒）
const CACHE_MAX_AGE = 31556952; // 一年

// 用户配置区域结束 =================================

// Cloudflare Worker 主函数，处理 HTTP 请求
export default {
  async fetch(request, env, ctx) {
    const cacheUrl = new URL(request.url); // 获取请求的 URL
    const cacheKey = new Request(cacheUrl.toString(), request); // 创建缓存键
    const cache = caches.default; // 使用默认缓存
    let cacheResponse = await cache.match(cacheKey); // 查询是否已缓存
    if (cacheResponse) {
      // 如果有缓存，直接返回缓存内容
      return cacheResponse;
    }

    // 验证 GitHub 仓库列表是否有效
    const isValidGithubRepos = Array.isArray(GITHUB_REPOS) &&
      GITHUB_REPOS.length > 0 &&
      GITHUB_REPOS.some(repo => repo.trim() !== '');

    // 如果 GitHub 仓库列表无效，使用 GitLab 的仓库名称
    const githubRepos = isValidGithubRepos
      ? GITHUB_REPOS.filter(repo => repo.trim() !== '')
      : GITLAB_CONFIGS.map(config => config.name);

    const url = new URL(request.url); // 获取请求 URL 的对象表示
    const FILE = url.pathname.split('/').pop(); // 获取请求文件名
    const from = url.searchParams.get('from')?.toLowerCase(); // 获取来源参数

    if (url.pathname === `/${CHECK_PASSWORD}`) {
      // 如果路径匹配密码，则执行项目列表的查询功能
      const result = await listProjects(GITLAB_CONFIGS, githubRepos, GITHUB_USERNAME, GITHUB_PAT);
      result.headers.append("Cache-Control", `s-maxage=${CACHE_MAX_AGE}`); // 添加缓存头
      ctx.waitUntil(cache.put(cacheKey, result.clone())); // 异步存入缓存
      return result;
    }

    const startTime = Date.now(); // 记录请求开始时间
    let requests = []; // 初始化请求数组

    // 构建 API 请求数组，根据请求来源（GitHub 或 GitLab 或混合）
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

    const fetchPromises = requests.map(({ url, headers, source, repo, processResponse }) => {
      return fetch(new Request(url, {
        method: 'GET',
        headers: headers
      })).then(async response => {
        if (from === 'where') {
          // 查询文件所在位置
          try {
            const result = await processResponse(response);
            const endTime = Date.now(); // 记录请求结束时间
            const duration = endTime - startTime; // 计算请求耗时

            // 格式化文件大小
            const formattedSize = result.size > 1024 * 1024
              ? `${(result.size / (1024 * 1024)).toFixed(2)} MB`
              : `${(result.size / 1024).toFixed(2)} kB`;

            // 返回文件信息
            return {
              fileName: FILE,
              size: formattedSize,
              source: `${source} (${repo})`,
              duration: `${duration}ms`
            };
          } catch (error) {
            throw new Error(`Not found in ${source} (${repo})`);
          }
        } else {
          // 如果不是 "where" 查询，直接返回响应内容
          if (!response.ok) {
            throw new Error(`Not found in ${source} (${repo})`);
          }
          return response;
        }
      }).catch(error => {
        throw new Error(`Error in ${source} (${repo}): ${error.message}`);
      });
    });

    try {
      if (requests.length === 0) {
        throw new Error('No valid source specified');
      }

      const result = await Promise.any(fetchPromises);

      let response;
      if (from === 'where') {
        // 如果是 where 查询，返回 JSON 格式响应
        response = new Response(JSON.stringify(result, null, 2), {
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          }
        });
      } else if (result instanceof Response) {
        // 先读取响应体
        const blob = await result.blob();

        // 创建新的响应，只使用最基本的必要头部
        response = new Response(blob, {
          status: 200,
          headers: {
            'Content-Type': result.headers.get('Content-Type') || 'application/octet-stream',
            'Access-Control-Allow-Origin': '*'
          }
        });
      } else {
        throw new Error("Unexpected result type");
      }

      // 添加缓存控制
      if (from !== 'where') {
        // 只缓存成功的响应
        ctx.waitUntil(cache.put(cacheKey, response.clone()));
      }

      return response;

    } catch (error) {
      const sourceText = from === 'where'
        ? 'in any repository'
        : from
          ? `from ${from}`
          : 'in the GitHub and GitLab picture cluster';

      const errorResponse = new Response(
        `404: Cannot find the ${FILE} ${sourceText}.`,
        {
          status: 404,
          headers: {
            'Content-Type': 'text/plain',
            'Access-Control-Allow-Origin': '*'
          }
        }
      );

      return errorResponse;
    }
  }
}

// 列出所有节点仓库状态
async function listProjects(gitlabConfigs, githubRepos, githubUsername, githubPat) {
  let result = 'GitHub and GitLab Nodes status:\n\n';

  try {
    // 检查 GitHub 用户名（整体）
    const username = await getGitHubUsername(githubPat);

    // 检查 GitHub 仓库状态
    const githubChecks = await Promise.all(
      githubRepos.map(repo => checkGitHubRepoStatus(githubUsername, repo, githubPat))
    );

    // 检查 GitLab 项目状态
    const gitlabChecks = await Promise.all(
      gitlabConfigs.map(config => checkGitLabProjectStatus(config.id, config.token))
    );

    // 检查文件和大小
    const fileChecks = await Promise.all([
      ...githubRepos.map(repo => checkGitHubFiles(githubUsername, repo, githubPat, DIR)),
      ...gitlabConfigs.map(config => checkGitLabFiles(config.id, config.token, DIR))
    ]);

    // 整合 GitHub 结果
    githubRepos.forEach((repo, index) => {
      const { status } = githubChecks[index];
      const { fileCount, totalSize } = fileChecks[index];
      const formattedSize = formatSize(totalSize);
      result += `GitHub: ${repo} - ${status} (Username: ${username}, Files: ${fileCount}, Size: ${formattedSize})\n`;
    });

    // 整合 GitLab 结果
    gitlabConfigs.forEach((config, index) => {
      const { status, username } = gitlabChecks[index];
      const { fileCount } = fileChecks[githubRepos.length + index];
      result += `GitLab: Project ID ${config.id} - ${status} (Username: ${username}, Files: ${fileCount})\n`;
    });

  } catch (error) {
    result += `Error during status check: ${error.message}\n`;
  }

  return new Response(result, {
    headers: {
      'Content-Type': 'text/plain',
      'Access-Control-Allow-Origin': '*'
    }
  });
}

// 获取 GitHub 用户名的异步函数
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

// 检查 GitHub 仓库状态
async function checkGitHubRepoStatus(owner, repo, pat) {
  const url = `https://api.github.com/repos/${owner}/${repo}`;
  try {
    const response = await fetch(url, {
      headers: {
        'Authorization': `token ${pat}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'Cloudflare Worker'
      }
    });
    if (!response.ok) {
      return { status: response.status === 404 ? 'not found' : 'error' };
    }
    return { status: 'working' };
  } catch (error) {
    return { status: `error: ${error.message}` };
  }
}

// 检查 GitHub 文件数量和大小
async function checkGitHubFiles(owner, repo, pat, path) {
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
  let totalSize = 0;
  let fileCount = 0;

  try {
    const response = await fetch(url, {
      headers: {
        'Authorization': `token ${pat}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'Cloudflare Worker'
      }
    });

    if (!response.ok) {
      return { fileCount, totalSize };
    }

    const data = await response.json();
    for (const item of data) {
      if (item.type === 'file') {
        totalSize += item.size;
        fileCount++;
      }
    }

    return { fileCount, totalSize };
  } catch (error) {
    return { fileCount, totalSize };
  }
}

// 检查 GitLab 项目状态
async function checkGitLabProjectStatus(projectId, token) {
  const url = `https://gitlab.com/api/v4/projects/${projectId}`;
  try {
    const response = await fetch(url, {
      headers: { 'PRIVATE-TOKEN': token }
    });
    if (!response.ok) {
      return { status: response.status === 404 ? 'not found' : 'error', username: 'Unknown' };
    }
    const data = await response.json();
    return { status: 'working', username: data.owner?.username || 'Unknown' };
  } catch (error) {
    return { status: `error: ${error.message}`, username: 'Error' };
  }
}

// 检查 GitLab 文件数量
async function checkGitLabFiles(projectId, token, path) {
  const url = `https://gitlab.com/api/v4/projects/${projectId}/repository/tree?path=${encodeURIComponent(path)}&per_page=100`;
  let fileCount = 0;

  try {
    const response = await fetch(url, {
      headers: { 'PRIVATE-TOKEN': token }
    });
    if (!response.ok) {
      return { fileCount };
    }

    const data = await response.json();
    for (const item of data) {
      if (item.type === 'blob') {
        fileCount++;
      }
    }

    return { fileCount };
  } catch (error) {
    return { fileCount };
  }
}

// 格式化文件大小
function formatSize(bytes) {
  if (bytes > 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  } else if (bytes > 1024) {
    return `${(bytes / 1024).toFixed(2)} kB`;
  }
  return `${bytes} B`;
}