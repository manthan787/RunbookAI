export type CodeProvider = 'github' | 'gitlab';

export type CodeFixCandidateType = 'code' | 'pull_request' | 'issue' | 'merge_request';

export interface CodeFixCandidate {
  provider: CodeProvider;
  type: CodeFixCandidateType;
  title: string;
  url: string;
  path?: string;
  summary?: string;
  updatedAt?: string;
}

export interface CodeFixSearchResult {
  provider: CodeProvider;
  query: string;
  repository?: string;
  project?: string;
  candidates: CodeFixCandidate[];
  warnings?: string[];
}
