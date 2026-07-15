# Specify the runtime environment and OS for the application
FROM node:22-alpine 

# Specify the directory from which all the commands will be executed
WORKDIR /devops-hands-on-project-hivebox

# Copy only the dependency configuration files first, and run the install command.
COPY package*.json ./
RUN npm install --production

# Copy only the files the app needs at runtime (allowlist, not COPY . .):
# nothing sensitive or extraneous can end up inside the image.
COPY OpenSenseAPI.js temperature.js cache.js storage.js ./

# Document the port which your application listens to at runtime
EXPOSE 3000

# Drop root: the node image ships a non-privileged `node` user (uid 1000).
USER node

# Run node directly (not `npm start`): forwards signals properly and writes
# nothing to disk, so the container works with a read-only root filesystem.
CMD ["node", "OpenSenseAPI.js"]