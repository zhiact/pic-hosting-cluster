#!/bin/bash

set -e

# 从文件读取配置，为防止用户没有去掉尖括号，故用 sed 处理强制去掉所有的 < > 符号
CONFIG=$(sed 's/[<>]//g; s/:/: /g; s/:[[:space:]]\+/: /g' config.yml)
GITHUB_PAT=$(awk '$1 ~ "^github_pat" {sub(/[^:]*:[[:space:]]*/, ""); print}'  <<< "$CONFIG")
GITLAB_USERNAME=$(awk '$1 ~ "^gitlab_username" {sub(/[^:]*:[[:space:]]*/, ""); print}'  <<< "$CONFIG")
GITHUB_REPO_PREFIX=$(awk '$1 ~ "^github_repo_prefix" {sub(/[^:]*:[[:space:]]*/, ""); print}'  <<< "$CONFIG")
GITLAB_REPO_PREFIX=$(awk '$1 ~ "^gitlab_repo_prefix" {sub(/[^:]*:[[:space:]]*/, ""); print}'  <<< "$CONFIG")
GITLAB_REPO_SUFFIX=($(awk '{match($1, /^[0-9]+/); if (RSTART) print substr($1, RSTART, RLENGTH)}' <<< "$CONFIG"))

# GitHub 仓库所有者
GITHUB_USERNAME=$(curl -s -H "Authorization: token $GITHUB_PAT" \
               "https://api.github.com/user" | jq -r .login)

# 初始化更新和未更新仓库的数组
UPDATED_REPOS=()
NOT_UPDATED_REPOS=()

# 同步函数
sync_repo() {
  local i=$1
  local GITLAB_REPO="${GITLAB_REPO_PREFIX}${i}"
  local GITHUB_REPO="${GITHUB_REPO_PREFIX}${i}"
  echo "================================="
  echo "同步 GitLab: $GITLAB_REPO --→ GitHub: $GITHUB_REPO"

  # 获取 GitLab PAT
  local GITLAB_TOKEN=$(awk -v key=$i '$1 ~ "^" key ":" {sub(/[^:]*:[[:space:]]*/, ""); print}'  <<< "$CONFIG")

  # 获取 GitLab 仓库的最新 commit SHA
  local GITLAB_SHA=$(curl -s -H "PRIVATE-TOKEN: $GITLAB_TOKEN" \
               "https://gitlab.com/api/v4/projects/${GITHUB_USERNAME}%2F${GITLAB_REPO}/repository/branches/main" | \
               jq -r .commit.id)

  # 如果 GitLab SHA 为 null，跳过这个仓库
  if [ "$GITLAB_SHA" = "null" ]; then
    echo "GitLab 仓库 ${GITLAB_REPO} 未找到或为空，跳过"
    NOT_UPDATED_REPOS+=("$GITLAB_REPO")
    return
  fi

  # 获取 GitHub 仓库的最新 commit SHA
  local GITHUB_SHA=$(curl -s -H "Authorization: token $GITHUB_PAT" \
               "https://api.github.com/repos/$GITHUB_USERNAME/${GITHUB_REPO}/commits/main" | \
               jq -r .sha)

  # 如果 SHA 不同，则进行同步
  if [ "$GITLAB_SHA" != "$GITHUB_SHA" ]; then
    echo "GitLab: ${GITLAB_REPO} 有更新，同步中"

    # 克隆 GitLab 仓库
    git clone https://${GITHUB_USERNAME}:${GITLAB_TOKEN}@gitlab.com/${GITHUB_USERNAME}/${GITLAB_REPO}.git
    cd ${GITLAB_REPO}
    # 设置 GitHub 远程仓库并强制推送
    git remote add github https://${GITHUB_USERNAME}:${GITHUB_PAT}@github.com/${GITHUB_USERNAME}/${GITHUB_REPO}.git
    git push -f github main
    cd ..
    rm -rf ${GITLAB_REPO}

    echo "已完成"
    UPDATED_REPOS+=("$GITLAB_REPO")
  else
    echo "GitLab: ${GITLAB_REPO} 无变化，跳过"
    NOT_UPDATED_REPOS+=("$GITLAB_REPO")
  fi
}

# 主循环
for i in "${GITLAB_REPO_SUFFIX[@]}"; do
  sync_repo $i
done

# 打印总结
echo "================================="
echo "集群各节点同步总结:"
echo "现有节点: $(( ${#UPDATED_REPOS[@]} + ${#NOT_UPDATED_REPOS[@]} ))"
echo "已更新的节点: ${UPDATED_REPOS[*]}"
echo "未更新的节点: ${NOT_UPDATED_REPOS[*]}"