import { z } from 'zod';
import { defineTool } from '@open-agents/core';

export const queryDatabaseTool = defineTool({
  name: 'queryDatabase',
  description: 'Execute a read-only SQL query on the warehouse database',
  parameters: z.object({
    query: z.string().describe('The SQL query to run'),
  }),
  execute: async ({ query }) => {
    return {
      query,
      rowCount: 3,
      rows: [
        { id: 1, user: 'alice@example.com', plan: 'enterprise', mrr: 1200 },
        { id: 2, user: 'bob@example.com', plan: 'pro', mrr: 299 },
        { id: 3, user: 'carol@example.com', plan: 'starter', mrr: 49 },
      ],
      durationMs: 14,
    };
  },
});

export const deployServiceTool = defineTool({
  name: 'deployService',
  description: 'Deploy a software service to a cluster environment',
  parameters: z.object({
    service: z.string().describe('Name of the service to deploy'),
    environment: z.enum(['staging', 'production']).describe('Target deployment environment'),
    tag: z.string().describe('Container image tag to release'),
  }),
  execute: async ({ service, environment, tag }) => {
    return {
      status: 'deployed',
      service,
      environment,
      tag,
      deployedAt: new Date().toISOString(),
      url: `https://${service}.${environment}.internal.net`,
    };
  },
});

export const sendNotificationTool = defineTool({
  name: 'sendNotification',
  description: 'Send an alert notification to an engineering Slack channel',
  parameters: z.object({
    channel: z.string().describe('Channel name (e.g. #ops-alerts)'),
    message: z.string().describe('Alert message text'),
    priority: z.enum(['low', 'medium', 'high']).describe('Notification priority'),
  }),
  execute: async ({ channel, message, priority }) => {
    return {
      delivered: true,
      channel,
      priority,
      timestamp: Date.now(),
    };
  },
});
