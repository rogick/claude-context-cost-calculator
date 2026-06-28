module.exports = {
  apps: [
    {
      name: 'claude-cost-server',
      script: './server.mjs',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'development',
        PORT: 8675
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 8675
      }
    }
  ]
};
