FROM node:18-alpine AS build-env

LABEL authors="Will Gordon <wgordon@redhat.com>, Oren Kashi <okashi@redhat.com>"

#if running with local foles only
COPY . /opt/app-root/src

RUN apk --no-cache --virtual build-dependencies add \
        python3 \
        make \
        g++ \
        git \
    # && git clone https://github.com/openshift-cs/ostoy.git /opt/app-root/src \ ########### for prod
    # && git clone https://github.com/0kashi/ostoy.git /opt/app-root/src \       ########### From my github location
    && cd /opt/app-root/src \
    && npm install \
    && npm run build --if-present \
    && npm prune \
    && rm -rf $(npm config get cache) \
    && rm -rf $(npm config get tmp)/npm-* \
    && apk del build-dependencies

# Stage 2

FROM node:18-alpine

ENV NODE_ENV=production

RUN mkdir /opt/ostoy && mkdir /.npm && chown -R 1001:0 /.npm

COPY --from=build-env /opt/app-root/src ./opt/ostoy

WORKDIR /opt/ostoy

EXPOSE 8080

USER 1001

CMD ["npm", "run", "-d", "start"]
