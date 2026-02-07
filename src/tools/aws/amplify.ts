/**
 * Amplify Tools
 */

import {
  AmplifyClient,
  ListAppsCommand,
  GetAppCommand,
  ListBranchesCommand,
  GetBranchCommand,
  ListJobsCommand,
  GetJobCommand,
} from '@aws-sdk/client-amplify';
import { getClient } from '../../providers/aws/client';

export interface AmplifyApp {
  appId: string;
  appArn: string;
  name: string;
  description?: string;
  repository?: string;
  platform: string;
  productionBranch?: {
    branchName: string;
    lastDeployTime?: Date;
  };
  customDomains: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface AmplifyBranch {
  branchArn: string;
  branchName: string;
  displayName: string;
  stage: string;
  activeJobId?: string;
  lastDeployTime?: Date;
  status: string;
  thumbnailUrl?: string;
}

export interface AmplifyJob {
  jobId: string;
  status: string;
  startTime: Date;
  endTime?: Date;
  commitId?: string;
  commitMessage?: string;
}

/**
 * List all Amplify apps
 */
export async function listApps(accountName?: string, region?: string): Promise<AmplifyApp[]> {
  const client = await getClient(AmplifyClient, { accountName, region });
  const apps: AmplifyApp[] = [];
  let nextToken: string | undefined;

  do {
    const command = new ListAppsCommand({ nextToken, maxResults: 100 });
    const response = await client.send(command);

    for (const app of response.apps || []) {
      apps.push({
        appId: app.appId || '',
        appArn: app.appArn || '',
        name: app.name || '',
        description: app.description,
        repository: app.repository,
        platform: app.platform || 'WEB',
        productionBranch: app.productionBranch
          ? {
              branchName: app.productionBranch.branchName || '',
              lastDeployTime: app.productionBranch.lastDeployTime,
            }
          : undefined,
        customDomains: (app as unknown as { customDomains?: string[] }).customDomains || [],
        createdAt: app.createTime || new Date(),
        updatedAt: app.updateTime || new Date(),
      });
    }

    nextToken = response.nextToken;
  } while (nextToken);

  return apps;
}

/**
 * Get a specific Amplify app by ID
 */
export async function getApp(
  appId: string,
  accountName?: string,
  region?: string
): Promise<AmplifyApp | null> {
  const client = await getClient(AmplifyClient, { accountName, region });

  try {
    const command = new GetAppCommand({ appId });
    const response = await client.send(command);
    const app = response.app;

    if (!app) return null;

    return {
      appId: app.appId || appId,
      appArn: app.appArn || '',
      name: app.name || '',
      description: app.description,
      repository: app.repository,
      platform: app.platform || 'WEB',
      productionBranch: app.productionBranch
        ? {
            branchName: app.productionBranch.branchName || '',
            lastDeployTime: app.productionBranch.lastDeployTime,
          }
        : undefined,
      customDomains: (app as unknown as { customDomains?: string[] }).customDomains || [],
      createdAt: app.createTime || new Date(),
      updatedAt: app.updateTime || new Date(),
    };
  } catch (error) {
    if ((error as Error).name === 'NotFoundException') {
      return null;
    }
    throw error;
  }
}

/**
 * List branches for an Amplify app
 */
export async function listBranches(
  appId: string,
  accountName?: string,
  region?: string
): Promise<AmplifyBranch[]> {
  const client = await getClient(AmplifyClient, { accountName, region });
  const branches: AmplifyBranch[] = [];
  let nextToken: string | undefined;

  do {
    const command = new ListBranchesCommand({ appId, nextToken, maxResults: 50 });
    const response = await client.send(command);

    for (const branch of response.branches || []) {
      branches.push({
        branchArn: branch.branchArn || '',
        branchName: branch.branchName || '',
        displayName: branch.displayName || branch.branchName || '',
        stage: branch.stage || 'NONE',
        activeJobId: branch.activeJobId,
        lastDeployTime: branch.updateTime,
        status: branch.activeJobId ? 'DEPLOYING' : 'DEPLOYED',
        thumbnailUrl: branch.thumbnailUrl,
      });
    }

    nextToken = response.nextToken;
  } while (nextToken);

  return branches;
}

/**
 * Get details for a specific branch
 */
export async function getBranch(
  appId: string,
  branchName: string,
  accountName?: string,
  region?: string
): Promise<AmplifyBranch | null> {
  const client = await getClient(AmplifyClient, { accountName, region });

  try {
    const command = new GetBranchCommand({ appId, branchName });
    const response = await client.send(command);
    const branch = response.branch;

    if (!branch) return null;

    return {
      branchArn: branch.branchArn || '',
      branchName: branch.branchName || branchName,
      displayName: branch.displayName || branch.branchName || '',
      stage: branch.stage || 'NONE',
      activeJobId: branch.activeJobId,
      lastDeployTime: branch.updateTime,
      status: branch.activeJobId ? 'DEPLOYING' : 'DEPLOYED',
      thumbnailUrl: branch.thumbnailUrl,
    };
  } catch (error) {
    if ((error as Error).name === 'NotFoundException') {
      return null;
    }
    throw error;
  }
}

/**
 * List recent jobs for a branch
 */
export async function listJobs(
  appId: string,
  branchName: string,
  limit: number = 10,
  accountName?: string,
  region?: string
): Promise<AmplifyJob[]> {
  const client = await getClient(AmplifyClient, { accountName, region });
  const command = new ListJobsCommand({ appId, branchName, maxResults: limit });
  const response = await client.send(command);

  return (response.jobSummaries || []).map((job) => ({
    jobId: job.jobId || '',
    status: job.status || 'UNKNOWN',
    startTime: job.startTime || new Date(),
    endTime: job.endTime,
    commitId: job.commitId,
    commitMessage: job.commitMessage,
  }));
}

/**
 * Get details for a specific job
 */
export async function getJob(
  appId: string,
  branchName: string,
  jobId: string,
  accountName?: string,
  region?: string
): Promise<AmplifyJob | null> {
  const client = await getClient(AmplifyClient, { accountName, region });

  try {
    const command = new GetJobCommand({ appId, branchName, jobId });
    const response = await client.send(command);
    const summary = response.job?.summary;

    if (!summary) return null;

    return {
      jobId: summary.jobId || jobId,
      status: summary.status || 'UNKNOWN',
      startTime: summary.startTime || new Date(),
      endTime: summary.endTime,
      commitId: summary.commitId,
      commitMessage: summary.commitMessage,
    };
  } catch (error) {
    if ((error as Error).name === 'NotFoundException') {
      return null;
    }
    throw error;
  }
}

/**
 * Get all apps with their current deployment status
 */
export async function getAllAppsWithStatus(
  accountName?: string,
  region?: string
): Promise<Array<AmplifyApp & { branches: AmplifyBranch[] }>> {
  const apps = await listApps(accountName, region);
  const appsWithBranches: Array<AmplifyApp & { branches: AmplifyBranch[] }> = [];

  for (const app of apps) {
    const branches = await listBranches(app.appId, accountName, region);
    appsWithBranches.push({ ...app, branches });
  }

  return appsWithBranches;
}

/**
 * Check deployment health for an app
 */
export async function checkAppHealth(
  appId: string,
  accountName?: string,
  region?: string
): Promise<{ healthy: boolean; issues: string[] }> {
  const issues: string[] = [];

  const app = await getApp(appId, accountName, region);
  if (!app) {
    return { healthy: false, issues: ['App not found'] };
  }

  const branches = await listBranches(appId, accountName, region);

  for (const branch of branches) {
    if (branch.stage === 'PRODUCTION') {
      // Check recent jobs for failures
      const jobs = await listJobs(appId, branch.branchName, 5, accountName, region);
      const recentFailures = jobs.filter((j) => j.status === 'FAILED');

      if (recentFailures.length > 0) {
        issues.push(`Branch ${branch.branchName} has ${recentFailures.length} recent failed deployments`);
      }

      // Check if currently deploying
      if (branch.activeJobId) {
        issues.push(`Branch ${branch.branchName} has an active deployment in progress`);
      }
    }
  }

  return { healthy: issues.length === 0, issues };
}
