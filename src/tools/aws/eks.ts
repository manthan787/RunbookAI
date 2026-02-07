/**
 * EKS Tools
 *
 * AWS Elastic Kubernetes Service operations for cluster management,
 * node group status, and workload visibility.
 */

import {
  EKSClient,
  ListClustersCommand,
  DescribeClusterCommand,
  ListNodegroupsCommand,
  DescribeNodegroupCommand,
  ListFargateProfilesCommand,
  DescribeFargateProfileCommand,
} from '@aws-sdk/client-eks';
import { getClient } from '../../providers/aws/client';

export interface EKSCluster {
  name: string;
  arn: string;
  version: string;
  status: string;
  endpoint?: string;
  platformVersion?: string;
  createdAt?: Date;
  vpcConfig?: {
    subnetIds: string[];
    securityGroupIds: string[];
    publicAccessEnabled: boolean;
    privateAccessEnabled: boolean;
  };
  logging?: {
    enabledTypes: string[];
  };
}

export interface EKSNodeGroup {
  nodeGroupName: string;
  clusterName: string;
  status: string;
  scalingConfig?: {
    minSize: number;
    maxSize: number;
    desiredSize: number;
  };
  instanceTypes?: string[];
  capacityType?: string;
  diskSize?: number;
  amiType?: string;
  health?: {
    issues: Array<{ code: string; message: string }>;
  };
}

export interface EKSFargateProfile {
  profileName: string;
  clusterName: string;
  status: string;
  podExecutionRoleArn?: string;
  selectors: Array<{
    namespace: string;
    labels?: Record<string, string>;
  }>;
  subnets?: string[];
}

/**
 * List all EKS clusters
 */
export async function listClusters(accountName?: string, region?: string): Promise<string[]> {
  const client = await getClient(EKSClient, { accountName, region });
  const clusters: string[] = [];
  let nextToken: string | undefined;

  do {
    const command = new ListClustersCommand({ nextToken });
    const response = await client.send(command);
    clusters.push(...(response.clusters || []));
    nextToken = response.nextToken;
  } while (nextToken);

  return clusters;
}

/**
 * Describe a specific EKS cluster
 */
export async function describeCluster(
  clusterName: string,
  accountName?: string,
  region?: string
): Promise<EKSCluster | null> {
  const client = await getClient(EKSClient, { accountName, region });

  try {
    const command = new DescribeClusterCommand({ name: clusterName });
    const response = await client.send(command);
    const cluster = response.cluster;

    if (!cluster) return null;

    return {
      name: cluster.name || clusterName,
      arn: cluster.arn || '',
      version: cluster.version || '',
      status: cluster.status || 'UNKNOWN',
      endpoint: cluster.endpoint,
      platformVersion: cluster.platformVersion,
      createdAt: cluster.createdAt,
      vpcConfig: cluster.resourcesVpcConfig
        ? {
            subnetIds: cluster.resourcesVpcConfig.subnetIds || [],
            securityGroupIds: cluster.resourcesVpcConfig.securityGroupIds || [],
            publicAccessEnabled: cluster.resourcesVpcConfig.endpointPublicAccess || false,
            privateAccessEnabled: cluster.resourcesVpcConfig.endpointPrivateAccess || false,
          }
        : undefined,
      logging: cluster.logging?.clusterLogging
        ? {
            enabledTypes:
              cluster.logging.clusterLogging
                .filter((l) => l.enabled)
                .flatMap((l) => l.types || []) || [],
          }
        : undefined,
    };
  } catch (error) {
    if ((error as Error).name === 'ResourceNotFoundException') {
      return null;
    }
    throw error;
  }
}

/**
 * Describe all EKS clusters
 */
export async function describeClusters(
  clusterNames?: string[],
  accountName?: string,
  region?: string
): Promise<EKSCluster[]> {
  const names = clusterNames || (await listClusters(accountName, region));
  const clusters: EKSCluster[] = [];

  for (const name of names) {
    const cluster = await describeCluster(name, accountName, region);
    if (cluster) {
      clusters.push(cluster);
    }
  }

  return clusters;
}

/**
 * List node groups for a cluster
 */
export async function listNodeGroups(
  clusterName: string,
  accountName?: string,
  region?: string
): Promise<string[]> {
  const client = await getClient(EKSClient, { accountName, region });
  const nodeGroups: string[] = [];
  let nextToken: string | undefined;

  do {
    const command = new ListNodegroupsCommand({ clusterName, nextToken });
    const response = await client.send(command);
    nodeGroups.push(...(response.nodegroups || []));
    nextToken = response.nextToken;
  } while (nextToken);

  return nodeGroups;
}

/**
 * Describe a node group
 */
export async function describeNodeGroup(
  clusterName: string,
  nodeGroupName: string,
  accountName?: string,
  region?: string
): Promise<EKSNodeGroup | null> {
  const client = await getClient(EKSClient, { accountName, region });

  try {
    const command = new DescribeNodegroupCommand({ clusterName, nodegroupName: nodeGroupName });
    const response = await client.send(command);
    const ng = response.nodegroup;

    if (!ng) return null;

    return {
      nodeGroupName: ng.nodegroupName || nodeGroupName,
      clusterName: ng.clusterName || clusterName,
      status: ng.status || 'UNKNOWN',
      scalingConfig: ng.scalingConfig
        ? {
            minSize: ng.scalingConfig.minSize || 0,
            maxSize: ng.scalingConfig.maxSize || 0,
            desiredSize: ng.scalingConfig.desiredSize || 0,
          }
        : undefined,
      instanceTypes: ng.instanceTypes,
      capacityType: ng.capacityType,
      diskSize: ng.diskSize,
      amiType: ng.amiType,
      health:
        ng.health && ng.health.issues && ng.health.issues.length > 0
          ? {
              issues: ng.health.issues.map((i) => ({
                code: i.code || '',
                message: i.message || '',
              })),
            }
          : undefined,
    };
  } catch (error) {
    if ((error as Error).name === 'ResourceNotFoundException') {
      return null;
    }
    throw error;
  }
}

/**
 * List Fargate profiles for a cluster
 */
export async function listFargateProfiles(
  clusterName: string,
  accountName?: string,
  region?: string
): Promise<string[]> {
  const client = await getClient(EKSClient, { accountName, region });
  const profiles: string[] = [];
  let nextToken: string | undefined;

  do {
    const command = new ListFargateProfilesCommand({ clusterName, nextToken });
    const response = await client.send(command);
    profiles.push(...(response.fargateProfileNames || []));
    nextToken = response.nextToken;
  } while (nextToken);

  return profiles;
}

/**
 * Describe a Fargate profile
 */
export async function describeFargateProfile(
  clusterName: string,
  profileName: string,
  accountName?: string,
  region?: string
): Promise<EKSFargateProfile | null> {
  const client = await getClient(EKSClient, { accountName, region });

  try {
    const command = new DescribeFargateProfileCommand({ clusterName, fargateProfileName: profileName });
    const response = await client.send(command);
    const fp = response.fargateProfile;

    if (!fp) return null;

    return {
      profileName: fp.fargateProfileName || profileName,
      clusterName: fp.clusterName || clusterName,
      status: fp.status || 'UNKNOWN',
      podExecutionRoleArn: fp.podExecutionRoleArn,
      selectors: (fp.selectors || []).map((s) => ({
        namespace: s.namespace || '',
        labels: s.labels,
      })),
      subnets: fp.subnets,
    };
  } catch (error) {
    if ((error as Error).name === 'ResourceNotFoundException') {
      return null;
    }
    throw error;
  }
}

/**
 * Get all clusters with their node groups and status
 */
export async function getAllClustersWithStatus(
  accountName?: string,
  region?: string
): Promise<Array<EKSCluster & { nodeGroups: EKSNodeGroup[]; fargateProfiles: string[] }>> {
  const clusters = await describeClusters(undefined, accountName, region);
  const result: Array<EKSCluster & { nodeGroups: EKSNodeGroup[]; fargateProfiles: string[] }> = [];

  for (const cluster of clusters) {
    const nodeGroupNames = await listNodeGroups(cluster.name, accountName, region);
    const nodeGroups: EKSNodeGroup[] = [];

    for (const ngName of nodeGroupNames) {
      const ng = await describeNodeGroup(cluster.name, ngName, accountName, region);
      if (ng) {
        nodeGroups.push(ng);
      }
    }

    const fargateProfiles = await listFargateProfiles(cluster.name, accountName, region);

    result.push({
      ...cluster,
      nodeGroups,
      fargateProfiles,
    });
  }

  return result;
}

/**
 * Check cluster health
 */
export async function checkClusterHealth(
  clusterName: string,
  accountName?: string,
  region?: string
): Promise<{ healthy: boolean; issues: string[] }> {
  const issues: string[] = [];

  const cluster = await describeCluster(clusterName, accountName, region);
  if (!cluster) {
    return { healthy: false, issues: ['Cluster not found'] };
  }

  if (cluster.status !== 'ACTIVE') {
    issues.push(`Cluster status is ${cluster.status}`);
  }

  // Check node groups
  const nodeGroupNames = await listNodeGroups(clusterName, accountName, region);
  for (const ngName of nodeGroupNames) {
    const ng = await describeNodeGroup(clusterName, ngName, accountName, region);
    if (ng) {
      if (ng.status !== 'ACTIVE') {
        issues.push(`Node group ${ngName} status is ${ng.status}`);
      }
      if (ng.health?.issues && ng.health.issues.length > 0) {
        for (const issue of ng.health.issues) {
          issues.push(`Node group ${ngName}: ${issue.code} - ${issue.message}`);
        }
      }
      if (ng.scalingConfig && ng.scalingConfig.desiredSize === 0) {
        issues.push(`Node group ${ngName} has 0 desired nodes`);
      }
    }
  }

  return { healthy: issues.length === 0, issues };
}
