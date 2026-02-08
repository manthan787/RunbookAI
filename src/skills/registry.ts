/**
 * Skill Registry
 *
 * Discovers, loads, and manages skill definitions.
 * Skills can be loaded from:
 * - Built-in skills (src/skills/builtin/)
 * - User skills (.runbook/skills/)
 */

import { readdir, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join, basename } from 'path';
import { parse as parseYaml } from 'yaml';
import type { SkillDefinition } from './types';

// Built-in skills
import { investigateIncidentSkill } from './builtin/investigate-incident';
import { scaleServiceSkill } from './builtin/scale-service';
import { deployServiceSkill } from './builtin/deploy-service';
import { troubleshootServiceSkill } from './builtin/troubleshoot-service';
import { rollbackDeploymentSkill } from './builtin/rollback-deployment';
import { costAnalysisSkill } from './builtin/cost-analysis';
import { investigateCostSpikeSkill } from './builtin/investigate-cost-spike';
import { securityAuditSkill } from './builtin/security-audit';

class SkillRegistry {
  private skills: Map<string, SkillDefinition> = new Map();
  private loaded: boolean = false;

  constructor() {
    // Register built-in skills
    this.registerBuiltinSkills();
  }

  private registerBuiltinSkills(): void {
    const builtins = [
      investigateIncidentSkill,
      scaleServiceSkill,
      deployServiceSkill,
      troubleshootServiceSkill,
      rollbackDeploymentSkill,
      costAnalysisSkill,
      investigateCostSpikeSkill,
      securityAuditSkill,
    ];

    for (const skill of builtins) {
      this.skills.set(skill.id, skill);
    }
  }

  /**
   * Load user-defined skills from directory
   */
  async loadUserSkills(skillsDir: string = '.runbook/skills'): Promise<number> {
    if (!existsSync(skillsDir)) {
      return 0;
    }

    let count = 0;
    const files = await readdir(skillsDir);

    for (const file of files) {
      if (!file.endsWith('.yaml') && !file.endsWith('.yml')) {
        continue;
      }

      try {
        const filePath = join(skillsDir, file);
        const content = await readFile(filePath, 'utf-8');
        const skill = parseYaml(content) as SkillDefinition;

        // Validate skill has required fields
        if (skill.id && skill.name && skill.steps) {
          this.skills.set(skill.id, skill);
          count++;
        }
      } catch (error) {
        console.error(`Failed to load skill from ${file}:`, error);
      }
    }

    this.loaded = true;
    return count;
  }

  /**
   * Get a skill by ID
   */
  get(id: string): SkillDefinition | undefined {
    return this.skills.get(id);
  }

  /**
   * Get all skills
   */
  getAll(): SkillDefinition[] {
    return Array.from(this.skills.values());
  }

  /**
   * Get skills by tag
   */
  getByTag(tag: string): SkillDefinition[] {
    return this.getAll().filter((s) => s.tags?.includes(tag));
  }

  /**
   * Get skills applicable to a service
   */
  getForService(serviceType: string): SkillDefinition[] {
    return this.getAll().filter(
      (s) => !s.applicableServices || s.applicableServices.includes(serviceType)
    );
  }

  /**
   * Check if a skill exists
   */
  has(id: string): boolean {
    return this.skills.has(id);
  }

  /**
   * Register a skill programmatically
   */
  register(skill: SkillDefinition): void {
    this.skills.set(skill.id, skill);
  }

  /**
   * Get skill count
   */
  get count(): number {
    return this.skills.size;
  }

  /**
   * Get skill summaries for display
   */
  getSummaries(): Array<{ id: string; name: string; description: string; riskLevel?: string }> {
    return this.getAll().map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      riskLevel: s.riskLevel,
    }));
  }
}

// Singleton instance
export const skillRegistry = new SkillRegistry();
