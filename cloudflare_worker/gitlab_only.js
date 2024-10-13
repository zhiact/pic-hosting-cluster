// 定义 GitLab 仓库、仓库 ID 和 API 令牌
const GITLAB_REPO_NAME = ['repoName-1', 'repoName-2', 'repoName-3'];
const GITLAB_REPO_ID = ['repoID-1', 'repoID-2', 'repoID-3'];
const GITLAB_API = ['repoAPI-1', 'repoAPI-2', 'repoAPI-3'];

// 用户设置的密码，如果为空则禁用状态检测功能
const CHECK_PASSWORD = '';

async function handleRequest(request) {
    const url = new URL(request.url);
    const pathParts = url.pathname.split('/').filter(Boolean);

    // 检查是否为状态检测请求
    if (CHECK_PASSWORD && pathParts[0] === CHECK_PASSWORD) {
        return await listProjects();
    }

    if (pathParts.length < 1) {
        return new Response('Invalid URL format', { status: 400 });
    }

    const gitlabRepo = pathParts[0];

    const repoIndex = GITLAB_REPO_NAME.indexOf(gitlabRepo);
    if (repoIndex === -1) {
        return new Response('Repository not found', { status: 404 });
    }

    const gitlabRepoId = GITLAB_REPO_ID[repoIndex];
    const gitlabApiToken = GITLAB_API[repoIndex];

    const remainingPath = pathParts.slice(1).join('/');
    const encodedPath = encodeURIComponent(remainingPath).replace(/%2F/g, '%2F');

    const apiUrl = `https://gitlab.com/api/v4/projects/${gitlabRepoId}/repository/files/${encodedPath}/raw?ref=main`;

    const response = await fetch(apiUrl, {
        method: 'GET',
        headers: {
            'PRIVATE-TOKEN': gitlabApiToken
        }
    });

    if (!response.ok) {
        return new Response('Error fetching from GitLab', { status: response.status });
    }

    const contentType = response.headers.get('Content-Type');
    const body = await response.arrayBuffer();

    return new Response(body, {
        status: response.status,
        headers: {
            'Content-Type': contentType,
            'Cache-Control': 'no-cache'
        }
    });
}

async function listProjects() {
    let result = 'GitLab Projects:\n\n';

    for (let i = 0; i < GITLAB_REPO_NAME.length; i++) {
        const status = await checkGitLabProject(GITLAB_REPO_ID[i], GITLAB_API[i]);
        result += `GitLab: ${GITLAB_REPO_NAME[i]} - ${status}\n`;
    }

    return new Response(result, {
        headers: { 'Content-Type': 'text/plain' }
    });
}

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
            return `working (${data.visibility})`;
        } else if (response.status === 404) {
            return 'not found';
        } else {
            return 'error';
        }
    } catch (error) {
        console.error('GitLab request error:', error);
        return `error: ${error.message}`;
    }
}

addEventListener('fetch', event => {
    event.respondWith(handleRequest(event.request));
});