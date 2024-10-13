addEventListener('fetch', event => {
    event.respondWith(handleRequest(event.request))
})

// 处理所有进入的 HTTP 请求
async function handleRequest(request) {
  const GITHUB_USERNAME = '' // 设置你的 GitHub 用户名
  const GITHUB_PAT = ''  // 设置你的 GitHub PAT 令牌（Personal Access Token）
  const GITHUB_REPO_PREFIX = ''        // 仓库前缀，不要跟数字，需要结合仓库数量 REPO_COUNT 使用，比如 pic
  const REPO_COUNT = 10                   // 仓库数量，比如填10，结合前缀即为 pic1, pic2, ..., pic10
  const BLACKLISTED_REPOS = []        // 定义黑名单的仓库序号，只填序号，中间用英文逗号隔开，比如[2,5]，不请求 pic2 和 pic5
  const DIR = 'images'  // 仓库中的目录路径

  // 设置检查密码，如果未设置则使用 GitHub PAT
  const CHECK_PASSWORD = '' || GITHUB_PAT

  // 生成仓库列表，排除黑名单中的仓库
  const REPOS = Array.from({ length: REPO_COUNT }, (_, i) => i + 1)
                      .filter(index => !BLACKLISTED_REPOS.includes(index))

  // 解析请求 URL
  const url = new URL(request.url)
  const FILE = url.pathname.split('/').pop()  // 获取文件名

  // 构建 GitHub raw 文件的 URL 列表
  const urls = REPOS.map(repoNumber => `https://raw.githubusercontent.com/${GITHUB_USERNAME}/${GITHUB_REPO_PREFIX}${repoNumber}/main/${DIR}/${FILE}`)

  // 检查是否为状态检查请求
  if (url.pathname === `/${CHECK_PASSWORD}`) {
    return await listProjects(REPOS, GITHUB_USERNAME, GITHUB_REPO_PREFIX, GITHUB_PAT)
  }

  // 创建并发请求任务
  const requests = urls.map(githubUrl => {
    const modifiedRequest = new Request(githubUrl, {
      method: request.method,
      headers: {
        'Authorization': `token ${GITHUB_PAT}`,
        'Accept': 'application/vnd.github.v3.raw'
      }
    })
    return fetch(modifiedRequest).then(response => {
      if (response.ok) return response;
      throw new Error(`Not Found in ${githubUrl}`);
    })
  })

  try {
    // 等待第一个成功的请求返回结果
    const response = await Promise.any(requests)
    // 创建新的响应，移除 Authorization 头部
    const newResponse = new Response(response.body, response)
    newResponse.headers.delete('Authorization')
    return newResponse
  } catch (error) {
    // 如果所有请求都失败，返回 404 错误
    return new Response(`404: Cannot find the ${FILE} in the picture cluster.`, { status: 404 })
  }
}

// 列出所有项目状态
async function listProjects(repos, githubUsername, githubRepoPrefix, githubPat) {
  let result = 'GitHub Projects:\n\n'
  // 获取实际的 GitHub 用户名
  const actualUsername = await getGitHubUsername(githubPat)

  // 检查每个仓库的状态
  for (const repoNumber of repos) {
    const githubStatus = await checkGitHubRepo(githubUsername, `${githubRepoPrefix}${repoNumber}`, githubPat)
    result += `GitHub: ${githubRepoPrefix}${repoNumber} - ${githubStatus} (Username: ${actualUsername})\n`
  }

  return new Response(result, {
    headers: { 'Content-Type': 'text/plain' }
  })
}

// 获取 GitHub 用户名
async function getGitHubUsername(pat) {
  const url = 'https://api.github.com/user'
  try {
    const response = await fetch(url, {
      headers: {
        'Authorization': `token ${pat}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'Cloudflare Worker'
      }
    })
    
    if (response.status === 200) {
      const data = await response.json()
      return data.login
    } else {
      console.error('GitHub API Error:', response.status)
      return 'Unknown'
    }
  } catch (error) {
    console.error('GitHub request error:', error)
    return 'Error'
  }
}

// 检查 GitHub 仓库状态
async function checkGitHubRepo(owner, repo, pat) {
  const url = `https://api.github.com/repos/${owner}/${repo}`
  try {
    const response = await fetch(url, {
      headers: {
        'Authorization': `token ${pat}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'Cloudflare Worker'
      }
    })
    
    const data = await response.json()
    
    if (response.status === 200) {
      return `working (${data.private ? 'private' : 'public'})`
    } else if (response.status === 404) {
      return 'not found'
    } else {
      console.error('GitHub API Error:', response.status, data.message)
      return `error: ${response.status} - ${data.message}`
    }
  } catch (error) {
    console.error('GitHub request error:', error)
    return `error: ${error.message}`
  }
}