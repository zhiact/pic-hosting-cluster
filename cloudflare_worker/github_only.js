addEventListener('fetch', event => {
    event.respondWith(handleRequest(event.request))
})

async function handleRequest(request) {
  const GITHUB_USERNAME = '' // 设置你的 GitHub 用户名
  const GITHUB_PAT = ''  // 设置你的 GitHub PAT 令牌（Personal Access Token）
  const GITHUB_REPO_PREFIX = ''        // 仓库前缀，不要跟数字，需要结合仓库数量 REPO_COUNT 使用，比如 pic
  const REPO_COUNT = 10                   // 仓库数量，比如填10，结合前缀即为 pic1, pic2, ..., pic10
  const BLACKLISTED_REPOS = []        // 定义黑名单的仓库序号，只填序号，中间用英文逗号隔开，比如[2,5]，不请求 pic2 和 pic5
  const DIR = 'images'  // 仓库中的目录路径

  // 用户设置的密码，如果未设置则使用 GITHUB_PAT
  const CHECK_PASSWORD = '' || GITHUB_PAT

  // 生成仓库列表，排除黑名单中的仓库
  const REPOS = Array.from({ length: REPO_COUNT }, (_, i) => i + 1)
                      .filter(index => !BLACKLISTED_REPOS.includes(index))

  // 从请求的 URL 中获取文件名
  const url = new URL(request.url)
  const FILE = url.pathname.split('/').pop()  // 获取 URL 中的最后一部分作为文件名

  // 构建 GitHub raw 文件的 URL 列表（排除黑名单仓库）
  const urls = REPOS.map(repoNumber => `https://raw.githubusercontent.com/${GITHUB_USERNAME}/${GITHUB_REPO_PREFIX}${repoNumber}/main/${DIR}/${FILE}`)

  // 使用 CHECK_PASSWORD 检查是否为新的测试路径
  if (url.pathname === `/${CHECK_PASSWORD}`) {
    return await listProjects(REPOS, GITHUB_USERNAME, GITHUB_REPO_PREFIX, GITHUB_PAT)
  }

  // 创建并发请求任务，向所有 GitHub raw 文件 URL 请求数据
  const requests = urls.map(githubUrl => {
    const modifiedRequest = new Request(githubUrl, {
      method: request.method,
      headers: {
        'Authorization': `token ${GITHUB_PAT}`,  // 使用 GitHub PAT 进行授权
        'Accept': 'application/vnd.github.v3.raw'
      }
    })
    return fetch(modifiedRequest).then(response => {
      if (response.ok) return response; // 如果响应成功返回该响应
      throw new Error(`Not Found in ${githubUrl}`); // 如果响应不成功抛出错误
    })
  })

  try {
    // 等待第一个成功的请求返回结果
    const response = await Promise.any(requests)

    // 创建新的响应，移除 Authorization 头部，避免信息泄露
    const newResponse = new Response(response.body, response)
    newResponse.headers.delete('Authorization')

    return newResponse

  } catch (error) {
    // 如果所有请求都失败，返回 404 错误
    return new Response(`404: Cannot find the ${FILE} in the picture cluster.`, { status: 404 })
  }
}

async function listProjects(repos, githubUsername, githubRepoPrefix, githubPat) {
  let result = 'GitHub Projects:\n\n'

  // 检查 GitHub 项目
  for (const repoNumber of repos) {
    const githubStatus = await checkGitHubRepo(githubUsername, `${githubRepoPrefix}${repoNumber}`, githubPat)
    result += `GitHub: ${githubRepoPrefix}${repoNumber} - ${githubStatus}\n`
  }

  return new Response(result, {
    headers: { 'Content-Type': 'text/plain' }
  })
}

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