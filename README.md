# GitHub 和 GitLab 图床集群同步库

- **两个方案的配置文件都是 `config.yml`，只需要根据实际修改**

## GitHub --→ GitLab 3个文件: 
- **配置文件**: `config.yml`
- **同步脚本**: `sync_to_gitlab.sh`
- **AC 脚本**: `./github/workflows/cluster_sync.yml`

## GitLab --→ GitHub 3个文件: 
- **配置文件**: `config.yml`
- **同步脚本**: `sync_to_github.sh`
- **CI/CD 脚本**: `.gitlab-ci.yml`