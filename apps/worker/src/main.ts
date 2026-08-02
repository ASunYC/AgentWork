const shutdown = (signal: string) => {
  console.info(`Worker received ${signal}; shutting down.`);
  process.exit(0);
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
console.info('AgentWork worker started.');
