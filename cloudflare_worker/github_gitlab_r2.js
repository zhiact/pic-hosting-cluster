// 用户配置区域开始 =================================

// GitLab 节点配置
const GITLAB_CONFIGS = [
    { name: '', id: '', token: '' },  // GitLab 账户1
    { name: '', id: '', token: '' },  // GitLab 账户2
    { name: '', id: '', token: '' },  // GitLab 账户3
    { name: '', id: '', token: '' },  // GitLab 账户4
  ];

  // GitHub 配置
  const GITHUB_REPOS = [''];  // GitHub 仓库名列表
  const GITHUB_USERNAME = '';  // GitHub 用户名
  const GITHUB_PAT = '';  // GitHub 个人访问令牌

  // R2 存储配置
  const R2_CONFIG = {
    accountId: '',  // 帐户 ID
    accessKeyId: '',  // 访问密钥 ID
    secretAccessKey: '',  // 机密访问密钥
    bucket: '', // R2 桶名
  };

  // 其他全局配置
  const DIR = '';  // 存储目录
  const CHECK_PASSWORD = '' || GITHUB_PAT;  // 状态检查密码，默认为 GitHub PAT 的值

// 用户配置区域结束 =================================

// 监听所有请求
addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request))
})

// AWS SDK 签名相关函数开始 =================================

// 获取签名URL
async function getSignedUrl(method, path) {
  const region = 'auto';
  const service = 's3';
  const host = `${R2_CONFIG.accountId}.r2.cloudflarestorage.com`;
  const datetime = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const date = datetime.substr(0, 8);

  // 构建规范请求
  const canonicalRequest = [
    method,
    '/' + path,
    '',
    `host:${host}`,
    'x-amz-content-sha256:UNSIGNED-PAYLOAD',
    `x-amz-date:${datetime}`,
    '',
    'host;x-amz-content-sha256;x-amz-date',
    'UNSIGNED-PAYLOAD'
  ].join('\n');

  // 构建签名字符串
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    datetime,
    `${date}/${region}/${service}/aws4_request`,
    await sha256(canonicalRequest)
  ].join('\n');

  const signature = await getSignature(
    R2_CONFIG.secretAccessKey,
    date,
    region,
    service,
    stringToSign
  );

  // 构建授权头
  const authorization = [
    `AWS4-HMAC-SHA256 Credential=${R2_CONFIG.accessKeyId}/${date}/${region}/${service}/aws4_request`,
    `SignedHeaders=host;x-amz-content-sha256;x-amz-date`,
    `Signature=${signature}`
  ].join(', ');

  return {
    url: `https://${host}/${path}`,
    headers: {
      'Authorization': authorization,
      'x-amz-content-sha256': 'UNSIGNED-PAYLOAD',
      'x-amz-date': datetime,
      'Host': host
    }
  };
}

// SHA256 哈希函数
async function sha256(message) {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// HMAC-SHA256 函数
async function hmacSha256(key, message) {
  const keyBuffer = key instanceof ArrayBuffer ? key : new TextEncoder().encode(key);
  const messageBuffer = new TextEncoder().encode(message);

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBuffer,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign(
    'HMAC',
    cryptoKey,
    messageBuffer
  );

  return signature;
}

// 获取签名
async function getSignature(secret, date, region, service, stringToSign) {
  const kDate = await hmacSha256('AWS4' + secret, date);
  const kRegion = await hmacSha256(kDate, region);
  const kService = await hmacSha256(kRegion, service);
  const kSigning = await hmacSha256(kService, 'aws4_request');
  const signature = await hmacSha256(kSigning, stringToSign);

  return Array.from(new Uint8Array(signature))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
}

// 处理所有进入的 HTTP 请求
async function handleRequest(request) {
  const isValidGithubRepos = Array.isArray(GITHUB_REPOS) &&
    GITHUB_REPOS.length > 0 &&
    GITHUB_REPOS.some(repo => repo.trim() !== '');

  const githubRepos = isValidGithubRepos
    ? GITHUB_REPOS.filter(repo => repo.trim() !== '')
    : GITLAB_CONFIGS.map(config => config.name);

  const url = new URL(request.url);
  const FILE = url.pathname.split('/').pop();
  const from = url.searchParams.get('from')?.toLowerCase();

  if (url.pathname === `/${CHECK_PASSWORD}`) {
    return await listProjects(GITLAB_CONFIGS, githubRepos, GITHUB_USERNAME, GITHUB_PAT);
  }

  const startTime = Date.now();

  // 根据不同的访问方式构建请求
  let requests = [];

  // 构建 R2 请求
  const r2Request = async () => {
    const r2Path = `${R2_CONFIG.bucket}/${DIR}/${FILE}`;
    const signedRequest = await getSignedUrl('GET', r2Path);
    return {
      url: signedRequest.url,
      headers: signedRequest.headers,
      source: 'r2',
      repo: R2_CONFIG.bucket
    };
  };

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
        if (!response.ok) throw new Error('Not found');
        const data = await response.json();
        return {
          size: data.size,
          exists: true
        };
      }
    }));

    const gitlabRequests = GITLAB_CONFIGS.map(config => ({
      url: `https://gitlab.com/api/v4/projects/${config.id}/repository/files/${encodeURIComponent(`${DIR}/${FILE}`)}?ref=main`,
      headers: {
        'PRIVATE-TOKEN': config.token
      },
      source: 'gitlab',
      repo: config.name,
      processResponse: async (response) => {
        if (!response.ok) throw new Error('Not found');
        const data = await response.json();
        const size = atob(data.content).length;
        return {
          size: size,
          exists: true
        };
      }
    }));

    // R2 where 请求
    const r2WhereRequest = {
      ...(await r2Request()),
      processResponse: async (response) => {
        if (!response.ok) throw new Error('Not found');
        const size = response.headers.get('content-length');
        return {
          size: parseInt(size),
          exists: true
        };
      }
    };

    requests = [...githubRequests, ...gitlabRequests, r2WhereRequest];
  } else {
    // 获取文件内容模式
    if (from === 'github') {
      requests = githubRepos.map(repo => ({
        url: `https://raw.githubusercontent.com/${GITHUB_USERNAME}/${repo}/main/${DIR}/${FILE}`,
        headers: {
          'Authorization': `token ${GITHUB_PAT}`,
          'User-Agent': 'Cloudflare Worker'
        },
        source: 'github',
        repo: repo
      }));
    } else if (from === 'gitlab') {
      requests = GITLAB_CONFIGS.map(config => ({
        url: `https://gitlab.com/api/v4/projects/${config.id}/repository/files/${encodeURIComponent(`${DIR}/${FILE}`)}/raw?ref=main`,
        headers: {
          'PRIVATE-TOKEN': config.token
        },
        source: 'gitlab',
        repo: config.name
      }));
    } else if (from === 'r2') {
      requests = [await r2Request()];
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
        })),
        await r2Request()
      ];
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
          const result = await processResponse(response);
          const endTime = Date.now();
          const duration = endTime - startTime;

          const formattedSize = result.size > 1024 * 1024
            ? `${(result.size / (1024 * 1024)).toFixed(2)} MB`
            : `${(result.size / 1024).toFixed(2)} kB`;

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
        // 对于内容获取，直接返回响应
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

    // 使用 Promise.any 获取第一个成功的响应
    const result = await Promise.any(fetchPromises);

    if (from === 'where') {
      return new Response(JSON.stringify(result, null, 2), {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    } else {
      const newResponse = new Response(result.body, result);
      // 清除敏感header
      newResponse.headers.delete('Authorization');
      newResponse.headers.delete('PRIVATE-TOKEN');
      newResponse.headers.delete('x-amz-content-sha256');
      newResponse.headers.delete('x-amz-date');
      return newResponse;
    }
  } catch (error) {
    const sourceText = from === 'where'
      ? 'in any repository'
      : from
        ? `from ${from}`
        : 'in the GitHub, GitLab and R2 storage';
    return new Response(`404: Cannot find the ${FILE} ${sourceText}.`, { status: 404 });
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
        checkGitLabProject(config.id, config.token)
      )
    ]);

    // 处理 GitHub 检查结果
    const githubResults = allChecks.slice(0, githubRepos.length);
    const gitlabResults = allChecks.slice(githubRepos.length);

    // 添加 GitHub 结果到输出
    githubRepos.forEach((repo, index) => {
      const [status, fileCount, totalSize] = githubResults[index];
      const formattedSize = formatSize(totalSize);
      result += `GitHub: ${repo} - ${status} (Username: ${username}, Files: ${fileCount}, Size: ${formattedSize})\n`;
    });

    // 添加 GitLab 结果到输出
    gitlabConfigs.forEach((config, index) => {
      const [status, username, fileCount, totalSize] = gitlabResults[index];
      const formattedSize = formatSize(totalSize);
      result += `GitLab: Project ID ${config.id} - ${status} (Username: ${username}, Files: ${fileCount})\n`;
    });

  } catch (error) {
    result += `Error during status check: ${error.message}\n`;
  }

  return new Response(result, {
    headers: { 'Content-Type': 'text/plain' }
  });
}

// 文件大小格式化函数
function formatSize(sizeInBytes) {
  if (sizeInBytes >= 1024 * 1024 * 1024) {
    return `${(sizeInBytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  } else if (sizeInBytes >= 1024 * 1024) {
    return `${(sizeInBytes / (1024 * 1024)).toFixed(2)} MB`;
  } else {
    return `${(sizeInBytes / 1024).toFixed(2)} kB`;
  }
}

// 获取 GitHub 用户名的异步函数
async function getGitHubUsername(pat) {
  const url = 'https://api.github.com/user';  // GitHub 用户信息 API 地址
  try {
    const response = await fetch(url, {
      headers: {
        'Authorization': `token ${pat}`,  // 使用个人访问令牌进行授权
        'Accept': 'application/vnd.github.v3+json',  // 指定接受的响应格式
        'User-Agent': 'Cloudflare Worker'  // 用户代理
      }
    });

    // 如果响应状态为 200，表示成功
    if (response.status === 200) {
      const data = await response.json();  // 解析 JSON 数据
      return data.login;  // 返回用户登录名
    } else {
      console.error('GitHub API Error:', response.status);  // 记录错误状态
      return 'Unknown';  // 返回未知状态
    }
  } catch (error) {
    console.error('GitHub request error:', error);  // 记录请求错误
    return 'Error';  // 返回错误状态
  }
}

// 检查 GitHub 仓库的异步函数
async function checkGitHubRepo(owner, repo, pat) {
  const repoUrl = `https://api.github.com/repos/${owner}/${repo}`;  // 仓库信息 API 地址
  const contentsUrl = `https://api.github.com/repos/${owner}/${repo}/git/trees/main?recursive=1`;  // 获取仓库文件树的 API 地址

  const headers = {
    'Authorization': `token ${pat}`,  // 使用个人访问令牌进行授权
    'Accept': 'application/vnd.github.v3+json',  // 指定接受的响应格式
    'User-Agent': 'Cloudflare Worker'  // 用户代理
  };

  try {
    // 并发请求获取仓库信息和文件树
    const [repoResponse, treeResponse] = await Promise.all([
      fetch(repoUrl, { headers }),
      fetch(contentsUrl, { headers })
    ]);

    const repoData = await repoResponse.json();  // 解析仓库信息

    // 检查仓库信息请求是否成功
    if (repoResponse.status !== 200) {
      throw new Error(`Repository error: ${repoData.message}`);  // 抛出错误
    }

    // 检查文件树请求是否成功
    if (treeResponse.status !== 200) {
      throw new Error('Could not fetch repository contents');  // 抛出错误
    }

    const treeData = await treeResponse.json();  // 解析文件树数据

    // 使用 filter 和 reduce 处理所有文件
    const fileStats = treeData.tree
      .filter(item => {
        // 只处理路径以 images/ 开头的文件
        return item.type === 'blob' && item.path.startsWith('images/');
      })
      .reduce((acc, file) => {
        return {
          count: acc.count + 1,  // 文件计数
          size: acc.size + (file.size || 0)  // 累加文件大小
        };
      }, { count: 0, size: 0 });

    // 如果文件树过大，可能会被截断
    if (treeData.truncated) {
      console.warn(`Warning: Repository ${repo} tree was truncated`);  // 记录警告
    }

    return [
      `working (${repoData.private ? 'private' : 'public'})`,  // 返回仓库工作状态
      fileStats.count,  // 文件数量
      fileStats.size  // 文件总大小
    ];

  } catch (error) {
    console.error(`Error checking GitHub repo ${repo}:`, error);  // 记录错误
    return [`error: ${error.message}`, 0, 0];  // 返回错误状态
  }
}

// 检查 GitLab 项目的异步函数
async function checkGitLabProject(projectId, pat) {
  const projectUrl = `https://gitlab.com/api/v4/projects/${projectId}`;  // GitLab 项目 API 地址
  const filesUrl = `https://gitlab.com/api/v4/projects/${projectId}/repository/tree?path=images&recursive=true`;  // 获取文件树 API 地址

  try {
    // 并发请求获取项目信息和文件树
    const [projectResponse, filesResponse] = await Promise.all([
      fetch(projectUrl, {
        headers: {
          'PRIVATE-TOKEN': pat  // 使用私人令牌进行授权
        }
      }),
      fetch(filesUrl, {
        headers: {
          'PRIVATE-TOKEN': pat  // 使用私人令牌进行授权
        }
      })
    ]);

    // 检查项目信息请求是否成功
    if (projectResponse.status === 200) {
      const projectData = await projectResponse.json();  // 解析项目数据
      let fileCount = 0;  // 初始化文件计数

      // 检查文件树请求是否成功
      if (filesResponse.status === 200) {
        const filesData = await filesResponse.json();  // 解析文件数据

        // 过滤路径为 images/ 开头的文件
        const imageFiles = filesData.filter(file => file.type === 'blob' && file.path.startsWith('images/'));

        // 更新文件数量
        fileCount = imageFiles.length;  // 文件数量
      }

      return [`working (${projectData.visibility})`, projectData.owner.username, fileCount];  // 返回工作状态、用户名和文件数量
    } else if (projectResponse.status === 404) {
      return ['not found', 'Unknown', 0];  // 返回未找到状态
    } else {
      return ['disconnect', 'Unknown', 0];  // 返回断开连接状态
    }
  } catch (error) {
    return ['disconnect', 'Error', 0];  // 返回断开连接状态和错误信息
  }
}

/* 由于 GitLab 的文件大小需要逐一查询，当文件量稍大时并发量过大而导致 Worker 报以下错误，所以取消。看哪位哥哥有方案。
Error: Worker exceeded CPU time limit.
Uncaught (in response) Error: Worker exceeded CPU time limit.

async function checkGitLabProject(projectId, pat) {
  const projectUrl = `https://gitlab.com/api/v4/projects/${projectId}`;
  const filesUrl = `https://gitlab.com/api/v4/projects/${projectId}/repository/tree?path=images&recursive=true`;

  try {
    const [projectResponse, filesResponse] = await Promise.all([
      fetch(projectUrl, {
        headers: {
          'PRIVATE-TOKEN': pat
        }
      }),
      fetch(filesUrl, {
        headers: {
          'PRIVATE-TOKEN': pat
        }
      })
    ]);

    if (projectResponse.status === 200) {
      const projectData = await projectResponse.json();
      let totalSize = 0;
      let fileCount = 0;

      if (filesResponse.status === 200) {
        const filesData = await filesResponse.json();

        // 过滤路径为 images/ 开头的文件
        const imageFiles = filesData.filter(file => file.type === 'blob' && file.path.startsWith('images/'));

        // 更新文件数量
        fileCount = imageFiles.length;

        // 并发获取每个文件的大小
        const sizePromises = imageFiles.map(file => getFileSizeFromGitLab(projectId, file.path, pat));

        const sizes = await Promise.all(sizePromises);
        totalSize = sizes.reduce((acc, size) => acc + size, 0);
      }

      return [`working (${projectData.visibility})`, projectData.owner.username, fileCount, totalSize];
    } else if (projectResponse.status === 404) {
      return ['not found', 'Unknown', 0, 0];
    } else {
      return ['disconnect', 'Unknown', 0, 0];
    }
  } catch (error) {
    return ['disconnect', 'Error', 0, 0];
  }
}

// 获取单个文件大小的辅助函数
async function getFileSizeFromGitLab(projectId, filePath, pat) {
  const fileUrl = `https://gitlab.com/api/v4/projects/${projectId}/repository/files/${encodeURIComponent(filePath)}?ref=main`;
  try {
    const response = await fetch(fileUrl, {
      headers: {
        'PRIVATE-TOKEN': pat
      }
    });

    if (response.status === 200) {
      const data = await response.json();
      const size = atob(data.content).length;
      return size;
    } else {
      console.error(`Error fetching file ${filePath}:`, response.status);
      return 0;
    }
  } catch (error) {
    console.error(`Error fetching file ${filePath}:`, error.message);
    return 0;
  }
}
*/