// 用户配置区域开始 =================================

const CONFIG = {
  GITHUB_USERNAME: '', // GitHub 用户名
  GITHUB_PAT: '',     // GitHub PAT 令牌（Personal Access Token）
  GITHUB_REPO_PREFIX: '', // 仓库前缀，不要跟数字，需要结合仓库数量 REPO_COUNT 使用，比如 pic
  REPO_COUNT: 10,        // 仓库数量，比如填10，结合前缀即为 pic1, pic2, ..., pic10
  BLACKLISTED_REPOS: [], // 定义黑名单的仓库序号，只填序号，中间用英文逗号隔开，比如[2,5]，不请求 pic2 和 pic5
  DIR: '',         // 仓库中的目录路径
  CACHE_MAX_AGE: 31556952, // 缓存时间（1年）
  CHECK_PASSWORD: ''     // 检查密码，如未设置则使用 PAT
};

// 用户配置区域结束 =================================

// 生成可用仓库列表
const REPOS = Array.from({ length: CONFIG.REPO_COUNT }, (_, i) => i + 1)
  .filter(index => !CONFIG.BLACKLISTED_REPOS.includes(index));

// 获取 GitHub 用户名
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
    }
    return 'Unknown';
  } catch (error) {
    console.error('GitHub request error:', error);
    return 'Error';
  }
}

// 检查 GitHub 仓库状态
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
      return `Working (${data.private ? 'Private' : 'Public'})`;
    } else if (response.status === 404) {
      return 'Not found';
    }
    return `Error: ${response.status} - ${data.message}`;
  } catch (error) {
    return `Error: ${error.message}`;
  }
}

// 列出所有项目状态
async function listProjects(repos, githubUsername, githubRepoPrefix, githubPat) {
  const actualUsername = await getGitHubUsername(githubPat);
  const statusChecks = repos.map(async repoNumber => {
    const githubStatus = await checkGitHubRepo(githubUsername, `${githubRepoPrefix}${repoNumber}`, githubPat);
    return `GitHub: ${githubRepoPrefix}${repoNumber} - ${githubStatus} (Username: ${actualUsername})`;
  });

  const results = await Promise.all(statusChecks);
  const result = 'GitHub Repositories:\n\n' + results.join('\n');

  return new Response(result, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Language': 'en-US'
    }
  });
}

export default {
  async fetch(request, env, ctx) {
    try {
      // 缓存检查
      const cacheUrl = new URL(request.url);
      const cacheKey = new Request(cacheUrl.toString(), request);
      const cache = caches.default;
      let cacheResponse = await cache.match(cacheKey);

      if (cacheResponse) {
        return cacheResponse;
      }

      const url = new URL(request.url);
      const FILE = url.pathname.split('/').pop();

      // 检查状态请求
      if (url.pathname === `/${CONFIG.CHECK_PASSWORD || CONFIG.GITHUB_PAT}`) {
        const response = await listProjects(
          REPOS,
          CONFIG.GITHUB_USERNAME,
          CONFIG.GITHUB_REPO_PREFIX,
          CONFIG.GITHUB_PAT
        );
        return response;
      }

      // 构建 GitHub raw 文件的 URL 列表
      const urls = REPOS.map(repoNumber =>
        `https://raw.githubusercontent.com/${CONFIG.GITHUB_USERNAME}/${CONFIG.GITHUB_REPO_PREFIX}${repoNumber}/main/${CONFIG.DIR}/${FILE}`
      );

      // 创建并发请求
      const requests = urls.map(githubUrl => {
        const modifiedRequest = new Request(githubUrl, {
          method: request.method,
          headers: {
            'Authorization': `token ${CONFIG.GITHUB_PAT}`,
            'Accept': 'application/vnd.github.v3.raw'
          }
        });
        return fetch(modifiedRequest).then(response => {
          if (response.ok) return response;
          throw new Error(`Not Found in ${githubUrl}`);
        });
      });

      // 等待第一个成功的请求
      const response = await Promise.any(requests);
      const body = await response.arrayBuffer();

      // 创建新的响应
      let result = new Response(body, {
        status: response.status,
        headers: {
          'Content-Type': response.headers.get('Content-Type'),
          'Cache-Control': `public, s-maxage=${CONFIG.CACHE_MAX_AGE}`
        }
      });

      // 存储到缓存
      ctx.waitUntil(cache.put(cacheKey, result.clone()));

      return result;

    } catch (error) {
      // 错误处理
      const errorResponse = new Response(
        `404: Could not find ${url.pathname.split('/').pop()} in the image cluster.`,
        {
          status: 404,
          headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            'Cache-Control': 'no-store'
          }
        }
      );

      return errorResponse;
    }
  }
};