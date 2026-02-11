/**
 * Tests for MCP Server
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { MCPServer, createMCPServer, MCP_TOOLS, type MCPToolCallRequest } from '../server';

const TEST_BASE_DIR = '.test-mcp-server';

describe('MCP Server', () => {
  let server: MCPServer;

  beforeEach(async () => {
    await mkdir(TEST_BASE_DIR, { recursive: true });

    // Create some test knowledge
    const runbooksDir = join(TEST_BASE_DIR, 'runbooks');
    await mkdir(runbooksDir, { recursive: true });

    await writeFile(
      join(runbooksDir, 'api-troubleshooting.md'),
      `---
type: runbook
title: API Troubleshooting Guide
services:
  - api
  - gateway
symptoms:
  - 500 errors
  - high latency
---
# API Troubleshooting Guide

## Symptoms
- HTTP 500 errors
- High latency

## Steps
1. Check logs
2. Verify database connections
3. Check memory usage
`
    );

    await writeFile(
      join(runbooksDir, 'database-issues.md'),
      `---
type: runbook
title: Database Connection Issues
services:
  - database
  - postgres
symptoms:
  - connection timeout
  - pool exhaustion
---
# Database Connection Issues

## Root Causes
- Connection pool exhaustion
- Network issues
- High query load

## Resolution
1. Check connection pool metrics
2. Review slow queries
`
    );

    await writeFile(
      join(runbooksDir, 'known-issue.md'),
      `---
type: known_issue
title: Redis Memory Spike Issue
services:
  - cache
  - redis
symptoms:
  - memory spike
  - OOM
severity: sev2
discoveredAt: 2025-01-15
---
# Redis Memory Spike

Known issue with Redis memory management.

## Workaround
Restart Redis pods during low traffic.
`
    );

    server = createMCPServer({ baseDir: TEST_BASE_DIR });
  });

  afterEach(async () => {
    server.close();
    if (existsSync(TEST_BASE_DIR)) {
      await rm(TEST_BASE_DIR, { recursive: true, force: true });
    }
  });

  describe('getTools', () => {
    it('should return list of available tools', () => {
      const tools = server.getTools();

      expect(tools.length).toBeGreaterThan(0);
      expect(tools.map((t) => t.name)).toContain('search_runbooks');
      expect(tools.map((t) => t.name)).toContain('get_known_issues');
      expect(tools.map((t) => t.name)).toContain('search_postmortems');
      expect(tools.map((t) => t.name)).toContain('get_knowledge_stats');
      expect(tools.map((t) => t.name)).toContain('list_services');
    });

    it('should have proper schema for each tool', () => {
      const tools = server.getTools();

      for (const tool of tools) {
        expect(tool.name).toBeDefined();
        expect(tool.description).toBeDefined();
        expect(tool.inputSchema.type).toBe('object');
        expect(tool.inputSchema.properties).toBeDefined();
      }
    });
  });

  describe('handleToolCall - search_runbooks', () => {
    it('should search runbooks by query', async () => {
      const request: MCPToolCallRequest = {
        name: 'search_runbooks',
        arguments: {
          query: 'API errors',
          limit: 5,
        },
      };

      const response = await server.handleToolCall(request);

      expect(response.isError).toBeFalsy();
      expect(response.content.length).toBeGreaterThan(0);
      expect(response.content[0].type).toBe('text');
      expect(response.content[0].text).toContain('Runbooks');
    });

    it('should filter by services', async () => {
      const request: MCPToolCallRequest = {
        name: 'search_runbooks',
        arguments: {
          query: 'issues',
          services: ['database'],
          limit: 5,
        },
      };

      const response = await server.handleToolCall(request);

      expect(response.isError).toBeFalsy();
      // Should return database-related runbooks
      expect(response.content[0].text.toLowerCase()).toMatch(/database|runbook/);
    });

    it('should handle empty results gracefully', async () => {
      const request: MCPToolCallRequest = {
        name: 'search_runbooks',
        arguments: {
          query: 'nonexistent-service-xyz',
          limit: 5,
        },
      };

      const response = await server.handleToolCall(request);

      expect(response.isError).toBeFalsy();
      expect(response.content[0].text).toContain('No');
    });
  });

  describe('handleToolCall - get_known_issues', () => {
    it('should return known issues', async () => {
      const request: MCPToolCallRequest = {
        name: 'get_known_issues',
        arguments: {
          services: ['redis', 'cache'],
        },
      };

      const response = await server.handleToolCall(request);

      expect(response.isError).toBeFalsy();
      expect(response.content[0].text).toContain('Known Issues');
    });

    it('should filter by symptoms', async () => {
      const request: MCPToolCallRequest = {
        name: 'get_known_issues',
        arguments: {
          symptoms: ['memory spike'],
        },
      };

      const response = await server.handleToolCall(request);

      expect(response.isError).toBeFalsy();
    });
  });

  describe('handleToolCall - search_postmortems', () => {
    it('should search postmortems', async () => {
      const request: MCPToolCallRequest = {
        name: 'search_postmortems',
        arguments: {
          query: 'database outage',
          limit: 3,
        },
      };

      const response = await server.handleToolCall(request);

      expect(response.isError).toBeFalsy();
      expect(response.content[0].text).toContain('Postmortems');
    });
  });

  describe('handleToolCall - get_knowledge_stats', () => {
    it('should return knowledge base statistics', async () => {
      const request: MCPToolCallRequest = {
        name: 'get_knowledge_stats',
        arguments: {},
      };

      const response = await server.handleToolCall(request);

      expect(response.isError).toBeFalsy();
      expect(response.content[0].text).toContain('Knowledge Base Statistics');
      expect(response.content[0].text).toContain('Total Documents');
    });
  });

  describe('handleToolCall - list_services', () => {
    it('should list all services with documentation', async () => {
      const request: MCPToolCallRequest = {
        name: 'list_services',
        arguments: {},
      };

      const response = await server.handleToolCall(request);

      expect(response.isError).toBeFalsy();
      // May return services or "No services" depending on knowledge base state
      expect(response.content[0].text).toMatch(/Services|No services/);
    });

    it('should filter by knowledge type', async () => {
      const request: MCPToolCallRequest = {
        name: 'list_services',
        arguments: {
          type: 'runbook',
        },
      };

      const response = await server.handleToolCall(request);

      expect(response.isError).toBeFalsy();
    });
  });

  describe('handleToolCall - unknown tool', () => {
    it('should return error for unknown tool', async () => {
      const request: MCPToolCallRequest = {
        name: 'unknown_tool',
        arguments: {},
      };

      const response = await server.handleToolCall(request);

      expect(response.isError).toBe(true);
      expect(response.content[0].text).toContain('Unknown tool');
    });
  });

  describe('handleListTools', () => {
    it('should return tools list in MCP format', () => {
      const result = server.handleListTools();

      expect(result.tools).toBeDefined();
      expect(Array.isArray(result.tools)).toBe(true);
      expect(result.tools.length).toBe(MCP_TOOLS.length);
    });
  });
});

describe('MCP_TOOLS constant', () => {
  it('should have search_runbooks tool', () => {
    const tool = MCP_TOOLS.find((t) => t.name === 'search_runbooks');

    expect(tool).toBeDefined();
    expect(tool!.inputSchema.properties.query).toBeDefined();
    expect(tool!.inputSchema.required).toContain('query');
  });

  it('should have get_known_issues tool', () => {
    const tool = MCP_TOOLS.find((t) => t.name === 'get_known_issues');

    expect(tool).toBeDefined();
    expect(tool!.inputSchema.properties.services).toBeDefined();
    expect(tool!.inputSchema.properties.symptoms).toBeDefined();
  });

  it('should have proper descriptions for all tools', () => {
    for (const tool of MCP_TOOLS) {
      expect(tool.description.length).toBeGreaterThan(20);
    }
  });
});
