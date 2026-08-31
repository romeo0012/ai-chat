FROM node:20-alpine

WORKDIR /usr/src/app

# Install production dependencies (package-lock.json is not committed, so use npm install)
COPY package*.json ./
RUN npm install --only=production

# Bundle app source
COPY . .

# Run as non-root (satisfies runAsNonRoot enforced by the CodeNOW helm chart)
# Use a numeric UID so Kubernetes can verify the user is non-root.
USER 1000

# Service port exposed to CodeNOW (see .codenow.yaml runtime.port)
ENV PORT=3002

EXPOSE 3002
CMD [ "node", "server.js" ]
