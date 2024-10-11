#!/bin/bash

# 读取配置，为防止用户在 : 后面没有加空格导致 yq 出错，故用 sed 处理强制在 : 后加上空格
CONFIG=$(sed 's/:/: /g' config.yml)
GITHUB_TOKEN=$(yq eval '.github_pat' <<< "$CONFIG")
GITLAB_USERNAME=$(yq eval '.gitlab_username' <<< "$CONFIG")
GITHUB_REPO_PREFIX=$(yq eval '.github_repo_prefix' <<< "$CONFIG")
GITLAB_REPO_PREFIX=$(yq eval '.gitlab_repo_prefix' <<< "$CONFIG")
GITLAB_REPO_SUFFIX=($(yq eval '.gitlab_pats | keys | .[]' <<< "$CONFIG"))

# GitHub 仓库所有者
GITHUB_OWNER=$(curl -s -H "Authorization: token $GITHUB_TOKEN" \
               "https://api.github.com/user" | jq -r .login)

# 初始化更新和未更新仓库的数组
UPDATED_REPOS=()
NOT_UPDATED_REPOS=()

# 同步函数
sync_repo() {
    local i=$1
    local GITHUB_REPO="${GITHUB_REPO_PREFIX}${i}"
    local GITLAB_REPO="${GITLAB_REPO_PREFIX}${i}"
    echo "================================="
    echo "同步 GitHub: $GITHUB_REPO --→ GitLab: $GITLAB_REPO"

    # 获取 GitHub 仓库的最新 commit SHA
    local GITHUB_SHA=$(curl -s -H "Authorization: token $GITHUB_TOKEN" \
                   "https://api.github.com/repos/$GITHUB_OWNER/${GITHUB_REPO}/commits/main" | \
                   jq -r .sha)

    # 如果 GitHub SHA 为 null，跳过这个仓库
    if [ "$GITHUB_SHA" = "null" ]; then
        echo "GitHub 仓库 ${GITHUB_REPO} 未找到或为空，跳过"
        NOT_UPDATED_REPOS+=("$GITHUB_REPO")
        return
    fi

    # 获取对应的 GitLab PAT
    local PAT=$(yq eval ".gitlab_pats.\"$i\"" <<< "$CONFIG")

    # 获取 GitLab 仓库的最新 commit SHA
    local GITLAB_SHA=$(curl -s -H "PRIVATE-TOKEN: $PAT" \
                   "https://gitlab.com/api/v4/projects/${GITLAB_USERNAME}%2F${GITLAB_REPO}/repository/branches/main" | \
                   jq -r .commit.id)

    # 如果 SHA 不同，则进行同步
    if [ "$GITHUB_SHA" != "$GITLAB_SHA" ]; then
        echo "GitHub: ${GITHUB_REPO} 有更新，同步中"
        
        # 克隆 GitHub 仓库
        git clone https://${GITHUB_OWNER}:${GITHUB_TOKEN}@github.com/${GITHUB_OWNER}/${GITHUB_REPO}.git
        cd ${GITHUB_REPO}

        # 设置 GitLab 远程仓库并强制推送
        git remote add gitlab https://${GITLAB_USERNAME}:${PAT}@gitlab.com/${GITLAB_USERNAME}/${GITLAB_REPO}.git
        git push -f gitlab main

        cd ..
        rm -rf ${GITHUB_REPO}
        
        echo "已同步 ${GITHUB_REPO} 到 GitLab ${GITLAB_REPO}"
        UPDATED_REPOS+=("$GITHUB_REPO")
    else
        echo "${GITHUB_REPO} 无变化，跳过"
        NOT_UPDATED_REPOS+=("$GITHUB_REPO")
    fi
}

# 主循环
for i in "${GITLAB_REPO_SUFFIX[@]}"; do
    sync_repo $i
done

# 打印总结
echo "================================="
echo "集群各节点同步总结:"
echo "现有节点: $(( ${#UPDATED_REPOS[*]} + ${#NOT_UPDATED_REPOS[*]} ))"
echo "已更新的节点: ${UPDATED_REPOS[*]}"
echo "未更新的节点: ${NOT_UPDATED_REPOS[*]}"