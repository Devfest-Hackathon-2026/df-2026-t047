#!/usr/bin/env bash
# チームメンバーが手元の開発で Gemini（Vertex AI）を使えるよう、idea-audition プロジェクトの権限を付ける／外す。
# 実行するのはプロジェクトのオーナー（夢斗）。使い方：
#   scripts/grant-dev-access.sh member@example.com          # 権限を付ける
#   scripts/grant-dev-access.sh member@example.com --revoke # 権限を外す
set -euo pipefail

EMAIL="${1:?使い方: scripts/grant-dev-access.sh <Googleアカウントのメール> [--revoke]}"
ACTION="${2:-}"
PROJECT=idea-audition
# IDEA AUDITION 用の gcloud 設定（default は別プロジェクトを向いているので使わない）
export CLOUDSDK_ACTIVE_CONFIG_NAME="${CLOUDSDK_ACTIVE_CONFIG_NAME:-victory}"

# 付ける権限：Gemini を呼ぶ・API の利用をこのプロジェクトに付ける（クレジットが使われる）
ROLES=(roles/aiplatform.user roles/serviceusage.serviceUsageConsumer)

for role in "${ROLES[@]}"; do
  if [[ "$ACTION" == "--revoke" ]]; then
    gcloud projects remove-iam-policy-binding "$PROJECT" --member="user:$EMAIL" --role="$role" --condition=None --quiet >/dev/null
    echo "外しました: $role"
  else
    gcloud projects add-iam-policy-binding "$PROJECT" --member="user:$EMAIL" --role="$role" --condition=None --quiet >/dev/null
    echo "付けました: $role"
  fi
done
echo "完了（$EMAIL / $PROJECT）。手順は docs/05-platform/gemini-credits.md"
