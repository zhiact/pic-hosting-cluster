// 定义 GitLab 配置
const GITLAB_CONFIGS = [
    { name: 'repoName-1', id: 'repoID-1', token: 'repoAPI-1' },
    { name: 'repoName-2', id: 'repoID-2', token: 'repoAPI-2' },
    { name: 'repoName-3', id: 'repoID-3', token: 'repoAPI-3' },
    { name: 'repoName-4', id: 'repoID-4', token: 'repoAPI-4' },
  ]
  
  // 用户设置的密码，用于状态检测功能。如果为空，则默认使用第一个仓库的 API 令牌作为密码
  const CHECK_PASSWORD = '' || GITLAB_CONFIGS[0].token;
  
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
          return new Response('Invalid URL format', { 
              status: 400,
              headers: { 'Content-Type': 'text/plain; charset=utf-8' }
          });
      }
  
      // 获取请求的 GitLab 仓库名
      const gitlabRepo = pathParts[0];
  
      // 查找仓库配置
      const repoConfig = GITLAB_CONFIGS.find(config => config.name === gitlabRepo);
      if (!repoConfig) {
          return new Response('Repository not found', { 
              status: 404,
              headers: { 'Content-Type': 'text/plain; charset=utf-8' }
          });
      }
  
      // 构建文件路径
      const remainingPath = pathParts.slice(1).join('/');
      const encodedPath = encodeURIComponent(remainingPath).replace(/%2F/g, '/');
  
      // 构建 GitLab API URL
      const apiUrl = `https://gitlab.com/api/v4/projects/${repoConfig.id}/repository/files/${encodedPath}/raw?ref=main`;
  
      // 发送请求到 GitLab
      const response = await fetch(apiUrl, {
          method: 'GET',
          headers: {
              'PRIVATE-TOKEN': repoConfig.token
          }
      });
  
      // 处理错误响应
      if (!response.ok) {
          return new Response('Error fetching data from GitLab', { 
              status: response.status,
              headers: { 'Content-Type': 'text/plain; charset=utf-8' }
          });
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
      const projectChecks = GITLAB_CONFIGS.map(async config => {
          const [status, username] = await checkGitLabProject(config.id, config.token);
          return `GitLab: ${config.name} - ${status} (Username: ${username})`;
      });
  
      const results = await Promise.all(projectChecks);
      const result = 'GitLab Projects:\n\n' + results.join('\n');
  
      return new Response(result, {
          headers: { 
              'Content-Type': 'text/plain; charset=utf-8',
              'Content-Language': 'en-US'
          }
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
  
  // 监听 fetch 事件
  addEventListener('fetch', event => {
      event.respondWith(handleRequest(event.request));
  });
