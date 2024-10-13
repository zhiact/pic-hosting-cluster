// 定义 GitLab 仓库、仓库 ID 和 API 令牌
const GITLAB_REPO_NAME = ['repoName-1', 'repoName-2', 'repoName-3'];
const GITLAB_REPO_ID = ['repoID-1', 'repoID-2', 'repoID-3'];
const GITLAB_API = ['repoAPI-1', 'repoAPI-2', 'repoAPI-3'];

// 用户设置的密码，用于状态检测功能。如果为空，则默认使用第一个 GITLAB_API 作为密码
const CHECK_PASSWORD = '' || GITLAB_API[0];

// 处理所有进入的 HTTP 请求
async function handleRequest(request) {
    // 解析请求 URL
    const url = new URL(request.url);
    const pathParts = url.pathname.split('/').filter(Boolean);

    // 检查是否为状态检测请求
    if (pathParts[0] === CHECK_PASSWORD) {
        return await listProjects();
    }

    // 验证 URL 格式
    if (pathParts.length < 1) {
        return new Response('Invalid URL format', { status: 400 });
    }

    // 获取请求的 GitLab 仓库名
    const gitlabRepo = pathParts[0];

    // 查找仓库索引
    const repoIndex = GITLAB_REPO_NAME.indexOf(gitlabRepo);
    if (repoIndex === -1) {
        return new Response('Repository not found', { status: 404 });
    }

    // 获取对应的仓库 ID 和 API 令牌
    const gitlabRepoId = GITLAB_REPO_ID[repoIndex];
    const gitlabApiToken = GITLAB_API[repoIndex];

    // 构建文件路径
    const remainingPath = pathParts.slice(1).join('/');
    const encodedPath = encodeURIComponent(remainingPath).replace(/%2F/g, '%2F');

    // 构建 GitLab API URL
    const apiUrl = `https://gitlab.com/api/v4/projects/${gitlabRepoId}/repository/files/${encodedPath}/raw?ref=main`;

    // 发送请求到 GitLab
    const response = await fetch(apiUrl, {
        method: 'GET',
        headers: {
            'PRIVATE-TOKEN': gitlabApiToken
        }
    });

    // 处理错误响应
    if (!response.ok) {
        return new Response('Error fetching from GitLab', { status: response.status });
    }

    // 获取内容类型和响应体
    const contentType = response.headers.get('Content-Type');
    const body = await response.arrayBuffer();

    // 返回响应
    return new Response(body, {
        status: response.status,
        headers: {
            'Content-Type': contentType,
            'Cache-Control': 'no-cache'
        }
    });
}

// 列出所有 GitLab 项目状态
async function listProjects() {
    let result = 'GitLab Projects:\n\n';

    // 检查每个 GitLab 项目的状态
    for (let i = 0; i < GITLAB_REPO_NAME.length; i++) {
        const [status, username] = await checkGitLabProject(GITLAB_REPO_ID[i], GITLAB_API[i]);
        result += `GitLab: ${GITLAB_REPO_NAME[i]} - ${status} (Username: ${username})\n`;
    }

    return new Response(result, {
        headers: { 'Content-Type': 'text/plain' }
    });
}

// 检查 GitLab 项目状态
async function checkGitLabProject(projectId, pat) {
    const url = `https://gitlab.com/api/v4/projects/${projectId}`;
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
            return ['error', 'Unknown'];
        }
    } catch (error) {
        console.error('GitLab request error:', error);
        return [`error: ${error.message}`, 'Error'];
    }
}

// 监听 fetch 事件
addEventListener('fetch', event => {
    event.respondWith(handleRequest(event.request));
});