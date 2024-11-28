# R2，GitHub 和 GitLab 分布式存储集群

- **方案的配置文件都是 `config.yml`，只需要根据实际修改**

## GitHub --→ GitLab 目录下2个文件，放到 GitHub 库: 
- **配置文件**: `config.yml`
- **AC 脚本**: `./github/workflows/cluster_sync.yml`

## GitLab --→ GitHub 目录下3个文件，放到 GitLab 库: 
- **配置文件**: `config.yml`
- **同步脚本**: `sync_to_github.sh`
- **CI/CD 脚本**: `.gitlab-ci.yml`

## R2 --→ GitHub 目录下2个文件，放到 GitHub 库: 
- **配置文件**: `config.yml`
- **AC 脚本**: `./github/workflows/r2_to_github.yml`

## S2 (R2+B2) --→ GitHub 目录下2个文件，放到 GitHub 库: 
- **配置文件**: `config.yml`
- **AC 脚本**: `./github/workflows/s3_to_github.yml`

## Cloudflare worker 目录下5个文件，复制代码到 worker 处：
- **只使用 GitHub**: `github_only.js`
- **只使用 GitLab**: `gitlab_only.js`
- **同时使用 GitHub 和 GitLab**: `github_gitlab.js`
- **同时使用 GitHub, GitLab 和 R2**: `github_gitlab_r2.js`
- **同时使用 GitHub, GitLab，R2 和 B2**: `github_gitlab_s3.js`


## 检测节点状态 `https://<自定义域名>/<GitHub PAT>`

<img width="670" alt="image" src="https://github.com/user-attachments/assets/7a518dfc-7c56-4c30-bd23-d2766f39a3a8">

## 检测文件信息
- **从 GitHub 获取** `https://<自定义域名>/<文件名>?from=where`

## 指定文件获取平台
- **从 GitHub 获取** `https://<自定义域名>/<文件名>?from=github`

- **从 GitLab 获取** `https://<自定义域名>/<文件名>?from=gitlab`

- **从 Cloudflare R2 获取** `https://<自定义域名>/<文件名>?from=r2`

- **从 Backblaze B2 获取** `https://<自定义域名>/<文件名>?from=b2`