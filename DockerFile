# Specify the runtime environment and OS for the application
FROM node:22-alpine 

# Specify the directory from which all the commands will be executed
WORKDIR /devops-hands-on-project-hivebox

# Copy only the dependency configuration files first, and run the install command.
COPY package*.json ./
RUN npm install --production

# Once dependencies are safely cached, copy all other project files
COPY . .

# Document the port which your application listens to at runtime
EXPOSE 3000

# Set the default terminal command that executes automatically whenever the container spins up
CMD ["npm", "start"]