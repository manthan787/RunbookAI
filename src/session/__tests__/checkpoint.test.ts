/**
 * Tests for Investigation Checkpoint System
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import {
  CheckpointStore,
  createCheckpointStore,
  createCheckpoint,
  generateCheckpointId,
  formatCheckpoint,
  formatCheckpointList,
  type InvestigationCheckpoint,
  type CheckpointListEntry,
} from '../checkpoint';

const TEST_BASE_DIR = '.test-checkpoints';

describe('generateCheckpointId', () => {
  it('should generate 12-character hex string', () => {
    const id = generateCheckpointId();

    expect(id.length).toBe(12);
    expect(/^[0-9a-f]+$/.test(id)).toBe(true);
  });

  it('should generate unique IDs', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      ids.add(generateCheckpointId());
    }

    expect(ids.size).toBe(100);
  });
});

describe('createCheckpoint', () => {
  it('should create checkpoint with required fields', () => {
    const checkpoint = createCheckpoint('inv-123', {
      query: 'Why is the API slow?',
      phase: 'investigate',
      hypotheses: [],
    });

    expect(checkpoint.id).toBeDefined();
    expect(checkpoint.id.length).toBe(12);
    expect(checkpoint.investigationId).toBe('inv-123');
    expect(checkpoint.query).toBe('Why is the API slow?');
    expect(checkpoint.phase).toBe('investigate');
    expect(checkpoint.createdAt).toBeDefined();
  });

  it('should include session ID when provided', () => {
    const checkpoint = createCheckpoint(
      'inv-456',
      {
        query: 'Test query',
        phase: 'triage',
        hypotheses: [],
      },
      'session-abc'
    );

    expect(checkpoint.sessionId).toBe('session-abc');
  });

  it('should convert hypotheses to snapshots', () => {
    const hypotheses = [
      {
        id: 'h1',
        statement: 'Database connection pool exhaustion',
        category: 'infrastructure' as const,
        priority: 1,
        status: 'investigating' as const,
        evidenceStrength: 'strong' as const,
        confidence: 75,
        reasoning: 'High connection count',
        confirmingEvidence: 'metrics show 100% pool usage',
        refutingEvidence: '',
        queries: [],
        queryResults: new Map(),
        children: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    const checkpoint = createCheckpoint('inv-789', {
      query: 'Test',
      phase: 'investigate',
      hypotheses,
    });

    expect(checkpoint.hypotheses.length).toBe(1);
    expect(checkpoint.hypotheses[0].id).toBe('h1');
    expect(checkpoint.hypotheses[0].statement).toBe('Database connection pool exhaustion');
    expect(checkpoint.hypotheses[0].status).toBe('investigating');
    expect(checkpoint.hypotheses[0].confidence).toBe(75);
  });

  it('should include optional fields', () => {
    const checkpoint = createCheckpoint('inv-opt', {
      query: 'Test',
      phase: 'conclude',
      hypotheses: [],
      confidence: 85,
      toolCallCount: 15,
      servicesDiscovered: ['api', 'database'],
      symptomsIdentified: ['high latency'],
      rootCause: 'Connection pool exhaustion',
      affectedServices: ['api'],
    });

    expect(checkpoint.confidence).toBe(85);
    expect(checkpoint.toolCallCount).toBe(15);
    expect(checkpoint.servicesDiscovered).toContain('api');
    expect(checkpoint.symptomsIdentified).toContain('high latency');
    expect(checkpoint.rootCause).toBe('Connection pool exhaustion');
    expect(checkpoint.affectedServices).toContain('api');
  });
});

describe('CheckpointStore', () => {
  let store: CheckpointStore;

  beforeEach(async () => {
    await mkdir(TEST_BASE_DIR, { recursive: true });
    store = createCheckpointStore({ baseDir: TEST_BASE_DIR });
  });

  afterEach(async () => {
    if (existsSync(TEST_BASE_DIR)) {
      await rm(TEST_BASE_DIR, { recursive: true, force: true });
    }
  });

  describe('save', () => {
    it('should save checkpoint to disk', async () => {
      const checkpoint = createCheckpoint('inv-save-1', {
        query: 'Test query',
        phase: 'triage',
        hypotheses: [],
      });

      const id = await store.save(checkpoint);

      expect(id).toBe(checkpoint.id);

      // Verify file exists
      const checkpointPath = join(TEST_BASE_DIR, 'checkpoints', 'inv-save-1', `${id}.json`);
      expect(existsSync(checkpointPath)).toBe(true);

      // Verify content
      const content = JSON.parse(await readFile(checkpointPath, 'utf-8'));
      expect(content.id).toBe(id);
      expect(content.query).toBe('Test query');
    });

    it('should update latest pointer', async () => {
      const checkpoint = createCheckpoint('inv-save-2', {
        query: 'Test',
        phase: 'investigate',
        hypotheses: [],
      });

      await store.save(checkpoint);

      const latestPath = join(TEST_BASE_DIR, 'checkpoints', 'inv-save-2', 'latest.json');
      expect(existsSync(latestPath)).toBe(true);

      const latest = JSON.parse(await readFile(latestPath, 'utf-8'));
      expect(latest.id).toBe(checkpoint.id);
    });
  });

  describe('load', () => {
    it('should load checkpoint by ID', async () => {
      const checkpoint = createCheckpoint('inv-load-1', {
        query: 'Load test',
        phase: 'hypothesize',
        hypotheses: [],
        confidence: 50,
      });

      await store.save(checkpoint);

      const loaded = await store.load('inv-load-1', checkpoint.id);

      expect(loaded).not.toBeNull();
      expect(loaded!.id).toBe(checkpoint.id);
      expect(loaded!.query).toBe('Load test');
      expect(loaded!.confidence).toBe(50);
    });

    it('should return null for non-existent checkpoint', async () => {
      const loaded = await store.load('inv-nonexistent', 'fake-id');

      expect(loaded).toBeNull();
    });
  });

  describe('loadLatest', () => {
    it('should load latest checkpoint', async () => {
      const cp1 = createCheckpoint('inv-latest', {
        query: 'First',
        phase: 'triage',
        hypotheses: [],
      });
      await store.save(cp1);

      // Wait a bit to ensure different timestamps
      await new Promise((r) => setTimeout(r, 10));

      const cp2 = createCheckpoint('inv-latest', {
        query: 'Second',
        phase: 'investigate',
        hypotheses: [],
      });
      await store.save(cp2);

      const latest = await store.loadLatest('inv-latest');

      expect(latest).not.toBeNull();
      expect(latest!.id).toBe(cp2.id);
      expect(latest!.query).toBe('Second');
    });

    it('should return null for investigation with no checkpoints', async () => {
      const latest = await store.loadLatest('inv-none');

      expect(latest).toBeNull();
    });
  });

  describe('list', () => {
    it('should list all checkpoints for an investigation', async () => {
      for (let i = 0; i < 3; i++) {
        const cp = createCheckpoint('inv-list', {
          query: `Query ${i}`,
          phase: 'investigate',
          hypotheses: [],
          confidence: i * 30,
        });
        await store.save(cp);
        await new Promise((r) => setTimeout(r, 5));
      }

      const list = await store.list('inv-list');

      expect(list.length).toBe(3);
      // Should be sorted newest first
      expect(list[0].confidence).toBeGreaterThan(list[2].confidence);
    });

    it('should return empty array for non-existent investigation', async () => {
      const list = await store.list('inv-nonexistent');

      expect(list).toEqual([]);
    });

    it('should include hypothesis count', async () => {
      const cp = createCheckpoint('inv-hypo-count', {
        query: 'Test',
        phase: 'investigate',
        hypotheses: [
          {
            id: 'h1',
            statement: 'Test 1',
            category: 'application' as const,
            status: 'pending' as const,
            confidence: 0,
            priority: 1,
            evidenceStrength: 'none' as const,
            reasoning: '',
            confirmingEvidence: '',
            refutingEvidence: '',
            queries: [],
            queryResults: new Map(),
            children: [],
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          {
            id: 'h2',
            statement: 'Test 2',
            category: 'application' as const,
            status: 'pending' as const,
            confidence: 0,
            priority: 1,
            evidenceStrength: 'none' as const,
            reasoning: '',
            confirmingEvidence: '',
            refutingEvidence: '',
            queries: [],
            queryResults: new Map(),
            children: [],
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
      });
      await store.save(cp);

      const list = await store.list('inv-hypo-count');

      expect(list[0].hypothesisCount).toBe(2);
    });
  });

  describe('listInvestigations', () => {
    it('should list all investigations with checkpoints', async () => {
      await store.save(createCheckpoint('inv-a', { query: 'A', phase: 'triage', hypotheses: [] }));
      await store.save(
        createCheckpoint('inv-b', { query: 'B', phase: 'investigate', hypotheses: [] })
      );
      await store.save(
        createCheckpoint('inv-c', { query: 'C', phase: 'conclude', hypotheses: [] })
      );

      const investigations = await store.listInvestigations();

      expect(investigations.length).toBe(3);
      expect(investigations.map((i) => i.investigationId)).toContain('inv-a');
      expect(investigations.map((i) => i.investigationId)).toContain('inv-b');
      expect(investigations.map((i) => i.investigationId)).toContain('inv-c');
    });

    it('should include checkpoint count and latest checkpoint', async () => {
      await store.save(
        createCheckpoint('inv-multi', { query: '1', phase: 'triage', hypotheses: [] })
      );
      await new Promise((r) => setTimeout(r, 5));
      await store.save(
        createCheckpoint('inv-multi', { query: '2', phase: 'investigate', hypotheses: [] })
      );

      const investigations = await store.listInvestigations();
      const inv = investigations.find((i) => i.investigationId === 'inv-multi');

      expect(inv).toBeDefined();
      expect(inv!.checkpointCount).toBe(2);
      expect(inv!.latestCheckpoint).toBeDefined();
      expect(inv!.latestCheckpoint!.phase).toBe('investigate');
    });
  });

  describe('delete', () => {
    it('should delete a specific checkpoint', async () => {
      const cp = createCheckpoint('inv-delete', {
        query: 'Delete me',
        phase: 'triage',
        hypotheses: [],
      });
      await store.save(cp);

      const success = await store.delete('inv-delete', cp.id);

      expect(success).toBe(true);

      const loaded = await store.load('inv-delete', cp.id);
      expect(loaded).toBeNull();
    });

    it('should return false for non-existent checkpoint', async () => {
      const success = await store.delete('inv-fake', 'fake-id');

      expect(success).toBe(false);
    });
  });

  describe('deleteAll', () => {
    it('should delete all checkpoints for an investigation', async () => {
      for (let i = 0; i < 5; i++) {
        await store.save(
          createCheckpoint('inv-delete-all', {
            query: `Query ${i}`,
            phase: 'investigate',
            hypotheses: [],
          })
        );
      }

      const deleted = await store.deleteAll('inv-delete-all');

      expect(deleted).toBeGreaterThan(0);

      const list = await store.list('inv-delete-all');
      expect(list.length).toBe(0);
    });
  });

  describe('pruning', () => {
    it('should prune old checkpoints when over limit', async () => {
      const smallStore = createCheckpointStore({
        baseDir: TEST_BASE_DIR,
        maxCheckpointsPerInvestigation: 3,
      });

      for (let i = 0; i < 5; i++) {
        await smallStore.save(
          createCheckpoint('inv-prune', {
            query: `Query ${i}`,
            phase: 'investigate',
            hypotheses: [],
          })
        );
        await new Promise((r) => setTimeout(r, 5));
      }

      const list = await smallStore.list('inv-prune');

      expect(list.length).toBeLessThanOrEqual(3);
    });
  });
});

describe('formatCheckpoint', () => {
  it('should format checkpoint as markdown', () => {
    const checkpoint: InvestigationCheckpoint = {
      id: 'abc123def456',
      investigationId: 'inv-format',
      createdAt: '2025-01-15T12:00:00Z',
      phase: 'investigate',
      query: 'Why is the API slow?',
      confidence: 65,
      promptCount: 5,
      toolCallCount: 12,
      hypotheses: [
        {
          id: 'h1',
          statement: 'Database connection pool exhaustion',
          category: 'infrastructure',
          status: 'investigating',
          confidence: 80,
          reasoning: 'High connection count observed',
        },
        {
          id: 'h2',
          statement: 'Memory leak',
          category: 'application',
          status: 'pruned',
          confidence: 10,
        },
      ],
      servicesDiscovered: ['api', 'database'],
      symptomsIdentified: ['high latency'],
      toolResultIds: [],
      evidence: [],
    };

    const formatted = formatCheckpoint(checkpoint);

    expect(formatted).toContain('Checkpoint: abc123def456');
    expect(formatted).toContain('**Investigation:** inv-format');
    expect(formatted).toContain('**Phase:** investigate');
    expect(formatted).toContain('**Confidence:** 65%');
    expect(formatted).toContain('Database connection pool exhaustion');
    expect(formatted).toContain('Memory leak');
    expect(formatted).toContain('[investigating]');
    expect(formatted).toContain('[pruned]');
    expect(formatted).toContain('api');
    expect(formatted).toContain('database');
  });

  it('should include root cause when present', () => {
    const checkpoint: InvestigationCheckpoint = {
      id: 'xyz789',
      investigationId: 'inv-root',
      createdAt: '2025-01-15T12:00:00Z',
      phase: 'conclude',
      query: 'Test',
      confidence: 90,
      promptCount: 0,
      toolCallCount: 0,
      hypotheses: [],
      servicesDiscovered: [],
      symptomsIdentified: [],
      toolResultIds: [],
      evidence: [],
      rootCause: 'Connection pool was exhausted due to leaked connections',
    };

    const formatted = formatCheckpoint(checkpoint);

    expect(formatted).toContain('Root Cause');
    expect(formatted).toContain('Connection pool was exhausted');
  });
});

describe('formatCheckpointList', () => {
  it('should format list as markdown table', () => {
    const checkpoints: CheckpointListEntry[] = [
      {
        id: 'abc123def456',
        investigationId: 'inv-1',
        createdAt: '2025-01-15T12:00:00Z',
        phase: 'investigate',
        query: 'Test query',
        confidence: 65,
        hypothesisCount: 3,
      },
      {
        id: 'xyz789abc123',
        investigationId: 'inv-1',
        createdAt: '2025-01-15T11:00:00Z',
        phase: 'triage',
        query: 'Test query',
        confidence: 30,
        hypothesisCount: 1,
      },
    ];

    const formatted = formatCheckpointList(checkpoints);

    expect(formatted).toContain('ID');
    expect(formatted).toContain('Phase');
    expect(formatted).toContain('Confidence');
    expect(formatted).toContain('abc123');
    expect(formatted).toContain('xyz789');
    expect(formatted).toContain('investigate');
    expect(formatted).toContain('triage');
  });

  it('should handle empty list', () => {
    const formatted = formatCheckpointList([]);

    expect(formatted).toContain('No checkpoints found');
  });
});
