# IDEA AUDITION：画面（apps/web）とサーバー（apps/server）を1つのコンテナで配る（Cloud Run 用）
FROM node:22-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/protocol/package.json packages/protocol/
COPY packages/camp/package.json packages/camp/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile
COPY packages packages
COPY apps apps
RUN pnpm --filter @idea-audition/web build && pnpm --filter @idea-audition/server build
# サーバーの本番依存だけを /out にまとめ、ビルド結果と画面のファイルを足す
RUN pnpm --filter @idea-audition/server deploy --prod --legacy /out \
  && rm -rf /out/dist /out/src /out/test \
  && cp -r apps/server/dist /out/dist \
  && cp -r apps/web/dist /out/public

FROM node:22-slim
ENV NODE_ENV=production \
    STATIC_DIR=/app/public
WORKDIR /app
COPY --from=build --chown=node:node /out ./
USER node
EXPOSE 8080
CMD ["node", "dist/main.js"]
