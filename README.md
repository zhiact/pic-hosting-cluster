# GitHub 和 GitLab 图床集群同步库

- **两个方案的配置文件都是 `config.yml`，只需要根据实际修改**

## GitHub --→ GitLab 目录下2个文件，放到 GitHub 库: 
- **配置文件**: `config.yml`
- **AC 脚本**: `./github/workflows/cluster_sync.yml`

## GitLab --→ GitHub 目录下3个文件，放到 GitLab 库: 
- **配置文件**: `config.yml`
- **同步脚本**: `sync_to_github.sh`
- **CI/CD 脚本**: `.gitlab-ci.yml`

## Cloudflare worker 目录下4个文件，复制代码到 worker 处：
- **只使用 GitHub**: `github_only.js`
- **只使用 GitLab**: `gitlab_only.js`
- **同时使用 GitHub 和 GitLab**: `github_gitlab.js`
- **同时使用 GitHub, GitLab 和 R2**: `github_gitlab_r2.js`


## 检测节点状态 `https://<自定义域名>/<GitHub PAT>`

- **正常状态**

<img width="442" alt="image-2" src="https://github.com/user-attachments/assets/15a0cb81-8a53-4d3b-9072-55ba4ed82788">

- **各种不正常状态**

<img width="442" alt="image-2" src="https://github.com/user-attachments/assets/4a74464f-366f-4ede-9b3a-5ed2fd2ff65d">

## 检测文件信息
- **从 GitHub 获取** `https://<自定义域名>/<文件名>?from=where`

## 指定文件获取平台
- **从 GitHub 获取** `https://<自定义域名>/<文件名>?from=github`

- **从 GitLab 获取** `https://<自定义域名>/<文件名>?from=gitlab`

- **从 CloudFlare R2 获取** `https://<自定义域名>/<文件名>?from=r2`