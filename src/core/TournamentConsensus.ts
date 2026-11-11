/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 * Multi-Model Tournament & Voting Consensus Engine
 *
 * Orchestrates multi-agent deliberation across diverse LLMs, performing
 * in-process semantic response clustering, majority/Borda-count tallying,
 * minority dissent analysis, and mathematically verified confidence scoring.
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */

import { cosineSimilarity } from '../utils/similarity.js';
import { createFastSemanticEmbedding } from './SemanticRouter.js';

export type TournamentVotingStrategy = 'majority' | 'borda' | 'weighted';

export interface TournamentSubmission {
  agentId: string;
  content: string;
  costUsd?: number;
  metadata?: Record<string, unknown>;
}

export interface TournamentCluster {
  clusterId: string;
  representativeContent: string;
  representativeAgentId: string;
  memberAgentIds: string[];
  totalVotes: number;
  totalWeight: number;
  internalCohesion: number;
}

export interface DissentingView {
  agentId: string;
  content: string;
  similarityToWinner: number;
  voteShare: number;
  summary?: string;
}

export interface TournamentAgentScore {
  agentId: string;
  votes: number;
  bordaPoints: number;
  weight: number;
  clusterId: string;
}

export interface TournamentConsensusResult {
  winningSolution: string;
  winningAgentId: string;
  winningClusterId: string;
  strategy: TournamentVotingStrategy;
  confidence: number;
  clusters: TournamentCluster[];
  dissentingViews: DissentingView[];
  scores: Record<string, TournamentAgentScore>;
  totalSubmissions: number;
}

export interface TournamentConsensusOptions {
  strategy?: TournamentVotingStrategy;
  similarityThreshold?: number;
  weights?: Record<string, number>;
  embedder?: (text: string) => Promise<number[]> | number[];
}

export class TournamentConsensusEngine {
  private strategy: TournamentVotingStrategy;
  private similarityThreshold: number;
  private weights: Record<string, number>;
  private embedder: (text: string) => Promise<number[]> | number[];

  constructor(options: TournamentConsensusOptions = {}) {
    this.strategy = options.strategy ?? 'borda';
    this.similarityThreshold = Math.min(
      1,
      Math.max(0, options.similarityThreshold ?? 0.58),
    );
    this.weights = options.weights ?? {};
    this.embedder = options.embedder ?? createFastSemanticEmbedding;
  }

  /**
   * Evaluates candidate submissions, clusters them semantically, and tallies votes
   * according to the configured voting strategy.
   */
  public async evaluate(
    submissions: TournamentSubmission[],
  ): Promise<TournamentConsensusResult> {
    if (!submissions || submissions.length === 0) {
      throw new Error(
        'TournamentConsensusEngine requires at least one candidate submission.',
      );
    }

    if (submissions.length === 1) {
      const sub = submissions[0];
      const singleScore: TournamentAgentScore = {
        agentId: sub.agentId,
        votes: 1,
        bordaPoints: 1,
        weight: this.getAgentWeight(sub.agentId),
        clusterId: 'cluster_0',
      };
      return {
        winningSolution: sub.content,
        winningAgentId: sub.agentId,
        winningClusterId: 'cluster_0',
        strategy: this.strategy,
        confidence: 1.0,
        clusters: [
          {
            clusterId: 'cluster_0',
            representativeContent: sub.content,
            representativeAgentId: sub.agentId,
            memberAgentIds: [sub.agentId],
            totalVotes: 1,
            totalWeight: this.getAgentWeight(sub.agentId),
            internalCohesion: 1.0,
          },
        ],
        dissentingViews: [],
        scores: { [sub.agentId]: singleScore },
        totalSubmissions: 1,
      };
    }

    // Step 1: Compute embeddings for all submissions
    const embeddings: number[][] = [];
    for (const sub of submissions) {
      const vec = await this.embedder(sub.content);
      embeddings.push(vec);
    }

    // Step 2: Compute pairwise similarity matrix
    const n = submissions.length;
    const simMatrix: number[][] = Array.from({ length: n }, () =>
      new Array(n).fill(1.0),
    );

    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const sim = cosineSimilarity(embeddings[i], embeddings[j]);
        simMatrix[i][j] = sim;
        simMatrix[j][i] = sim;
      }
    }

    // Step 3: Semantic Clustering (Group near-identical or strongly aligned answers)
    const visited = new Set<number>();
    const rawClusters: Array<{ memberIndices: number[] }> = [];

    for (let i = 0; i < n; i++) {
      if (visited.has(i)) continue;
      const clusterMembers = [i];
      visited.add(i);

      for (let j = i + 1; j < n; j++) {
        if (!visited.has(j) && simMatrix[i][j] >= this.similarityThreshold) {
          clusterMembers.push(j);
          visited.add(j);
        }
      }
      rawClusters.push({ memberIndices: clusterMembers });
    }

    // Step 4: Calculate Cluster Attributes & Cohesion
    let totalTournamentWeight = 0;
    const clusters: TournamentCluster[] = [];

    for (let cIdx = 0; cIdx < rawClusters.length; cIdx++) {
      const clusterId = `cluster_${cIdx}`;
      const indices = rawClusters[cIdx].memberIndices;
      const memberAgentIds = indices.map((idx) => submissions[idx].agentId);

      let clusterWeight = 0;
      for (const idx of indices) {
        const w = this.getAgentWeight(submissions[idx].agentId);
        clusterWeight += w;
      }
      totalTournamentWeight += clusterWeight;

      // Select representative submission: highest average similarity to other cluster members
      let bestRepIdx = indices[0];
      let bestAvgSim = -1;

      for (const idx of indices) {
        let sumSim = 0;
        for (const otherIdx of indices) {
          sumSim += simMatrix[idx][otherIdx];
        }
        const avgSim = sumSim / indices.length;
        if (avgSim > bestAvgSim) {
          bestAvgSim = avgSim;
          bestRepIdx = idx;
        }
      }

      clusters.push({
        clusterId,
        representativeContent: submissions[bestRepIdx].content,
        representativeAgentId: submissions[bestRepIdx].agentId,
        memberAgentIds,
        totalVotes: indices.length,
        totalWeight: clusterWeight,
        internalCohesion: Number(bestAvgSim.toFixed(4)),
      });
    }

    // Step 5: Score agents and tally votes according to strategy
    const scores: Record<string, TournamentAgentScore> = {};

    for (let i = 0; i < n; i++) {
      const agentId = submissions[i].agentId;
      const weight = this.getAgentWeight(agentId);

      // Find which cluster this agent belongs to
      let foundClusterId = 'cluster_0';
      for (const c of clusters) {
        if (c.memberAgentIds.includes(agentId)) {
          foundClusterId = c.clusterId;
          break;
        }
      }

      // Calculate Borda points based on pairwise similarity rankings to all other submissions
      // Higher similarity to peers indicates broader consensus
      let bordaPoints = 0;
      for (let j = 0; j < n; j++) {
        if (i !== j) {
          bordaPoints += simMatrix[i][j] * weight;
        }
      }

      scores[agentId] = {
        agentId,
        votes: 1,
        bordaPoints: Number(bordaPoints.toFixed(4)),
        weight,
        clusterId: foundClusterId,
      };
    }

    // Step 6: Determine Winning Cluster
    let winningCluster = clusters[0];

    if (this.strategy === 'majority') {
      // Largest vote count
      for (const c of clusters) {
        if (c.totalVotes > winningCluster.totalVotes) {
          winningCluster = c;
        }
      }
    } else if (this.strategy === 'weighted') {
      // Highest summed agent weight
      for (const c of clusters) {
        if (c.totalWeight > winningCluster.totalWeight) {
          winningCluster = c;
        }
      }
    } else {
      // 'borda': Summed borda points of cluster members
      let bestBordaSum = -1;
      for (const c of clusters) {
        let clusterBordaSum = 0;
        for (const agentId of c.memberAgentIds) {
          clusterBordaSum += scores[agentId]?.bordaPoints ?? 0;
        }
        if (clusterBordaSum > bestBordaSum) {
          bestBordaSum = clusterBordaSum;
          winningCluster = c;
        }
      }
    }

    // Step 7: Dissent Analysis (Identify minority clusters)
    const dissentingViews: DissentingView[] = [];
    const winnerRepEmbedding = await this.embedder(
      winningCluster.representativeContent,
    );

    for (const c of clusters) {
      if (c.clusterId === winningCluster.clusterId) continue;

      const clusterEmbedding = await this.embedder(c.representativeContent);
      const similarityToWinner = Number(
        cosineSimilarity(winnerRepEmbedding, clusterEmbedding).toFixed(4),
      );
      const voteShare = Number(
        (c.totalWeight / (totalTournamentWeight || 1)).toFixed(4),
      );

      dissentingViews.push({
        agentId: c.representativeAgentId,
        content: c.representativeContent,
        similarityToWinner,
        voteShare,
      });
    }

    // Step 8: Calculate Confidence Metric [0.0 - 1.0]
    // Combination of vote ratio and internal cohesion
    const voteRatio =
      totalTournamentWeight > 0
        ? winningCluster.totalWeight / totalTournamentWeight
        : 1.0;
    const cohesionFactor = winningCluster.internalCohesion;
    const rawConfidence = voteRatio * 0.7 + cohesionFactor * 0.3;
    const confidence = Number(
      Math.min(1.0, Math.max(0.1, rawConfidence)).toFixed(3),
    );

    return {
      winningSolution: winningCluster.representativeContent,
      winningAgentId: winningCluster.representativeAgentId,
      winningClusterId: winningCluster.clusterId,
      strategy: this.strategy,
      confidence,
      clusters,
      dissentingViews,
      scores,
      totalSubmissions: n,
    };
  }

  private getAgentWeight(agentId: string): number {
    return this.weights[agentId] ?? 1.0;
  }
}
