// 用户配置区域开始 =================================

// 定义 GitLab 配置
const GITLAB_CONFIGS = [
    { name: 'repoName-1', id: 'repoID-1', token: 'repoAPI-1' },
    { name: 'repoName-2', id: 'repoID-2', token: 'repoAPI-2' },
    { name: 'repoName-3', id: 'repoID-3', token: 'repoAPI-3' },
    { name: 'repoName-4', id: 'repoID-4', token: 'repoAPI-4' },
];

// 用户设置的密码，用于状态检测功能，区分大小写。如果为空，则默认使用第一个仓库的 API 令牌作为密码
const CHECK_PASSWORD = '' || GITLAB_CONFIGS[0].token;

// 定义全局缓存时间，单位为秒，默认值为一年
const CACHE_MAX_AGE = 31556952; // 一年

// 用户配置区域结束 =================================

// 处理所有进入的 HTTP 请求
async function checkGitLabProject(projectId, pat) {
  const url = `https://gitlab.com/api/v4/projects/${projectId}`;
  try {
    const response = await fetch(url, {
      headers: {
        'PRIVATE-TOKEN': pat,
      },
    });

    if (response.status === 200) {
      const data = await response.json();
      return [`Working normally (${data.visibility})`, data.owner.username];
    } else if (response.status === 404) {
      return ['Not found', 'Unknown'];
    } else {
      return ['Error', 'Unknown'];
    }
  } catch (error) {
    console.error('GitLab request error:', error);
    return [`Error: ${error.message}`, 'Error'];
  }
}

// 列出所有 GitLab 项目状态
async function listProjects() {
  const projectChecks = GITLAB_CONFIGS.map(async (config) => {
    const [status, username] = await checkGitLabProject(config.id, config.token);
    return `GitLab: ${config.name} - ${status} (Username: ${username})`;
  });

  const results = await Promise.all(projectChecks);
  const result = 'GitLab Projects:\n\n' + results.join('\n');

  return new Response(result, {
    headers: {
      'Content-Type': 'text/plain',
      'Access-Control-Allow-Origin': '*'
    }
  });
}

export default {
  async fetch(request, env, ctx) {
    try {
      const cacheUrl = new URL(request.url);
      const cacheKey = new Request(cacheUrl.toString(), request);
      const cache = caches.default;

      let cacheResponse = await cache.match(cacheKey);
      if (cacheResponse) {
        return cacheResponse;
      }

      const url = new URL(request.url);
      const pathParts = url.pathname.split('/').filter(Boolean);

      // 检查是否为状态检测请求
      if (pathParts[0] === CHECK_PASSWORD) {
        return await listProjects();
      }

      if (pathParts.length < 1) {
        return new Response('Invalid URL format', {
          status: 400,
          headers: {
            'Content-Type': 'text/plain',
            'Access-Control-Allow-Origin': '*'
          }
        });
      }

      const gitlabRepo = pathParts[0];
      const repoConfig = GITLAB_CONFIGS.find(repo => repo.name === gitlabRepo);

      if (!repoConfig) {
        return new Response('Repository not found', {
          status: 404,
          headers: {
            'Content-Type': 'text/plain',
            'Access-Control-Allow-Origin': '*'
          }
        });
      }

      // 修改文件路径处理方式
      const filePath = pathParts.slice(1).join('/');
      console.log('Accessing file:', filePath);

      // 检查文件是否存在
      const checkUrl = `https://gitlab.com/api/v4/projects/${repoConfig.id}/repository/files/${encodeURIComponent(filePath)}?ref=main`;
      const checkResponse = await fetch(checkUrl, {
        headers: {
          'PRIVATE-TOKEN': repoConfig.token
        }
      });

      if (checkResponse.status === 404) {
        console.log('File not found:', filePath);
        return new Response('File not found', {
          status: 404,
          headers: {
            'Content-Type': 'text/plain',
            'Access-Control-Allow-Origin': '*'
          }
        });
      }

      // 获取文件内容
      const apiUrl = `https://gitlab.com/api/v4/projects/${repoConfig.id}/repository/files/${encodeURIComponent(filePath)}/raw?ref=main`;
      const response = await fetch(apiUrl, {
        headers: {
          'PRIVATE-TOKEN': repoConfig.token
        }
      });

      if (!response.ok) {
        console.error('GitLab API Error:', response.status);
        return new Response('Error fetching file', {
          status: response.status,
          headers: {
            'Content-Type': 'text/plain',
            'Access-Control-Allow-Origin': '*'
          }
        });
      }

      const blob = await response.blob();
      const result = new Response(blob, {
        status: 200,
        headers: {
          'Content-Type': response.headers.get('Content-Type') || 'application/octet-stream',
          'Cache-Control': `public, s-maxage=${CACHE_MAX_AGE}`,
          'Access-Control-Allow-Origin': '*'
        }
      });

      ctx.waitUntil(cache.put(cacheKey, result.clone()));
      return result;

    } catch (error) {
      console.error('Worker error:', error);
      return new Response(`Internal Server Error: ${error.message}`, {
        status: 500,
        headers: {
          'Content-Type': 'text/plain',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }
  }
};